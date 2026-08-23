import { App, type Octokit } from "octokit";
import { env } from "./env.js";
import type { Endpoints } from "@octokit/types";

export type WorkflowRun =
  Endpoints["GET /repos/{owner}/{repo}/actions/runs"]["response"]["data"]["workflow_runs"][number];
export type WorkflowJob =
  Endpoints["GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs"]["response"]["data"]["jobs"][number];

type AppOctokit = Octokit;
type InstallationOctokit = Octokit;

const app = new App({
  appId: env.githubAppId,
  privateKey: Buffer.from(env.githubAppPrivKey, "base64").toString("utf8"),
});

const clients = new Map<number, InstallationOctokit>();

/** An Octokit authenticated as the App itself. Only for App-level calls. */
export const appOctokit: AppOctokit = app.octokit;

/** An Octokit authenticated as an installation, for reading that installation's repos. */
export async function octokitForInstallation(installationId: number): Promise<InstallationOctokit> {
  const existing = clients.get(installationId);
  if (existing) return existing;

  const client = await app.getInstallationOctokit(installationId);
  clients.set(installationId, client);
  return client;
}

export async function installationIdForRepo(owner: string, repo: string): Promise<number> {
  const { data } = await appOctokit.request("GET /repos/{owner}/{repo}/installation", {
    owner,
    repo,
  });
  return data.id;
}

export async function* fetchRunsWithJobs(
  owner: string,
  repo: string,
  octoClient: InstallationOctokit,
  maxNumOfRuns = 50,
) {
  let runCount = 0;

  for await (const response of octoClient.paginate.iterator(
    "GET /repos/{owner}/{repo}/actions/runs",
    {
      owner,
      repo,
      per_page: 100,
    },
  )) {
    const workflowRuns = response.data;
    for (const run of workflowRuns) {
      if (runCount >= maxNumOfRuns) {
        return;
      }

      // Sequential on purpose. GitHub asks for serial requests per installation,
      // and firing these in parallel is what trips the secondary rate limits.
      // eslint-disable-next-line no-await-in-loop
      const jobs = await octoClient.paginate(
        "GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs",
        {
          owner,
          repo,
          run_id: run.id,
          per_page: 100,
          filter: "all",
        },
      );

      runCount += 1;
      yield { run, jobs };
    }
  }
}
