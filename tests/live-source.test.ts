/**
 * The live `RankingSource` against a real Postgres: the SQL behind `GET /repos`
 * and `GET /repos/:id/ranking`. Skipped unless `TEST_DATABASE_URL` is set, so
 * `pnpm test` stays offline. It migrates that database and truncates every
 * table, so point it at a throwaway one, e.g. on the docker Postgres:
 *
 *   docker compose exec db createdb -U postgres ci_radar_test
 *   TEST_DATABASE_URL=postgres://postgres:local@localhost:5432/ci_radar_test pnpm test
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { config as loadDotenv } from "dotenv";
import { sql } from "drizzle-orm";
import { createApp } from "../src/api/app.js";
import type { RepoDto, RowDto } from "../src/api/dto.js";
import { rankingDto } from "../src/api/ranking-dto.js";
import type { RankAttempt } from "../src/rank.js";
import { jobAttempts, repos, testResults, users, watchedRepos } from "../src/schema.js";
import { isoSeconds } from "../src/time.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

/** Whole seconds, so timestamps survive `isoSeconds()` unchanged. */
const now = new Date(Math.floor(Date.now() / 1000) * 1000);

function hoursAgo(hours: number): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

function daysAgo(days: number): Date {
  return hoursAgo(days * 24);
}

/** `runs` attempts of a job without test results, the first `failures` of them failing. */
function jobRuns(jobName: string, runs: number, failures: number) {
  return Array.from({ length: runs }, (_, i): RankAttempt => ({
    workflowName: "ci",
    jobName,
    conclusion: i < failures ? "failure" : "success",
  }));
}

/** `runs` attempts of a job reporting every test in `failuresByTest`, each failing its first N runs. */
function testRuns(jobName: string, runs: number, failuresByTest: Record<string, number>) {
  return Array.from({ length: runs }, (_, i): RankAttempt => {
    const tests = Object.entries(failuresByTest).map(([name, failures]) => ({
      name,
      outcome: i < failures ? "fail" : "pass",
    }));
    return {
      workflowName: "ci",
      jobName,
      conclusion: tests.some((result) => result.outcome === "fail") ? "failure" : "success",
      tests,
    };
  });
}

function label(row: RowDto): string {
  return row.testName ? `${row.jobName}::${row.testName}` : row.jobName;
}

/**
 * Imports the database modules only now, once `DATABASE_URL` names the test
 * database: `db.ts` opens its pool at import time.
 */
async function openTestDatabase(url: string) {
  // Only now, so a TEST_DATABASE_URL in .env can't make a plain `pnpm test` truncate it.
  loadDotenv();
  assert.notEqual(
    url,
    process.env.DATABASE_URL,
    "TEST_DATABASE_URL must not be DATABASE_URL: this test truncates every table.",
  );
  process.env.DATABASE_URL = url;

  const { db, pool } = await import("../src/db.js");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const { liveRankingSource } = await import("../src/api/live-source.js");

  try {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
    // Every other table cascades from these two, so re-runs start empty.
    await db.execute(sql`truncate table ${users}, ${repos} restart identity cascade`);
  } catch (error) {
    await pool.end();
    throw error;
  }

  let nextGithubJobId = 1;

  return {
    pool,
    app: createApp(liveRankingSource),

    async addRepo(owner: string, name: string, watchedBy?: number) {
      const [repo] = await db.insert(repos).values({ owner, name }).returning();
      if (watchedBy !== undefined) {
        await db.insert(watchedRepos).values({ userId: watchedBy, repoId: repo!.id });
      }
      return repo!.id;
    },

    async addUser() {
      const [user] = await db.insert(users).values({}).returning();
      return user!.id;
    },

    async addAttempts(
      repoId: number,
      attempts: RankAttempt[],
      at: { startedAt: Date; ingestedAt: Date; testsIngestedAt?: Date },
    ) {
      const seeded = attempts.map((attempt) => ({ attempt, githubJobId: nextGithubJobId++ }));
      const inserted = await db
        .insert(jobAttempts)
        .values(
          seeded.map(({ attempt, githubJobId }) => ({
            repoId,
            githubJobId,
            githubRunId: githubJobId,
            runAttempt: 1,
            workflowName: attempt.workflowName,
            jobName: attempt.jobName,
            headSha: "0000000",
            conclusion: attempt.conclusion,
            startedAt: at.startedAt,
            completedAt: at.startedAt,
            ingestedAt: at.ingestedAt,
          })),
        )
        .returning({ id: jobAttempts.id, githubJobId: jobAttempts.githubJobId });

      const idByGithubJobId = new Map(inserted.map((row) => [row.githubJobId, row.id]));
      const results = seeded.flatMap(({ attempt, githubJobId }) =>
        (attempt.tests ?? []).map((result) => ({
          jobAttemptId: idByGithubJobId.get(githubJobId)!,
          testName: result.name,
          outcome: result.outcome,
          ingestedAt: at.testsIngestedAt ?? at.ingestedAt,
        })),
      );
      if (results.length) await db.insert(testResults).values(results);
    },
  };
}

test(
  "live ranking source against Postgres",
  { skip: testDatabaseUrl ? false : "TEST_DATABASE_URL is not set" },
  async (t) => {
    const database = await openTestDatabase(testDatabaseUrl!);

    /** The attempts `acme/ranked` has inside the ranking window. */
    const rankedInWindow = [
      ...jobRuns("lint", 10, 2),
      ...jobRuns("build", 10, 10),
      ...testRuns("test", 10, { test_a: 3, test_b: 10, test_c: 0 }),
    ];

    try {
      const userId = await database.addUser();

      // Inserted out of order: the API sorts by owner, then name.
      const neverIngestedId = await database.addRepo("beta", "never-ingested", userId);
      const staleId = await database.addRepo("acme", "stale", userId);
      const rankedId = await database.addRepo("acme", "ranked", userId);
      const unwatchedId = await database.addRepo("acme", "unwatched");

      await database.addAttempts(rankedId, rankedInWindow, {
        startedAt: daysAgo(1),
        ingestedAt: hoursAgo(5),
        // Later than any attempt, but test results don't count toward latestDataAt.
        testsIngestedAt: now,
      });
      // Outside the window, so not ranked — yet the most recently ingested.
      await database.addAttempts(rankedId, jobRuns("lint", 10, 10), {
        startedAt: daysAgo(30),
        ingestedAt: hoursAgo(1),
      });

      // Broken, but only outside the window.
      await database.addAttempts(staleId, jobRuns("deploy", 10, 10), {
        startedAt: daysAgo(20),
        ingestedAt: hoursAgo(2),
      });

      await database.addAttempts(unwatchedId, jobRuns("lint", 10, 5), {
        startedAt: daysAgo(1),
        ingestedAt: hoursAgo(1),
      });

      await t.test(
        "GET /repos lists watched repos with all-time latestDataAt and windowed counts",
        async () => {
          const response = await database.app.request("/repos");

          assert.equal(response.status, 200);
          assert.deepEqual(await response.json(), {
            repos: [
              {
                id: rankedId,
                owner: "acme",
                name: "ranked",
                latestDataAt: isoSeconds(hoursAgo(1)),
                flakyCount: 2,
                brokenCount: 2,
              },
              {
                id: staleId,
                owner: "acme",
                name: "stale",
                latestDataAt: isoSeconds(hoursAgo(2)),
                flakyCount: 0,
                brokenCount: 0,
              },
              {
                id: neverIngestedId,
                owner: "beta",
                name: "never-ingested",
                latestDataAt: null,
                flakyCount: 0,
                brokenCount: 0,
              },
            ] satisfies RepoDto[],
          });
        },
      );

      await t.test(
        "GET /repos/:id/ranking matches rank() over the in-window attempts",
        async () => {
          const response = await database.app.request(`/repos/${rankedId}/ranking`);

          assert.equal(response.status, 200);
          const expected = rankingDto(
            { id: rankedId, owner: "acme", name: "ranked", latestDataAt: isoSeconds(hoursAgo(1)) },
            rankedInWindow,
          );
          assert.deepEqual(await response.json(), expected);

          // Guard against both sides being trivially empty.
          assert.deepEqual(expected.flaky.map(label), ["test::test_a", "lint"]);
          assert.deepEqual(expected.broken.map(label), ["build", "test::test_b"]);
        },
      );

      await t.test("GET /repos/:id/ranking is 404 for a repo the user doesn't watch", async () => {
        const response = await database.app.request(`/repos/${unwatchedId}/ranking`);

        assert.equal(response.status, 404);
      });
    } finally {
      await database.pool.end();
    }
  },
);
