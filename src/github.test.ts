import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RequestError, type Octokit } from "octokit";
import {
  countRuns,
  fetchRuns,
  shouldFetchJobs,
  type WorkflowJob,
  type WorkflowRun,
} from "./github.js";

type RunWithJobs = { run: WorkflowRun; jobs: WorkflowJob[] };

// Real responses for icomey8/flaky-test, saved by `pnpm record-fixtures`.
const fixtures: RunWithJobs[] = JSON.parse(
  readFileSync(new URL("./fixtures/runs-with-jobs.json", import.meta.url), "utf8"),
);

const runs = fixtures.map(({ run }) => run);
const firstRun = runs[0]!;

test("a run we have never stored gets its jobs fetched", () => {
  assert.equal(shouldFetchJobs(firstRun, undefined), true);
});

test("a run unchanged since we stored it is skipped", () => {
  assert.equal(shouldFetchJobs(firstRun, new Date(firstRun.updated_at)), false);
});

test("a re-run (newer updated_at than stored) gets re-fetched", () => {
  const beforeRerun = new Date(new Date(firstRun.updated_at).getTime() - 60_000);
  assert.equal(shouldFetchJobs(firstRun, beforeRerun), true);
});

function fakeClient(request: (route: string, params: Record<string, unknown>) => unknown) {
  return { request } as unknown as Octokit;
}

const notModifiedError = () =>
  new RequestError("Not modified", 304, {
    request: { method: "GET", url: "https://api.github.com/", headers: {} },
  });

test("fetchRuns returns the runs and the first page's etag", async () => {
  const client = fakeClient(() => ({
    data: { workflow_runs: runs },
    headers: { etag: 'W/"abc"' },
  }));

  const result = await fetchRuns("icomey8", "flaky-test", client);

  assert.equal(result.notModified, false);
  assert.ok(!result.notModified);
  assert.equal(result.runs.length, runs.length);
  assert.equal(result.etag, 'W/"abc"');
});

test("fetchRuns sends the stored etag and treats 304 as nothing-changed", async () => {
  let sentEtag: unknown;
  const client = fakeClient((_route, params) => {
    sentEtag = (params.headers as Record<string, string>)["if-none-match"];
    throw notModifiedError();
  });

  const result = await fetchRuns("icomey8", "flaky-test", client, { etag: 'W/"abc"' });

  assert.equal(sentEtag, 'W/"abc"');
  assert.equal(result.notModified, true);
});

test("fetchRuns caps the runs it returns at maxNumOfRuns", async () => {
  const client = fakeClient(() => ({
    data: { workflow_runs: runs },
    headers: { etag: 'W/"abc"' },
  }));

  const result = await fetchRuns("icomey8", "flaky-test", client, { maxNumOfRuns: 2 });

  assert.ok(!result.notModified);
  assert.equal(result.runs.length, 2);
});

test("fetchRuns passes a created-date range through to GitHub", async () => {
  let sentCreated: unknown;
  const client = fakeClient((_route, params) => {
    sentCreated = params.created;
    return {
      data: { workflow_runs: runs, total_count: runs.length },
      headers: { etag: 'W/"abc"' },
    };
  });

  const result = await fetchRuns("icomey8", "flaky-test", client, {
    createdRange: "2026-08-01..2026-08-15",
  });

  assert.equal(sentCreated, "2026-08-01..2026-08-15");
  assert.ok(!result.notModified);
});

test("fetchRuns omits the created parameter when no range is given", async () => {
  let sentCreated: unknown = "sentinel";
  const client = fakeClient((_route, params) => {
    sentCreated = params.created;
    return {
      data: { workflow_runs: runs, total_count: runs.length },
      headers: { etag: 'W/"abc"' },
    };
  });

  await fetchRuns("icomey8", "flaky-test", client);

  assert.equal(sentCreated, undefined);
});

test("fetchRuns reports GitHub's total match count, even when capped", async () => {
  const client = fakeClient(() => ({
    data: { workflow_runs: runs, total_count: 4321 },
    headers: { etag: 'W/"abc"' },
  }));

  const result = await fetchRuns("icomey8", "flaky-test", client, { maxNumOfRuns: 2 });

  assert.ok(!result.notModified);
  assert.equal(result.runs.length, 2);
  assert.equal(result.totalCount, 4321);
});

test("countRuns fetches one run but returns the window's total count", async () => {
  let sentParams: Record<string, unknown> = {};
  const client = fakeClient((_route, params) => {
    sentParams = params;
    return { data: { workflow_runs: runs.slice(0, 1), total_count: 1500 }, headers: {} };
  });

  const count = await countRuns("icomey8", "flaky-test", client, "2026-08-01..2026-08-15");

  assert.equal(count, 1500);
  assert.equal(sentParams.per_page, 1);
  assert.equal(sentParams.created, "2026-08-01..2026-08-15");
});

test("fetchRuns lets non-304 errors through", async () => {
  const client = fakeClient(() => {
    throw new RequestError("Server error", 500, {
      request: { method: "GET", url: "https://api.github.com/", headers: {} },
    });
  });

  await assert.rejects(fetchRuns("icomey8", "flaky-test", client), /Server error/);
});
