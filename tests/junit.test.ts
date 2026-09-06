import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { extractXmlFiles, JUnitParseError, parseJUnitXml } from "../src/junit.js";

// Real artifact files from icomey8/flaky-test, saved by `pnpm record-artifact-fixtures`.
// malformed.xml is a truncated copy of test-results-3.11.xml.
const fixture = (name: string) => new URL(`./fixtures/junit/${name}`, import.meta.url);
const fixtureXml = (name: string) => readFileSync(fixture(name), "utf8");

test("a real pytest results file parses into per-test name and outcome", () => {
  const results = parseJUnitXml(fixtureXml("test-results-3.11.xml"));

  assert.equal(results.length, 6);
  assert.deepEqual(
    results.find((r) => r.name === "tests.test_flaky::test_stable_one"),
    { name: "tests.test_flaky::test_stable_one", outcome: "pass" },
  );
  assert.deepEqual(
    results.find((r) => r.name === "tests.test_flaky::test_flaky"),
    { name: "tests.test_flaky::test_flaky", outcome: "fail" },
  );
});

test("the always-broken job's results file parses as a single failure", () => {
  const results = parseJUnitXml(fixtureXml("test-results-broken.xml"));

  assert.deepEqual(results, [{ name: "tests.test_flaky::test_always_broken", outcome: "fail" }]);
});

test("nothing beyond name and outcome survives parsing", () => {
  const results = parseJUnitXml(fixtureXml("test-results-3.11.xml"));

  for (const result of results) {
    assert.deepEqual(Object.keys(result).toSorted(), ["name", "outcome"]);
    // The failure message and stack trace must not leak into the stored name.
    assert.ok(!result.name.includes("AssertionError"));
  }
});

test("a truncated results file throws instead of returning partial results", () => {
  assert.throws(() => parseJUnitXml(fixtureXml("malformed.xml")), JUnitParseError);
});

test("well-formed XML that is not JUnit throws", () => {
  assert.throws(() => parseJUnitXml("<html><body>404</body></html>"), JUnitParseError);
});

test("an empty testsuites element is valid and has no tests", () => {
  assert.deepEqual(parseJUnitXml('<?xml version="1.0"?><testsuites/>'), []);
});

test("skipped, errored, and unclassed test cases are handled", () => {
  const results = parseJUnitXml(
    `<testsuite tests="3">
       <testcase name="test_skipped"><skipped message="not on this platform"/></testcase>
       <testcase name="test_errored"><error message="boom"/></testcase>
       <testcase name="test_ok"/>
     </testsuite>`,
  );

  assert.deepEqual(results, [
    { name: "test_skipped", outcome: "skip" },
    { name: "test_errored", outcome: "fail" },
    { name: "test_ok", outcome: "pass" },
  ]);
});

test("suites nested inside suites are all collected", () => {
  const results = parseJUnitXml(
    `<testsuites>
       <testsuite name="outer">
         <testcase name="test_outer"/>
         <testsuite name="inner"><testcase name="test_inner"/></testsuite>
       </testsuite>
     </testsuites>`,
  );

  assert.deepEqual(
    results.map((r) => r.name),
    ["test_outer", "test_inner"],
  );
});

test("a real artifact zip yields its results.xml, which parses", () => {
  const zipBytes = new Uint8Array(readFileSync(fixture("test-results-3.11.zip")));

  const xmlFiles = extractXmlFiles(zipBytes);

  assert.equal(xmlFiles.length, 1);
  assert.equal(parseJUnitXml(xmlFiles[0]!).length, 6);
});

test("bytes that are not a zip throw a parse error", () => {
  assert.throws(() => extractXmlFiles(new Uint8Array([1, 2, 3, 4])), JUnitParseError);
});
