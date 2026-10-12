import { and, eq, gte } from "drizzle-orm";
import { db } from "./db.js";
import {
  defaultRankConfig,
  type RankAttempt,
  type RankConfig,
  type RankTestResult,
} from "./rank.js";
import { jobAttempts, testResults } from "./schema.js";

/**
 * All attempts for one repo inside the lookback window, each carrying whatever
 * per-test results were ingested for it, in the shape `rank()` wants.
 */
export async function grabAttempts(
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
