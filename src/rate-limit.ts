import { installationIdForRepo, octokitForInstallation } from "./github.js";

async function main() {
  const installationId = await installationIdForRepo("icomey8", "flaky-test");
  const octokit = await octokitForInstallation(installationId);

  const { data } = await octokit.request("GET /rate_limit");
  const core = data.resources.core;

  console.log(`Installation ${installationId}`);
  console.log(`Core: ${core.remaining}/${core.limit} remaining`);
  console.log(`Resets at ${new Date(core.reset * 1000).toISOString()}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
