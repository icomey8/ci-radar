import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { WorkflowJob, WorkflowRun } from "./github.js";
import { toJobAttemptRow } from "./job-attempt.js";

type RunWithJobs = { run: WorkflowRun; jobs: WorkflowJob[] };

// Real responses for icomey8/flaky-test, saved by `pnpm record-fixtures`.
const fixtures: RunWithJobs[] = JSON.parse(
  readFileSync(new URL("./fixtures/runs-with-jobs.json", import.meta.url), "utf8"),
);

const first = fixtures[0]!;
const firstJob = first.jobs[0]!;

test("maps a completed job onto a row", () => {
  const row = toJobAttemptRow(first.run, firstJob, 7);

  assert.deepEqual(row, {
    repoId: 7,
    githubJobId: firstJob.id,
    githubRunId: first.run.id,
    runAttempt: firstJob.run_attempt ?? 1,
    workflowName: first.run.name,
    jobName: firstJob.name,
    headSha: first.run.head_sha,
    conclusion: firstJob.conclusion,
    startedAt: new Date(firstJob.started_at),
    completedAt: new Date(firstJob.completed_at!),
  });
});

test("keeps the distinct job names", () => {
  const names = new Set(
    fixtures
      .flatMap(({ run, jobs }) => jobs.map((job) => toJobAttemptRow(run, job, 1)))
      .filter((row) => row !== null)
      .map((row) => row.jobName),
  );

  assert.ok(names.has("test (3.11)"));
  assert.ok(names.has("test (3.12)"));
  assert.ok(names.has("test (3.13)"));
});

test("a re-run becomes its own row rather than replacing the original", () => {
  const original = toJobAttemptRow(first.run, firstJob, 1)!;
  const rerun = toJobAttemptRow(
    first.run,
    { ...firstJob, id: firstJob.id + 1, run_attempt: 2, conclusion: "failure" },
    1,
  )!;

  assert.notEqual(rerun.githubJobId, original.githubJobId);
  assert.equal(rerun.runAttempt, 2);
  assert.equal(rerun.jobName, original.jobName);
  assert.equal(rerun.headSha, original.headSha);
});

test("skips jobs that have not finished", () => {
  const running: WorkflowJob = {
    ...firstJob,
    status: "in_progress",
    conclusion: null,
    completed_at: null,
  };

  assert.equal(toJobAttemptRow(first.run, running, 1), null);
});

test("falls back to the workflow file path when the workflow has no name", () => {
  const row = toJobAttemptRow({ ...first.run, name: null }, firstJob, 1);

  assert.equal(row?.workflowName, first.run.path);
});
