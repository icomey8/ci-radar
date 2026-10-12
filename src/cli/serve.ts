import { PgBoss } from "pg-boss";
import { eq } from "drizzle-orm";
import { db, pool } from "../db.js";
import { env } from "../env.js";
import { githubApp, octokitForRepo } from "../github.js";
import { ingestRepo } from "../ingest.js";
import { repos, watchedRepos } from "../schema.js";
import { log, onShutdown } from "./common.js";

const TICK = "tick";
const INGEST_REPO = "ingest-repo";
const TICK_CRON = "0 * * * *";

interface IngestJobData {
  repoId: number;
}

async function registerTickWorker(boss: PgBoss) {
  await boss.work(TICK, async () => {
    const watched = await db.selectDistinct({ repoId: watchedRepos.repoId }).from(watchedRepos);
    for (const { repoId } of watched) {
      // eslint-disable-next-line no-await-in-loop
      await boss.send(INGEST_REPO, { repoId }, { singletonKey: String(repoId) });
    }
  });
}

async function registerIngestWorker(boss: PgBoss) {
  await boss.work<IngestJobData>(INGEST_REPO, async (jobs) => {
    for (const job of jobs) {
      const { repoId } = job.data;

      // eslint-disable-next-line no-await-in-loop
      const [repo] = await db
        .select({ owner: repos.owner, name: repos.name })
        .from(repos)
        .where(eq(repos.id, repoId))
        .limit(1);

      if (!repo) {
        log(`repo ${repoId} is gone from the database — skipping`);
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const octoClient = await octokitForRepo(repo.owner, repo.name);
      // eslint-disable-next-line no-await-in-loop
      const stats = await ingestRepo(repoId, repo.owner, repo.name, octoClient);

      if (stats.notModified) {
        log(`${repo.owner}/${repo.name}: unchanged (304)`);
      } else {
        log(
          `${repo.owner}/${repo.name}: ${stats.runsSeen} runs seen, ` +
            `${stats.runsSkipped} skipped, ${stats.insertedRows} job rows, ` +
            `${stats.testStats.testsInserted} test results`,
        );
      }
    }
  });
}

async function main() {
  // Fail now rather than on the first hourly ingest if the App credentials are missing.
  githubApp();

  const boss = new PgBoss(env.databaseUrl);
  boss.on("error", (error) => console.error(error));

  await boss.start();

  // One queued tick at a time; a stalled worker must not build a backlog of ticks.
  await boss.createQueue(TICK, { policy: "short" });

  await boss.createQueue(INGEST_REPO, {
    policy: "stately",
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
  });

  await boss.schedule(TICK, TICK_CRON);

  await registerTickWorker(boss);
  await registerIngestWorker(boss);

  log("serving — ticking hourly over watched repos");

  onShutdown(async () => {
    await boss.stop({ graceful: true });
    await pool.end();
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
