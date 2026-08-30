import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "./db.js";
import {
  coreRateLimit,
  fetchJobsForRun,
  fetchRuns,
  installationIdForRepo,
  octokitForInstallation,
  shouldFetchJobs,
} from "./github.js";
import type { Octokit } from "octokit";
import { type NewJobAttempt, toJobAttemptRow } from "./job-attempt.js";
import {
  ingestedRuns,
  jobAttempts,
  repos,
  resourceValidators,
  users,
  watchedRepos,
} from "./schema.js";

const BATCH_SIZE = 500;
const RUNS_LIST = "runs-list";

async function printRateLimit(octoClient: Octokit) {
  const core = await coreRateLimit(octoClient);
  console.log(`Rate limit:     ${core.remaining}/${core.limit} remaining`);
}

function parseRepoFlag(argv: string[]): { owner: string; name: string } {
  const index = argv.indexOf("--repo");
  const value = index === -1 ? undefined : argv[index + 1];
  if (!value) {
    throw new Error("Usage: pnpm ingest --repo <owner>/<name>");
  }
  const parts = value.split("/");
  const [owner, name] = parts;
  if (parts.length !== 2 || !owner || !name) {
    throw new Error(`Expected <owner>/<name>, got "${value}"`);
  }
  return { owner, name };
}

async function main() {
  const { owner, name } = parseRepoFlag(process.argv.slice(2));

  const [user] = await db.select().from(users).limit(1);
  if (!user) {
    throw new Error("No user found. Run `pnpm seed` first.");
  }

  const [watched] = await db
    .select({ repoId: repos.id })
    .from(watchedRepos)
    .innerJoin(repos, eq(watchedRepos.repoId, repos.id))
    .where(and(eq(watchedRepos.userId, user.id), eq(repos.owner, owner), eq(repos.name, name)))
    .limit(1);

  if (!watched) {
    throw new Error(`Not watching ${owner}/${name}. Run \`pnpm add-repo ${owner}/${name}\` first.`);
  }

  console.log(`Ingesting ${owner}/${name} (repo ${watched.repoId})`);

  const installationId = await installationIdForRepo(owner, name);
  const octoClient = await octokitForInstallation(installationId);

  const [validator] = await db
    .select({ etag: resourceValidators.etag })
    .from(resourceValidators)
    .where(
      and(
        eq(resourceValidators.repoId, watched.repoId),
        eq(resourceValidators.resource, RUNS_LIST),
      ),
    )
    .limit(1);

  const listed = await fetchRuns(owner, name, octoClient, { etag: validator?.etag ?? null });

  if (listed.notModified) {
    console.log("Runs list unchanged since last ingest (code 304) — nothing to do.");
    await printRateLimit(octoClient);
    await pool.end();
    return;
  }

  const storedRuns = await db
    .select({ githubRunId: ingestedRuns.githubRunId, updatedAt: ingestedRuns.updatedAt })
    .from(ingestedRuns)
    .where(eq(ingestedRuns.repoId, watched.repoId));

  const storedUpdatedAtByRunId = new Map(storedRuns.map((row) => [row.githubRunId, row.updatedAt]));

  const buffer: NewJobAttempt[] = [];
  const fetchedRuns: (typeof ingestedRuns.$inferInsert)[] = [];
  let runsSeen = 0;
  let runsSkipped = 0;
  let jobsSeen = 0;
  let unfinished = 0;
  let insertedRows = 0;

  async function flush() {
    if (buffer.length > 0) {
      const written = await db
        .insert(jobAttempts)
        .values(buffer)
        .onConflictDoNothing()
        .returning({ id: jobAttempts.id });

      insertedRows += written.length;
      buffer.length = 0;
    }

    if (fetchedRuns.length > 0) {
      await db
        .insert(ingestedRuns)
        .values(fetchedRuns)
        .onConflictDoUpdate({
          target: [ingestedRuns.repoId, ingestedRuns.githubRunId],
          set: { updatedAt: sql`excluded.updated_at` },
        });
      fetchedRuns.length = 0;
    }
  }

  for (const run of listed.runs) {
    runsSeen += 1;

    if (!shouldFetchJobs(run, storedUpdatedAtByRunId.get(run.id))) {
      runsSkipped += 1;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const jobs = await fetchJobsForRun(owner, name, octoClient, run.id);

    for (const job of jobs) {
      jobsSeen += 1;
      const row = toJobAttemptRow(run, job, watched.repoId);
      if (row) {
        buffer.push(row);
      } else {
        unfinished += 1;
      }
    }

    fetchedRuns.push({
      repoId: watched.repoId,
      githubRunId: run.id,
      updatedAt: new Date(run.updated_at),
    });

    if (buffer.length >= BATCH_SIZE) {
      // eslint-disable-next-line no-await-in-loop
      await flush();
    }
  }

  await flush();

  if (listed.etag) {
    await db
      .insert(resourceValidators)
      .values({ repoId: watched.repoId, resource: RUNS_LIST, etag: listed.etag })
      .onConflictDoUpdate({
        target: [resourceValidators.repoId, resourceValidators.resource],
        set: { etag: listed.etag },
      });
  }

  console.log(
    [
      `Runs seen:      ${runsSeen}`,
      `Runs skipped:   ${runsSkipped}`,
      `Jobs seen:      ${jobsSeen}`,
      `Rows inserted:  ${insertedRows}`,
      `Unfinished:     ${unfinished}`,
      `Already stored: ${jobsSeen - unfinished - insertedRows}`,
    ].join("\n"),
  );
  await printRateLimit(octoClient);

  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
