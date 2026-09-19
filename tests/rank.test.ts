import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultRankConfig, rank, type RankAttempt, type RankedRow } from "../src/rank.js";

/** Builds `failures` failing attempts and `runs - failures` passing ones for one job. */
function history(jobName: string, runs: number, failures: number): RankAttempt[] {
  return Array.from({ length: runs }, (_, i) => ({
    workflowName: "ci",
    jobName,
    conclusion: i < failures ? "failure" : "success",
  }));
}

/**
 * `runs` attempts of one job, each carrying test results. `failuresByTest` gives
 * each test a failure count; the first that many attempts fail it, the rest pass.
 * The attempt itself fails whenever one of its tests did.
 */
function testHistory(
  jobName: string,
  runs: number,
  failuresByTest: Record<string, number>,
): RankAttempt[] {
  return Array.from({ length: runs }, (_, i) => {
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

function labels(rows: RankedRow[]): string[] {
  return rows.map((row) => (row.kind === "test" ? `${row.jobName}::${row.testName}` : row.jobName));
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
  assert.deepEqual(flaky, [
    { kind: "job", workflowName: "ci", jobName: "wobbly", runs: 20, failures: 4 },
  ]);
});

test("at the same failure rate, more runs ranks higher", () => {
  const { flaky } = rank([...history("quiet", 10, 2), ...history("busy", 40, 8)]);

  assert.deepEqual(labels(flaky), ["busy", "quiet"]);
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

  assert.deepEqual(labels(flaky), ["busy", "wobbly"]);
  assert.deepEqual(labels(broken), ["dead"]);
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
  assert.deepEqual(flaky, [
    { kind: "job", workflowName: "ci", jobName: "slow", runs: 20, failures: 4 },
  ]);
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
  assert.equal(
    rank(attempts, { ...defaultRankConfig, jobs: { ...defaultRankConfig.jobs, minRuns: 3 } }).flaky
      .length,
    1,
  );
});

test("where test results exist, the failing test is named instead of its job", () => {
  const { flaky, broken } = rank(testHistory("test", 20, { good: 0, wobbly: 4 }));

  assert.deepEqual(broken, []);
  assert.deepEqual(flaky, [
    {
      kind: "test",
      workflowName: "ci",
      jobName: "test",
      testName: "wobbly",
      runs: 20,
      failures: 4,
    },
  ]);
});

test("a job with no test results still ranks at the job level", () => {
  const { flaky } = rank([...testHistory("test", 20, { wobbly: 4 }), ...history("lint", 20, 6)]);

  assert.deepEqual(labels(flaky), ["lint", "test::wobbly"]);
  assert.deepEqual(
    flaky.map((row) => row.kind),
    ["job", "test"],
  );
});

test("a test flaky on one matrix version only keeps its own rate", () => {
  // Averaged across the three versions this is 8 of 60 — 13%, and the version
  // that is actually broken disappears into the two that are not.
  const { flaky } = rank([
    ...testHistory("test (3.11)", 20, { version_specific: 8 }),
    ...testHistory("test (3.12)", 20, { version_specific: 0 }),
    ...testHistory("test (3.13)", 20, { version_specific: 0 }),
  ]);

  assert.deepEqual(labels(flaky), ["test (3.11)::version_specific"]);
  assert.equal(flaky[0]?.failures, 8);
  assert.equal(flaky[0]?.runs, 20);
});

test("a test that always fails goes on the broken list, not the ranked list", () => {
  const { flaky, broken } = rank(testHistory("broken", 20, { always_broken: 20 }));

  assert.deepEqual(flaky, []);
  assert.deepEqual(labels(broken), ["broken::always_broken"]);
});

test("a skipped test is neither a run nor a failure", () => {
  const attempts: RankAttempt[] = Array.from({ length: 20 }, (_, i) => ({
    workflowName: "ci",
    jobName: "test",
    conclusion: i < 4 ? "failure" : "success",
    tests: [
      { name: "wobbly", outcome: i < 4 ? "fail" : "pass" },
      { name: "sometimes_skipped", outcome: i < 18 ? "skip" : "pass" },
    ],
  }));

  const { flaky } = rank(attempts);

  // sometimes_skipped ran twice, far under minRuns, so it is not ranked at all.
  assert.deepEqual(labels(flaky), ["test::wobbly"]);
});

test("test thresholds are tunable separately from job thresholds", () => {
  const attempts = [
    ...testHistory("test", 20, { barely: 1 }), // 5% exactly — at the default floor
    ...history("lint", 20, 1),
  ];

  assert.deepEqual(labels(rank(attempts).flaky), ["lint", "test::barely"]);

  const strictTests = {
    ...defaultRankConfig,
    tests: { ...defaultRankConfig.tests, failRateFloor: 0.1 },
  };
  assert.deepEqual(labels(rank(attempts, strictTests).flaky), ["lint"]);
});

test("tests and jobs are ranked against each other in one list", () => {
  const { flaky, broken } = rank([
    ...testHistory("test", 40, { stable: 0, rare: 1, main: 8, worst: 12 }),
    ...history("lint", 40, 10),
    ...history("deploy", 40, 40),
  ]);

  assert.deepEqual(labels(flaky), ["test::worst", "lint", "test::main"]);
  assert.deepEqual(labels(broken), ["deploy"]);
});
