import { and, eq } from "drizzle-orm";
import pLimit from "p-limit";
import { db, pool } from "../db.js";
import {
  coreRateLimit,
  countRuns,
  fetchJobsForRun,
  fetchRuns,
  installationIdForRepo,
  octokitForInstallation,
  shouldFetchJobs,
  type WorkflowRun,
} from "../github.js";
import { type NewJobAttempt, toJobAttemptRow } from "../job-attempt.js";
import {
  backfillProgress,
  ingestedRuns,
  jobAttempts,
  repos,
  users,
  watchedRepos,
} from "../schema.js";
import type { Octokit } from "octokit";

const USAGE = "Usage: pnpm backfill --repo <owner>/<name> --days <n>";
const GITHUB_RESULT_CAP = 1000;
const INITIAL_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const MIN_WINDOW_MS = 15 * 60 * 1000;
const JOB_FETCH_CONCURRENCY = 10;
const RATE_LIMIT_FLOOR = 100;

function parseFlags(argv: string[]): { owner: string; name: string; days: number } {
  const repoIndex = argv.indexOf("--repo");
  const repoValue = repoIndex === -1 ? undefined : argv[repoIndex + 1];
  if (!repoValue) {
    throw new Error(USAGE);
  }
  const parts = repoValue.split("/");
  const [owner, name] = parts;
  if (parts.length !== 2 || !owner || !name) {
    throw new Error(`Expected <owner>/<name>, got "${repoValue}"`);
  }

  const daysIndex = argv.indexOf("--days");
  const daysValue = daysIndex === -1 ? undefined : argv[daysIndex + 1];
  const days = Number(daysValue);
  if (!daysValue || !Number.isInteger(days) || days <= 0) {
    throw new Error(USAGE);
  }

  return { owner, name, days };
}

/** GitHub's created filter wants ISO 8601 without milliseconds. */
function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function createdRange(start: Date, end: Date): string {
  return `${isoSeconds(start)}..${isoSeconds(end)}`;
}

type Stats = {
  runsSeen: number;
  runsSkipped: number;
  jobsSeen: number;
  unfinished: number;
  insertedRows: number;
};

/**
 * Fetches one run's jobs and stores them, marking the run ingested in the same
 * transaction. The mark lands only after the jobs are on disk, so a crash
 * between concurrent runs can never leave a run marked but empty.
 */
async function ingestRun(
  owner: string,
  name: string,
  octoClient: Octokit,
  repoId: number,
  run: WorkflowRun,
  stats: Stats,
) {
  const jobs = await fetchJobsForRun(owner, name, octoClient, run.id);

  const rows: NewJobAttempt[] = [];
  for (const job of jobs) {
    stats.jobsSeen += 1;
    const row = toJobAttemptRow(run, job, repoId);
    if (row) {
      rows.push(row);
    } else {
      stats.unfinished += 1;
    }
  }

  await db.transaction(async (tx) => {
    if (rows.length > 0) {
      const written = await tx
        .insert(jobAttempts)
        .values(rows)
        .onConflictDoNothing()
        .returning({ id: jobAttempts.id });
      stats.insertedRows += written.length;
    }

    await tx
      .insert(ingestedRuns)
      .values({ repoId, githubRunId: run.id, updatedAt: new Date(run.updated_at) })
      .onConflictDoNothing();
  });
}

async function main() {
  const { owner, name, days } = parseFlags(process.argv.slice(2));

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

  const repoId = watched.repoId;

  let [progress] = await db
    .select()
    .from(backfillProgress)
    .where(eq(backfillProgress.repoId, repoId))
    .limit(1);

  if (progress?.done) {
    console.log(
      `Backfill for ${owner}/${name} already completed on ${progress.startedAt.toISOString()}. Nothing to do.`,
    );
    await pool.end();
    return;
  }

  if (progress) {
    console.log(
      `Resuming ${owner}/${name} from ${isoSeconds(progress.cursor)} ` +
        `(target ${isoSeconds(progress.targetDate)})`,
    );
  } else {
    const now = new Date();
    const targetDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    [progress] = await db
      .insert(backfillProgress)
      .values({ repoId, targetDate, cursor: now })
      .returning();
    console.log(`Backfilling ${owner}/${name} back ${days} days (to ${isoSeconds(targetDate)})`);
  }

  const { targetDate } = progress!;
  let cursor = progress!.cursor;

  const installationId = await installationIdForRepo(owner, name);
  const octoClient = await octokitForInstallation(installationId);

  const storedRuns = await db
    .select({ githubRunId: ingestedRuns.githubRunId, updatedAt: ingestedRuns.updatedAt })
    .from(ingestedRuns)
    .where(eq(ingestedRuns.repoId, repoId));
  const storedUpdatedAtByRunId = new Map(storedRuns.map((row) => [row.githubRunId, row.updatedAt]));

  const limit = pLimit(JOB_FETCH_CONCURRENCY);
  const stats: Stats = { runsSeen: 0, runsSkipped: 0, jobsSeen: 0, unfinished: 0, insertedRows: 0 };
  let windowMs = INITIAL_WINDOW_MS;

  while (cursor.getTime() > targetDate.getTime()) {
    const windowStart = new Date(Math.max(cursor.getTime() - windowMs, targetDate.getTime()));
    const range = createdRange(windowStart, cursor);

    // eslint-disable-next-line no-await-in-loop
    const total = await countRuns(owner, name, octoClient, range);

    if (total > GITHUB_RESULT_CAP && windowMs > MIN_WINDOW_MS) {
      windowMs = Math.max(Math.floor(windowMs / 2), MIN_WINDOW_MS);
      console.log(`Window ${range} has ${total} runs (over ${GITHUB_RESULT_CAP}) — narrowing`);
      continue;
    }
    if (total > GITHUB_RESULT_CAP) {
      console.warn(
        `Window ${range} has ${total} runs even at the minimum width; ` +
          `runs beyond the first ${GITHUB_RESULT_CAP} will be missed.`,
      );
    }

    // eslint-disable-next-line no-await-in-loop
    const listedRuns = await fetchRuns(owner, name, octoClient, {
      createdRange: range,
      maxNumOfRuns: GITHUB_RESULT_CAP,
    });
    if (listedRuns.notModified) {
      throw new Error("Unexpected 304 on a backfill request (no etag was sent)");
    }

    const toIngest = listedRuns.runs.filter((run) => {
      stats.runsSeen += 1;
      if (shouldFetchJobs(run, storedUpdatedAtByRunId.get(run.id))) {
        return true;
      }
      stats.runsSkipped += 1;
      return false;
    });

    // eslint-disable-next-line no-await-in-loop
    await Promise.all(
      toIngest.map((run) => limit(() => ingestRun(owner, name, octoClient, repoId, run, stats))),
    );
    for (const run of toIngest) {
      storedUpdatedAtByRunId.set(run.id, new Date(run.updated_at));
    }

    cursor = windowStart;
    // eslint-disable-next-line no-await-in-loop
    await db.update(backfillProgress).set({ cursor }).where(eq(backfillProgress.repoId, repoId));
    console.log(
      `Window ${range}: ${listedRuns.runs.length} runs — cursor now ${isoSeconds(cursor)}`,
    );

    if (total < GITHUB_RESULT_CAP / 4) {
      windowMs = Math.min(windowMs * 2, INITIAL_WINDOW_MS);
    }

    // eslint-disable-next-line no-await-in-loop
    const core = await coreRateLimit(octoClient);
    if (core.remaining < RATE_LIMIT_FLOOR) {
      const resetsAt = new Date(core.reset * 1000);
      console.log(
        `Rate limit nearly exhausted (${core.remaining}/${core.limit}); ` +
          `stopping. Re-run after ${resetsAt.toISOString()} to resume.`,
      );
      // eslint-disable-next-line no-await-in-loop
      await pool.end();
      return;
    }
  }

  await db.update(backfillProgress).set({ done: true }).where(eq(backfillProgress.repoId, repoId));

  console.log(
    [
      `Backfill complete.`,
      `Runs seen:      ${stats.runsSeen}`,
      `Runs skipped:   ${stats.runsSkipped}`,
      `Jobs seen:      ${stats.jobsSeen}`,
      `Rows inserted:  ${stats.insertedRows}`,
      `Unfinished:     ${stats.unfinished}`,
      `Already stored: ${stats.jobsSeen - stats.unfinished - stats.insertedRows}`,
    ].join("\n"),
  );

  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
