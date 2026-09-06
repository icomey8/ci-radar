import { and, eq, inArray } from "drizzle-orm";
import { RequestError, type Octokit } from "octokit";
import { db } from "./db.js";
import { downloadArtifactZip, fetchArtifactsForRun, type WorkflowArtifact } from "./github.js";
import { extractXmlFiles, JUnitParseError, parseJUnitXml } from "./junit.js";
import { jobAttempts, processedArtifacts, testResults } from "./schema.js";

const TEST_ARTIFACT_PATTERN = /test|junit|result/i;

const DELIMITERS = new Set(["-", "_", " ", ".", "/", "\\"]);

/**
 * True when `needle` appears in `haystack` bounded by delimiters (or the string's
 * ends), so the matrix value "3.1" does not match inside "test-results-3.12".
 */
function containsToken(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();

  for (let from = 0; ; from += 1) {
    const index = h.indexOf(n, from);
    if (index === -1) return false;

    const before = h[index - 1];
    const after = h[index + n.length];
    const boundedBefore = before === undefined || DELIMITERS.has(before);
    const boundedAfter = after === undefined || DELIMITERS.has(after);
    if (boundedBefore && boundedAfter) return true;

    from = index;
  }
}

export function parseJobName(jobName: string): { base: string; matrixValues: string[] } {
  const match = jobName.match(/^(.*?)\s*\((.*)\)\s*$/);
  if (!match) return { base: jobName.trim(), matrixValues: [] };

  return {
    base: match[1]!.trim(),
    matrixValues: match[2]!
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  };
}

type ScoredJob = { jobName: string; matrixScore: number; baseScore: number };

function pickStrictBest(candidates: ScoredJob[], score: (c: ScoredJob) => number): string | null {
  const positive = candidates.filter((candidate) => score(candidate) > 0);
  if (positive.length === 0) return null;
  const top = Math.max(...positive.map(score));
  const best = positive.filter((candidate) => score(candidate) === top);
  return best.length === 1 ? best[0]!.jobName : null;
}

export function matchArtifactToJobName(artifactName: string, jobNames: string[]): string | null {
  const scored: ScoredJob[] = jobNames.map((jobName) => {
    const { base, matrixValues } = parseJobName(jobName);
    const matchedValues = matrixValues.filter((value) => containsToken(artifactName, value));
    return {
      jobName,
      matrixScore: matchedValues.reduce((total, value) => total + value.length, 0),
      baseScore: containsToken(artifactName, base) ? base.length : 0,
    };
  });

  return (
    pickStrictBest(scored, (candidate) => candidate.matrixScore) ??
    pickStrictBest(
      scored.filter((candidate) => candidate.matrixScore === 0),
      (candidate) => candidate.baseScore,
    )
  );
}

/**
 * The attempt an artifact came from: the latest attempt that had already started
 * when the artifact was uploaded.
 */
export function pickAttemptForArtifact<T extends { runAttempt: number; startedAt: Date }>(
  attempts: T[],
  artifactCreatedAt: Date,
): T | null {
  const started = attempts.filter((a) => a.startedAt.getTime() <= artifactCreatedAt.getTime());
  const pool = started.length > 0 ? started : attempts;

  let best: T | null = null;
  for (const attempt of pool) {
    if (!best || attempt.runAttempt > best.runAttempt) best = attempt;
  }
  return best;
}

export type TestResultStats = {
  artifactsSeen: number;
  artifactsStored: number;
  artifactsUnmatched: number;
  artifactsExpired: number;
  artifactsMalformed: number;
  testsInserted: number;
};

export function emptyTestResultStats(): TestResultStats {
  return {
    artifactsSeen: 0,
    artifactsStored: 0,
    artifactsUnmatched: 0,
    artifactsExpired: 0,
    artifactsMalformed: 0,
    testsInserted: 0,
  };
}

export function addTestResultStats(total: TestResultStats, delta: TestResultStats): void {
  for (const key of Object.keys(total) as (keyof TestResultStats)[]) {
    total[key] += delta[key];
  }
}

async function recordProcessed(
  repoId: number,
  runId: number,
  artifactId: number,
  outcome: "stored" | "expired" | "malformed",
): Promise<void> {
  await db
    .insert(processedArtifacts)
    .values({ githubArtifactId: artifactId, repoId, githubRunId: runId, outcome })
    .onConflictDoNothing();
}

function artifactUploadedAt(artifact: WorkflowArtifact): Date {
  return new Date(artifact.created_at ?? artifact.updated_at ?? 0);
}

/**
 * Downloads a run's test-result artifacts, parses the JUnit XML, and stores
 * per-test outcomes against the job attempt each artifact came from.
 *
 * Per-artifact failures never abort the pass: expired and malformed artifacts
 * are recorded and skipped forever, download errors and unmatched artifacts are
 * left to retry the next time the run changes.
 */
export async function ingestTestResultsForRun(
  owner: string,
  name: string,
  octoClient: Octokit,
  repoId: number,
  runId: number,
): Promise<TestResultStats> {
  const stats = emptyTestResultStats();

  const artifacts = (await fetchArtifactsForRun(owner, name, octoClient, runId)).filter(
    (artifact) => TEST_ARTIFACT_PATTERN.test(artifact.name),
  );
  if (artifacts.length === 0) return stats;
  stats.artifactsSeen = artifacts.length;

  const alreadyProcessed = new Set(
    (
      await db
        .select({ githubArtifactId: processedArtifacts.githubArtifactId })
        .from(processedArtifacts)
        .where(
          inArray(
            processedArtifacts.githubArtifactId,
            artifacts.map((artifact) => artifact.id),
          ),
        )
    ).map((row) => row.githubArtifactId),
  );

  const attempts = await db
    .select({
      id: jobAttempts.id,
      jobName: jobAttempts.jobName,
      runAttempt: jobAttempts.runAttempt,
      startedAt: jobAttempts.startedAt,
    })
    .from(jobAttempts)
    .where(and(eq(jobAttempts.repoId, repoId), eq(jobAttempts.githubRunId, runId)));

  const jobNames = [...new Set(attempts.map((attempt) => attempt.jobName))];

  for (const artifact of artifacts) {
    if (alreadyProcessed.has(artifact.id)) continue;

    if (artifact.expired) {
      stats.artifactsExpired += 1;
      // eslint-disable-next-line no-await-in-loop
      await recordProcessed(repoId, runId, artifact.id, "expired");
      continue;
    }

    const jobName = matchArtifactToJobName(artifact.name, jobNames);
    const attempt = jobName
      ? pickAttemptForArtifact(
          attempts.filter((a) => a.jobName === jobName),
          artifactUploadedAt(artifact),
        )
      : null;
    if (!attempt) {
      stats.artifactsUnmatched += 1;
      continue;
    }

    let zipBytes: Uint8Array;
    try {
      // eslint-disable-next-line no-await-in-loop
      zipBytes = await downloadArtifactZip(owner, name, octoClient, artifact.id);
    } catch (error) {
      if (error instanceof RequestError && error.status === 410) {
        stats.artifactsExpired += 1;
        // eslint-disable-next-line no-await-in-loop
        await recordProcessed(repoId, runId, artifact.id, "expired");
      } else {
        console.warn(
          `Artifact ${artifact.name} (${artifact.id}) download failed, will retry:`,
          error instanceof Error ? error.message : error,
        );
      }
      continue;
    }

    let results;
    try {
      results = extractXmlFiles(zipBytes).flatMap(parseJUnitXml);
    } catch (error) {
      if (!(error instanceof JUnitParseError)) throw error;
      stats.artifactsMalformed += 1;
      // eslint-disable-next-line no-await-in-loop
      await recordProcessed(repoId, runId, artifact.id, "malformed");
      continue;
    }

    const byName = new Map(results.map((result) => [result.name, result] as const));

    if (byName.size > 0) {
      // eslint-disable-next-line no-await-in-loop
      const written = await db
        .insert(testResults)
        .values(
          [...byName.values()].map((result) => ({
            jobAttemptId: attempt.id,
            testName: result.name,
            outcome: result.outcome,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: testResults.id });
      stats.testsInserted += written.length;
    }

    stats.artifactsStored += 1;
    // eslint-disable-next-line no-await-in-loop
    await recordProcessed(repoId, runId, artifact.id, "stored");
  }

  return stats;
}
