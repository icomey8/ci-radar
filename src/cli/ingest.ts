import { pool } from "../db.js";
import { coreRateLimit, octokitForRepo } from "../github.js";
import type { Octokit } from "octokit";
import { ingestRepo } from "../ingest.js";
import { parseOwnerRepo, requireUser, requireWatchedRepo } from "./common.js";

async function printRateLimit(octoClient: Octokit) {
  const core = await coreRateLimit(octoClient);
  console.log(`Rate limit:     ${core.remaining}/${core.limit} remaining`);
}

function parseRepoFlag(argv: string[]): { owner: string; name: string } {
  const index = argv.indexOf("--repo");
  const value = index === -1 ? undefined : argv[index + 1];
  return parseOwnerRepo(value, "Usage: pnpm ingest --repo <owner>/<name>");
}

async function main() {
  const { owner, name } = parseRepoFlag(process.argv.slice(2));

  const user = await requireUser();
  const repoId = await requireWatchedRepo(user.id, owner, name);
  const octoClient = await octokitForRepo(owner, name);

  console.log(`Ingesting ${owner}/${name} (repo ${repoId})`);

  const stats = await ingestRepo(repoId, owner, name, octoClient);

  if (stats.notModified) {
    console.log("Runs list unchanged since last ingest (code 304) — nothing to do.");
  } else {
    const { testStats } = stats;
    console.log(
      [
        `Runs seen:      ${stats.runsSeen}`,
        `Runs skipped:   ${stats.runsSkipped}`,
        `Jobs seen:      ${stats.jobsSeen}`,
        `Rows inserted:  ${stats.insertedRows}`,
        `Unfinished:     ${stats.unfinished}`,
        `Already stored: ${stats.jobsSeen - stats.unfinished - stats.insertedRows}`,
        `Artifacts:      ${testStats.artifactsStored} stored, ${testStats.artifactsUnmatched} unmatched, ${testStats.artifactsExpired} expired, ${testStats.artifactsMalformed} malformed`,
        `Tests inserted: ${testStats.testsInserted}`,
      ].join("\n"),
    );
  }
  await printRateLimit(octoClient);

  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
