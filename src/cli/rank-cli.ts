import { eq } from "drizzle-orm";
import { db, pool } from "../db.js";
import { defaultRankConfig, rank, type RankedRow } from "../rank.js";
import { grabAttempts } from "../ranking.js";
import { repos, watchedRepos } from "../schema.js";
import { requireUser } from "./common.js";

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
