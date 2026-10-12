import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { DrizzleQueryError } from "drizzle-orm";
import { createApp, type RankingSource } from "../src/api/app.js";
import { toApiTimestamp, type RepoDto } from "../src/api/dto.js";

const fixtures = new URL("../macos/CIRadarKit/Sources/CIRadarKit/Fixtures/", import.meta.url);

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(name, fixtures), "utf8"));
}

function fakeSource(repos: RepoDto[]): RankingSource {
  return { listRepos: async () => repos };
}

function failingSource(error: unknown): RankingSource {
  return {
    listRepos: async () => {
      throw error;
    },
  };
}

test("GET /repos matches the repos.json contract fixture, ordered by owner then name", async () => {
  // Deliberately out of order: the API, not the source, owns the ordering.
  const app = createApp(
    fakeSource([
      {
        id: 4,
        owner: "octo-org",
        name: "new-service",
        latestDataAt: null,
        flakyCount: 0,
        brokenCount: 0,
      },
      {
        id: 2,
        owner: "icomey8",
        name: "quiet-lib",
        latestDataAt: toApiTimestamp(new Date("2026-10-11T22:15:30.512Z")),
        flakyCount: 0,
        brokenCount: 0,
      },
      {
        id: 1,
        owner: "icomey8",
        name: "flaky-test",
        latestDataAt: toApiTimestamp(new Date("2026-10-12T09:41:07.004Z")),
        flakyCount: 4,
        brokenCount: 1,
      },
      {
        id: 3,
        owner: "icomey8",
        name: "payments-service",
        latestDataAt: toApiTimestamp(new Date("2026-10-12T08:02:55.999Z")),
        flakyCount: 2,
        brokenCount: 0,
      },
    ]),
  );

  const response = await app.request("/repos");

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
  assert.deepEqual(await response.json(), await fixture("repos.json"));
});

test("GET /repos with nothing watched returns an empty list", async () => {
  const response = await createApp(fakeSource([])).request("/repos");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { repos: [] });
});

test("an unseeded database is a 500 internal carrying the seed hint", async (t) => {
  t.mock.method(console, "error", () => {});
  const app = createApp(failingSource(new Error("No user found. Run `pnpm seed` first.")));

  const response = await app.request("/repos");

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: { code: "internal", message: "No user found. Run `pnpm seed` first." },
  });
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
  assert.equal(toApiTimestamp(new Date("2026-10-12T09:41:07.004Z")), "2026-10-12T09:41:07Z");
});
