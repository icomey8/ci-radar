import { and, eq } from "drizzle-orm";
import { db, pool } from "./db.js";
import { fetchRunsWithJobs, installationIdForRepo, octokitForInstallation } from "./github.js";
import { type NewJobAttempt, toJobAttemptRow } from "./job-attempt.js";
import { jobAttempts, users, watchedRepos } from "./schema.js";

const BATCH_SIZE = 500;

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

  const [repo] = await db
    .select()
    .from(watchedRepos)
    .where(
      and(
        eq(watchedRepos.userId, user.id),
        eq(watchedRepos.owner, owner),
        eq(watchedRepos.name, name),
      ),
    )
    .limit(1);

  if (!repo) {
    throw new Error(`Not watching ${owner}/${name}. Run \`pnpm add-repo ${owner}/${name}\` first.`);
  }

  console.log(`Ingesting ${owner}/${name} (watched repo ${repo.id})`);

  const installationId = await installationIdForRepo(owner, name);
  const octoClient = await octokitForInstallation(installationId);

  const buffer: NewJobAttempt[] = [];
  let runsSeen = 0;
  let jobsSeen = 0;
  let unfinished = 0;
  let insertedRows = 0;

  async function flush() {
    if (buffer.length === 0) return;

    const written = await db
      .insert(jobAttempts)
      .values(buffer)
      .onConflictDoNothing()
      .returning({ id: jobAttempts.id });

    insertedRows += written.length;
    buffer.length = 0;
  }

  for await (const { run, jobs } of fetchRunsWithJobs(owner, name, octoClient)) {
    runsSeen += 1;

    for (const job of jobs) {
      jobsSeen += 1;
      const row = toJobAttemptRow(run, job, repo.id);
      if (row) {
        buffer.push(row);
      } else {
        unfinished += 1;
      }
    }

    if (buffer.length >= BATCH_SIZE) {
      // eslint-disable-next-line no-await-in-loop
      await flush();
    }
  }

  await flush();

  console.log(
    [
      `Runs seen:      ${runsSeen}`,
      `Jobs seen:      ${jobsSeen}`,
      `Rows inserted:  ${insertedRows}`,
      `Unfinished:     ${unfinished}`,
      `Already stored: ${jobsSeen - unfinished - insertedRows}`,
    ].join("\n"),
  );

  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
