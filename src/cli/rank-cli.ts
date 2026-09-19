import { and, eq, gte } from "drizzle-orm";
import { db, pool } from "../db.js";
import {
  defaultRankConfig,
  rank,
  type RankAttempt,
  type RankConfig,
  type RankedRow,
  type RankTestResult,
} from "../rank.js";
import { jobAttempts, repos, testResults, watchedRepos } from "../schema.js";
import { requireUser } from "./common.js";

/**
 * All attempts for one repo inside the lookback window, each carrying whatever
 * per-test results were ingested for it, in the shape `rank()` wants.
 */
async function grabAttempts(
  repoId: number,
  config: RankConfig = defaultRankConfig,
): Promise<RankAttempt[]> {
  const cutoff = new Date(Date.now() - config.daysBack * 24 * 60 * 60 * 1000);
  const inWindow = and(eq(jobAttempts.repoId, repoId), gte(jobAttempts.startedAt, cutoff));

  const attempts = await db
    .select({
      id: jobAttempts.id,
      workflowName: jobAttempts.workflowName,
      jobName: jobAttempts.jobName,
      conclusion: jobAttempts.conclusion,
    })
    .from(jobAttempts)
    .where(inWindow);

  const results = await db
    .select({
      jobAttemptId: testResults.jobAttemptId,
      name: testResults.testName,
      outcome: testResults.outcome,
    })
    .from(testResults)
    .innerJoin(jobAttempts, eq(testResults.jobAttemptId, jobAttempts.id))
    .where(inWindow);

  const testsByAttempt = new Map<number, RankTestResult[]>();
  for (const result of results) {
    const forAttempt = testsByAttempt.get(result.jobAttemptId);
    if (forAttempt) {
      forAttempt.push(result);
    } else {
      testsByAttempt.set(result.jobAttemptId, [result]);
    }
  }

  const ranked: RankAttempt[] = [];
  for (const attempt of attempts) {
    const row: RankAttempt = {
      workflowName: attempt.workflowName,
      jobName: attempt.jobName,
      conclusion: attempt.conclusion,
    };

    const tests = testsByAttempt.get(attempt.id);
    if (tests) row.tests = tests;

    ranked.push(row);
  }

  return ranked;
}

/** `ci / "test (3.11)" :: tests.test_flaky::test_flaky [test]` */
function describe(row: RankedRow): string {
  const job = `${row.workflowName} / "${row.jobName}"`;
  return row.kind === "test" ? `${job} :: ${row.testName} [test]` : `${job} [job]`;
}

async function main() {
  const user = await requireUser();

  const watched = await db
    .select({ repoId: repos.id, owner: repos.owner, name: repos.name })
    .from(watchedRepos)
    .innerJoin(repos, eq(watchedRepos.repoId, repos.id))
    .where(eq(watchedRepos.userId, user.id));

  if (watched.length === 0) {
    console.log("No repos watched yet. Add one with `pnpm add-repo <owner>/<name>`.");
  }

  for (const repo of watched) {
    // eslint-disable-next-line no-await-in-loop
    const attempts = await grabAttempts(repo.repoId);
    const { flaky, broken } = rank(attempts);

    console.log(`\nrepo: ${repo.owner}/${repo.name}`);

    if (flaky.length === 0 && broken.length === 0) {
      console.log(`  nothing met the thresholds in the last ${defaultRankConfig.daysBack} days`);
      continue;
    }

    for (const [i, row] of flaky.entries()) {
      const rate = ((row.failures / row.runs) * 100).toFixed(1);
      console.log(
        `  ${i + 1}. ${describe(row)} — ${row.failures} of ${row.runs} runs failed (${rate}%)`,
      );
    }

    if (broken.length > 0) {
      console.log("  Broken (failing almost every run):");
      for (const row of broken) {
        console.log(`    ${describe(row)} — ${row.failures} of ${row.runs} runs failed`);
      }
    }
  }
}

await main();
await pool.end();
