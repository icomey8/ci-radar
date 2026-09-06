import { mkdir, writeFile } from "node:fs/promises";
import {
  downloadArtifactZip,
  fetchArtifactsForRun,
  fetchRuns,
  octokitForRepo,
} from "../src/github.js";
import { extractXmlFiles } from "../src/junit.js";

const OWNER = "icomey8";
const REPO = "flaky-test";
const OUT_DIR = "tests/fixtures/junit";

async function main() {
  const octokit = await octokitForRepo(OWNER, REPO);

  const listed = await fetchRuns(OWNER, REPO, octokit, { maxNumOfRuns: 30 });
  if (listed.notModified) {
    throw new Error("Got a 304 without sending an ETag — should be impossible.");
  }

  const run =
    listed.runs.find((r) => r.status === "completed" && r.conclusion === "failure") ??
    listed.runs.find((r) => r.status === "completed");
  if (!run) throw new Error("No completed runs to record from.");

  console.log(`Recording from run ${run.id} (${run.conclusion}) created ${run.created_at}`);

  const artifacts = await fetchArtifactsForRun(OWNER, REPO, octokit, run.id);
  await mkdir(OUT_DIR, { recursive: true });

  for (const artifact of artifacts) {
    if (artifact.expired) {
      console.log(`Skipping expired artifact ${artifact.name}`);
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const zipBytes = await downloadArtifactZip(OWNER, REPO, octokit, artifact.id);
    // eslint-disable-next-line no-await-in-loop
    await writeFile(`${OUT_DIR}/${artifact.name}.zip`, zipBytes);

    const xmlFiles = extractXmlFiles(zipBytes);
    for (const [index, xml] of xmlFiles.entries()) {
      const suffix = xmlFiles.length > 1 ? `-${index}` : "";
      // eslint-disable-next-line no-await-in-loop
      await writeFile(`${OUT_DIR}/${artifact.name}${suffix}.xml`, xml);
    }
    console.log(`Saved ${artifact.name} (${xmlFiles.length} XML file(s))`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
