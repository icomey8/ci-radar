import { and, eq, sql } from "drizzle-orm";
import { db } from "./db.js";
import { fetchJobsForRun, fetchRuns, shouldFetchJobs } from "./github.js";
import type { Octokit } from "octokit";
import { type NewJobAttempt, toJobAttemptRow } from "./job-attempt.js";
import { ingestedRuns, jobAttempts, resourceValidators } from "./schema.js";
import {
  addTestResultStats,
  emptyTestResultStats,
  ingestTestResultsForRun,
  type TestResultStats,
} from "./test-results.js";

const RUNS_LIST = "runs-list";

export interface IngestStats {
  notModified: boolean;
  runsSeen: number;
  runsSkipped: number;
  jobsSeen: number;
  insertedRows: number;
  unfinished: number;
  testStats: TestResultStats;
}

/**
 * Runs one ingest pass over a repo: list runs, fetch jobs for the ones that
 * changed, record job attempts and test results. Callers own the process:
 * this never closes the pool, prints, or exits, and errors propagate so a
 * job runner can retry.
 */
export async function ingestRepo(
  repoId: number,
  owner: string,
  name: string,
  octoClient: Octokit,
): Promise<IngestStats> {
  const [validator] = await db
    .select({ etag: resourceValidators.etag })
    .from(resourceValidators)
    .where(and(eq(resourceValidators.repoId, repoId), eq(resourceValidators.resource, RUNS_LIST)))
    .limit(1);

  const listed = await fetchRuns(owner, name, octoClient, { etag: validator?.etag ?? null });

  if (listed.notModified) {
    return {
      notModified: true,
      runsSeen: 0,
      runsSkipped: 0,
      jobsSeen: 0,
      insertedRows: 0,
      unfinished: 0,
      testStats: emptyTestResultStats(),
    };
  }

  const storedRuns = await db
    .select({ githubRunId: ingestedRuns.githubRunId, updatedAt: ingestedRuns.updatedAt })
    .from(ingestedRuns)
    .where(eq(ingestedRuns.repoId, repoId));

  const storedUpdatedAtByRunId = new Map(storedRuns.map((row) => [row.githubRunId, row.updatedAt]));
  let runsSeen = 0;
  let runsSkipped = 0;
  let jobsSeen = 0;
  let unfinished = 0;
  let insertedRows = 0;
  const testStats = emptyTestResultStats();

  for (const run of listed.runs) {
    runsSeen += 1;

    if (!shouldFetchJobs(run, storedUpdatedAtByRunId.get(run.id))) {
      runsSkipped += 1;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const jobs = await fetchJobsForRun(owner, name, octoClient, run.id);

    const rows: NewJobAttempt[] = [];
    for (const job of jobs) {
      jobsSeen += 1;
      const row = toJobAttemptRow(run, job, repoId);
      if (row) {
        rows.push(row);
      } else {
        unfinished += 1;
      }
    }

    if (rows.length > 0) {
      // eslint-disable-next-line no-await-in-loop
      const written = await db
        .insert(jobAttempts)
        .values(rows)
        .onConflictDoNothing()
        .returning({ id: jobAttempts.id });

      insertedRows += written.length;
    }

    // eslint-disable-next-line no-await-in-loop
    await db
      .insert(ingestedRuns)
      .values({ repoId, githubRunId: run.id, updatedAt: new Date(run.updated_at) })
      .onConflictDoUpdate({
        target: [ingestedRuns.repoId, ingestedRuns.githubRunId],
        set: { updatedAt: sql`excluded.updated_at` },
      });

    // Artifact matching needs this run's job attempts in the database first.
    // eslint-disable-next-line no-await-in-loop
    const runStats = await ingestTestResultsForRun(owner, name, octoClient, repoId, run.id);
    addTestResultStats(testStats, runStats);
  }

  if (listed.etag) {
    await db
      .insert(resourceValidators)
      .values({ repoId, resource: RUNS_LIST, etag: listed.etag })
      .onConflictDoUpdate({
        target: [resourceValidators.repoId, resourceValidators.resource],
        set: { etag: listed.etag },
      });
  }

  return {
    notModified: false,
    runsSeen,
    runsSkipped,
    jobsSeen,
    insertedRows,
    unfinished,
    testStats,
  };
}
