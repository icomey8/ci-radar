import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultRankConfig, rank, type RankAttempt } from "./rank.js";

/** Builds `failures` failing attempts and `runs - failures` passing ones for one job. */
function history(jobName: string, runs: number, failures: number): RankAttempt[] {
  return Array.from({ length: runs }, (_, i) => ({
    workflowName: "ci",
    jobName,
    conclusion: i < failures ? "failure" : "success",
  }));
}

test("too few runs produces nothing", () => {
  const { flaky, broken } = rank(history("sparse", 5, 3));

  assert.deepEqual(flaky, []);
  assert.deepEqual(broken, []);
});

test("failing below the floor produces nothing", () => {
  const { flaky, broken } = rank(history("steady", 100, 2));

  assert.deepEqual(flaky, []);
  assert.deepEqual(broken, []);
});

test("a job that never fails never appears", () => {
  const { flaky, broken } = rank(history("solid", 50, 0));

  assert.deepEqual(flaky, []);
  assert.deepEqual(broken, []);
});

test("an always-failing job goes on the broken list, not the ranked list", () => {
  const { flaky, broken } = rank(history("dead", 20, 20));

  assert.deepEqual(flaky, []);
  assert.equal(broken.length, 1);
  assert.equal(broken[0]?.jobName, "dead");
});

test("an ordinary flaky job is ranked with the expected tally", () => {
  const { flaky, broken } = rank(history("wobbly", 20, 4));

  assert.deepEqual(broken, []);
  assert.deepEqual(flaky, [{ workflowName: "ci", jobName: "wobbly", runs: 20, failures: 4 }]);
});

test("at the same failure rate, more runs ranks higher", () => {
  const { flaky } = rank([...history("quiet", 10, 2), ...history("busy", 40, 8)]);

  assert.deepEqual(
    flaky.map((job) => job.jobName),
    ["busy", "quiet"],
  );
});

test("a mixed history comes out in exactly the right order", () => {
  const { flaky, broken } = rank([
    ...history("sparse", 5, 3),
    ...history("steady", 100, 2),
    ...history("solid", 50, 0),
    ...history("dead", 20, 20),
    ...history("wobbly", 20, 4),
    ...history("busy", 40, 8),
  ]);

  assert.deepEqual(
    flaky.map((job) => job.jobName),
    ["busy", "wobbly"],
  );
  assert.deepEqual(
    broken.map((job) => job.jobName),
    ["dead"],
  );
});

test("cancelled and skipped attempts do not count as runs; timeouts count as failures", () => {
  const cancelled: RankAttempt[] = Array.from({ length: 30 }, () => ({
    workflowName: "ci",
    jobName: "halted",
    conclusion: "cancelled",
  }));
  const timedOut: RankAttempt[] = Array.from({ length: 20 }, (_, i) => ({
    workflowName: "ci",
    jobName: "slow",
    conclusion: i < 4 ? "timed_out" : "success",
  }));

  const { flaky, broken } = rank([...cancelled, ...timedOut]);

  assert.deepEqual(broken, []);
  assert.deepEqual(flaky, [{ workflowName: "ci", jobName: "slow", runs: 20, failures: 4 }]);
});

test("same job name under different workflows tallies separately", () => {
  const nightly: RankAttempt[] = Array.from({ length: 20 }, (_, i) => ({
    workflowName: "nightly",
    jobName: "test",
    conclusion: i < 4 ? "failure" : "success",
  }));

  const { flaky } = rank([...history("test", 20, 4), ...nightly]);

  assert.equal(flaky.length, 2);
});

test("thresholds come from the config, not the code", () => {
  const attempts = history("sparse", 5, 3);

  assert.deepEqual(rank(attempts).flaky, []);
  assert.equal(rank(attempts, { ...defaultRankConfig, minRuns: 3 }).flaky.length, 1);
});
