import assert from "node:assert/strict";
import { test } from "node:test";
import {
  matchArtifactToJobName,
  parseJobName,
  pickAttemptForArtifact,
} from "../src/test-results.js";

// The fixture repo's real job names.
const FIXTURE_JOBS = ["test (3.11)", "test (3.12)", "test (3.13)", "broken"];

test("parseJobName splits a matrix job into base and values", () => {
  assert.deepEqual(parseJobName("test (3.12)"), { base: "test", matrixValues: ["3.12"] });
  assert.deepEqual(parseJobName("test (3.12, ubuntu-latest)"), {
    base: "test",
    matrixValues: ["3.12", "ubuntu-latest"],
  });
  assert.deepEqual(parseJobName("broken"), { base: "broken", matrixValues: [] });
});

test("a matrix artifact matches the job for its version, not the other versions", () => {
  assert.equal(matchArtifactToJobName("test-results-3.12", FIXTURE_JOBS), "test (3.12)");
  assert.equal(matchArtifactToJobName("test-results-3.11", FIXTURE_JOBS), "test (3.11)");
});

test("a non-matrix artifact matches by job name", () => {
  assert.equal(matchArtifactToJobName("test-results-broken", FIXTURE_JOBS), "broken");
});

test("matrix value matching respects boundaries: 3.1 is not 3.11", () => {
  const jobs = ["test (3.1)", "test (3.11)"];
  assert.equal(matchArtifactToJobName("test-results-3.1", jobs), "test (3.1)");
  assert.equal(matchArtifactToJobName("test-results-3.11", jobs), "test (3.11)");
});

test("an artifact that could belong to several jobs matches none of them", () => {
  // "coverage" names no job; base name "test" alone matches all three matrix jobs.
  assert.equal(matchArtifactToJobName("coverage", FIXTURE_JOBS), null);
  assert.equal(matchArtifactToJobName("test-output", FIXTURE_JOBS), null);
});

test("a two-dimensional matrix artifact picks the job matching both values", () => {
  const jobs = ["test (3.12, ubuntu-latest)", "test (3.12, windows-latest)"];
  assert.equal(
    matchArtifactToJobName("results-3.12-ubuntu-latest", jobs),
    "test (3.12, ubuntu-latest)",
  );
});

const attempt = (runAttempt: number, startedAt: string) => ({
  runAttempt,
  startedAt: new Date(startedAt),
});

test("an artifact uploaded during attempt 1 stays with attempt 1 after a re-run", () => {
  const attempts = [attempt(1, "2026-09-01T10:00:00Z"), attempt(2, "2026-09-01T11:00:00Z")];

  const picked = pickAttemptForArtifact(attempts, new Date("2026-09-01T10:05:00Z"));

  assert.equal(picked?.runAttempt, 1);
});

test("an artifact uploaded after the re-run started belongs to the re-run", () => {
  const attempts = [attempt(1, "2026-09-01T10:00:00Z"), attempt(2, "2026-09-01T11:00:00Z")];

  const picked = pickAttemptForArtifact(attempts, new Date("2026-09-01T11:05:00Z"));

  assert.equal(picked?.runAttempt, 2);
});

test("clock skew (artifact seemingly before any attempt) still picks an attempt", () => {
  const attempts = [attempt(1, "2026-09-01T10:00:00Z")];

  const picked = pickAttemptForArtifact(attempts, new Date("2026-09-01T09:59:00Z"));

  assert.equal(picked?.runAttempt, 1);
});

test("no attempts means no pick", () => {
  assert.equal(pickAttemptForArtifact([], new Date("2026-09-01T10:00:00Z")), null);
});
