import { and, eq, gte } from "drizzle-orm";
import { db, pool } from "../db.js";
import { defaultRankConfig, rank, type RankAttempt, type RankConfig } from "../rank.js";
import { jobAttempts, repos, watchedRepos } from "../schema.js";
import { requireUser } from "./common.js";

/** All attempts for one repo inside the lookback window, in the shape `rank()` wants. */
async function grabAttempts(
  repoId: number,
  config: RankConfig = defaultRankConfig,
): Promise<RankAttempt[]> {
  const cutoff = new Date(Date.now() - config.daysBack * 24 * 60 * 60 * 1000);

  return db
    .select({
      workflowName: jobAttempts.workflowName,
      jobName: jobAttempts.jobName,
      conclusion: jobAttempts.conclusion,
    })
    .from(jobAttempts)
    .where(and(eq(jobAttempts.repoId, repoId), gte(jobAttempts.startedAt, cutoff)));
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

    for (const [i, job] of flaky.entries()) {
      const rate = ((job.failures / job.runs) * 100).toFixed(1);
      console.log(
        `  ${i + 1}. ${job.workflowName} / "${job.jobName}" — ` +
          `${job.failures} of ${job.runs} runs failed (${rate}%)`,
      );
    }

    if (broken.length > 0) {
      console.log("  Broken (failing almost every run):");
      for (const job of broken) {
        console.log(
          `    ${job.workflowName} / "${job.jobName}" — ` +
            `${job.failures} of ${job.runs} runs failed`,
        );
      }
    }
  }
}

await main();
await pool.end();
