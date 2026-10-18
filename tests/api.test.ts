import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { DrizzleQueryError } from "drizzle-orm";
import { createApp, type RankingSource } from "../src/api/app.js";
import type { RankingDto, RepoDto, RowDto } from "../src/api/dto.js";
import { rankingDto } from "../src/api/ranking-dto.js";
import type { RankAttempt } from "../src/rank.js";
import { isoSeconds } from "../src/time.js";

const fixtures = new URL("../macos/CIRadarKit/Sources/CIRadarKit/Fixtures/", import.meta.url);

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(name, fixtures), "utf8"));
}

function fakeSource(repos: RepoDto[], rankings: RankingDto[] = []): RankingSource {
  return {
    listRepos: async () => repos,
    ranking: async (repoId) => rankings.find((ranking) => ranking.repo.id === repoId) ?? null,
  };
}

function failingSource(error: unknown): RankingSource {
  const fail = async (): Promise<never> => {
    throw error;
  };
  return { listRepos: fail, ranking: fail };
}

/** `runs` attempts of a job without test results, the first `failures` of them failing. */
function jobRuns(workflowName: string, jobName: string, runs: number, failures: number) {
  return Array.from({ length: runs }, (_, i): RankAttempt => ({
    workflowName,
    jobName,
    conclusion: i < failures ? "failure" : "success",
  }));
}

/** `runs` attempts of a job reporting every test in `failuresByTest`, each failing its first N runs. */
function testRuns(
  workflowName: string,
  jobName: string,
  runs: number,
  failuresByTest: Record<string, number>,
) {
  return Array.from({ length: runs }, (_, i): RankAttempt => {
    const tests = Object.entries(failuresByTest).map(([name, failures]) => ({
      name,
      outcome: i < failures ? "fail" : "pass",
    }));
    return {
      workflowName,
      jobName,
      conclusion: tests.some((result) => result.outcome === "fail") ? "failure" : "success",
      tests,
    };
  });
}

const longTestName =
  "tests/integration/test_webhooks.py::TestStripeSignature::test_rejects_replayed_events_outside_the_tolerance_window";

/**
 * The `ranking` scenario's repos, each ranked by the real `rank()` from attempts
 * listed out of order, so the fixtures pin down its ordering and counts too.
 */
const scenarioRankings = [
  rankingDto(
    {
      id: 1,
      owner: "icomey8",
      name: "flaky-test",
      latestDataAt: isoSeconds(new Date("2026-10-12T09:41:07.004Z")),
    },
    [
      ...jobRuns("release", "publish-docs", 20, 19),
      ...testRuns("ci", "test (3.12)", 47, {
        "tests.test_cache::test_eviction_order": 3,
        [longTestName]: 4,
      }),
      ...jobRuns("e2e", "playwright (chromium)", 31, 6),
      ...testRuns("ci", "test (3.11)", 48, { "tests.test_net::test_retry_timeout": 9 }),
      // Healthy, or too few runs to rank: none of these appear.
      ...jobRuns("ci", "lint", 48, 0),
      ...jobRuns("nightly", "soak", 6, 3),
    ],
  ),
  rankingDto(
    {
      id: 2,
      owner: "icomey8",
      name: "quiet-lib",
      latestDataAt: isoSeconds(new Date("2026-10-11T22:15:30.512Z")),
    },
    [...jobRuns("ci", "test", 30, 1), ...jobRuns("ci", "release", 4, 4)],
  ),
  rankingDto(
    {
      id: 3,
      owner: "icomey8",
      name: "payments-service",
      latestDataAt: isoSeconds(new Date("2026-10-12T08:02:55.999Z")),
    },
    [
      ...testRuns("ci", "unit", 52, { "tests/test_refunds.py::test_partial_refund_rounding": 3 }),
      ...jobRuns("ci", "integration (postgres)", 40, 5),
    ],
  ),
  rankingDto({ id: 4, owner: "octo-org", name: "new-service", latestDataAt: null }, []),
];

test("GET /repos matches the repos.json contract fixture, ordered by owner then name", async () => {
  // Deliberately out of order: the API, not the source, owns the ordering.
  const repos = scenarioRankings.map((ranking) => ranking.repo).toReversed();

  const response = await createApp(fakeSource(repos)).request("/repos");

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
  assert.deepEqual(await response.json(), await fixture("repos.json"));
});

for (const [name, id] of [
  ["ranking-ranking.json", 1],
  ["ranking-nothing-flaky.json", 2],
  ["ranking-flaky-only.json", 3],
  ["ranking-not-ingested.json", 4],
] as const) {
  test(`GET /repos/${id}/ranking matches the ${name} contract fixture`, async () => {
    const response = await createApp(fakeSource([], scenarioRankings)).request(
      `/repos/${id}/ranking`,
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
    assert.deepEqual(await response.json(), await fixture(name));
  });
}

/** `count` made-up rows whose failures climb while their names count down. */
function unsortedRows(kind: "job" | "test", count: number): RowDto[] {
  return Array.from({ length: count }, (_, i) => ({
    kind,
    workflowName: "ci",
    jobName: `job ${count - i}`,
    testName: kind === "test" ? `test ${count - i}` : null,
    failures: i,
    runs: 10,
  }));
}

test("ranking rows keep the source's order and send job rows' testName as null", async () => {
  // Deliberately in no sorted order: the API passes rank()'s order through untouched.
  const ranking: RankingDto = {
    repo: {
      id: 7,
      owner: "o",
      name: "n",
      latestDataAt: null,
      flakyCount: 3,
      brokenCount: 2,
    },
    daysBack: 14,
    flaky: unsortedRows("test", 3),
    broken: unsortedRows("job", 2),
  };

  const response = await createApp(fakeSource([], [ranking])).request("/repos/7/ranking");

  assert.deepEqual(await response.json(), ranking);
});

test("an unknown repo's ranking matches the error-repo-not-found.json contract fixture", async () => {
  const response = await createApp(fakeSource([], scenarioRankings)).request("/repos/42/ranking");

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), await fixture("error-repo-not-found.json"));
});

for (const [why, id] of [
  ["an unknown id", "99"],
  ["a non-numeric id", "abc"],
  ["a partly numeric id", "1abc"],
  ["a fractional id", "1.0"],
  ["an id beyond Postgres' integer range", "2147483648"],
]) {
  test(`GET /repos/:id/ranking with ${why} is a 404 repo_not_found`, async () => {
    const response = await createApp(fakeSource([], scenarioRankings)).request(
      `/repos/${id}/ranking`,
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: { code: "repo_not_found", message: `Repo ${id} is not watched.` },
    });
  });
}

test("GET /repos/:id/ranking for a repo the user doesn't watch is a 404 repo_not_found", async () => {
  // The live source answers null for a repo that exists but isn't watched.
  const unwatched: RankingSource = { listRepos: async () => [], ranking: async () => null };

  const response = await createApp(unwatched).request("/repos/1/ranking");

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: { code: "repo_not_found", message: "Repo 1 is not watched." },
  });
});

test("a failing ranking is a 500 internal", async (t) => {
  t.mock.method(console, "error", () => {});
  const app = createApp(failingSource(new Error("No user found. Run `pnpm seed` first.")));

  const response = await app.request("/repos/1/ranking");

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: { code: "internal", message: "No user found. Run `pnpm seed` first." },
  });
});

test("GET /repos with nothing watched matches the repos-empty.json contract fixture", async () => {
  const response = await createApp(fakeSource([])).request("/repos");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), await fixture("repos-empty.json"));
});

test("an unseeded database is a 500 matching the error-internal.json contract fixture", async (t) => {
  t.mock.method(console, "error", () => {});
  const app = createApp(failingSource(new Error("No user found. Run `pnpm seed` first.")));

  const response = await app.request("/repos");

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), await fixture("error-internal.json"));
});

test("Postgres being down is a 500 internal naming the refused connection", async (t) => {
  t.mock.method(console, "error", () => {});
  // What drizzle throws when every address for localhost refuses the connection.
  const refused = new DrizzleQueryError(
    'select "id", "created_at" from "users" limit $1',
    [1],
    new AggregateError(
      [
        new Error("connect ECONNREFUSED ::1:5432"),
        new Error("connect ECONNREFUSED 127.0.0.1:5432"),
      ],
      "",
    ),
  );

  const response = await createApp(failingSource(refused)).request("/repos");

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: { code: "internal", message: "connect ECONNREFUSED ::1:5432" },
  });
});

test("a failure with no message still gets one", async (t) => {
  t.mock.method(console, "error", () => {});

  const response = await createApp(failingSource(new Error())).request("/repos");

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: { code: "internal", message: "Internal error." },
  });
});

test("an unknown route is a 404 in the error shape", async () => {
  const response = await createApp(fakeSource([])).request("/nope");

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: { code: "not_found", message: "No route for GET /nope." },
  });
});

test("timestamps are ISO-8601 UTC to the second", () => {
  assert.equal(isoSeconds(new Date("2026-10-12T09:41:07.004Z")), "2026-10-12T09:41:07Z");
});
