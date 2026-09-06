import { XMLParser } from "fast-xml-parser";
import { SyntaxValidator } from "fast-xml-validator";
import { unzipSync } from "fflate";

export type TestOutcome = "pass" | "fail" | "skip";
export type TestResult = { name: string; outcome: TestOutcome };

export class JUnitParseError extends Error {}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (tagName) => tagName === "testsuite" || tagName === "testcase",
});

type ParsedTestCase = Record<string, unknown>;
type ParsedSuite = {
  testcase?: ParsedTestCase[];
  testsuite?: ParsedSuite[];
};

function collectTestCases(suite: ParsedSuite, into: ParsedTestCase[]): void {
  for (const testCase of suite.testcase ?? []) {
    into.push(testCase);
  }

  for (const nested of suite.testsuite ?? []) {
    collectTestCases(nested, into);
  }
}

function outcomeOf(testCase: ParsedTestCase): TestOutcome {
  if ("failure" in testCase || "error" in testCase) return "fail";
  if ("skipped" in testCase) return "skip";
  return "pass";
}

/**
 * Test names and pass/fail/skip only.
 */
export function parseJUnitXml(xml: string): TestResult[] {
  try {
    SyntaxValidator.validate(xml);
  } catch (error) {
    throw new JUnitParseError(
      `Not well-formed XML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const document = parser.parse(xml) as {
    testsuites?: ParsedSuite | "";
    testsuite?: ParsedSuite[];
  };

  const suites: ParsedSuite[] = [];
  if (document.testsuites !== undefined) {
    if (document.testsuites !== "") suites.push(document.testsuites);
  } else if (document.testsuite !== undefined) {
    suites.push(...document.testsuite);
  } else {
    throw new JUnitParseError("XML has no <testsuites> or <testsuite> root");
  }

  const testCases: ParsedTestCase[] = [];
  for (const suite of suites) {
    collectTestCases(suite, testCases);
  }

  const results: TestResult[] = [];
  for (const testCase of testCases) {
    const name = testCase["@_name"];
    if (typeof name !== "string" || name === "") continue;

    const classname = testCase["@_classname"];
    const fullName =
      typeof classname === "string" && classname !== "" ? `${classname}::${name}` : name;

    results.push({ name: fullName, outcome: outcomeOf(testCase) });
  }
  return results;
}

/** Every .xml file inside an artifact's zip archive, decoded to text. */
export function extractXmlFiles(zipBytes: Uint8Array): string[] {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes);
  } catch (error) {
    throw new JUnitParseError(
      `Artifact is not a readable zip: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const decoder = new TextDecoder();
  return Object.entries(entries)
    .filter(([path]) => path.toLowerCase().endsWith(".xml"))
    .map(([, bytes]) => decoder.decode(bytes));
}
