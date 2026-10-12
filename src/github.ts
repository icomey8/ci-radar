import { App, RequestError, type Octokit } from "octokit";
import { requireEnv } from "./env.js";
import type { Endpoints } from "@octokit/types";

export type WorkflowRun =
  Endpoints["GET /repos/{owner}/{repo}/actions/runs"]["response"]["data"]["workflow_runs"][number];
export type WorkflowJob =
  Endpoints["GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs"]["response"]["data"]["jobs"][number];

type AppOctokit = Octokit;
type InstallationOctokit = Octokit;

let app: App | undefined;

/**
 * The GitHub App, built on first use so only code that talks to GitHub needs
 * its credentials. Throws a clear "X is not set" error if they're missing.
 */
export function githubApp(): App {
  app ??= new App({
    appId: requireEnv("GITHUB_APP_ID"),
    privateKey: Buffer.from(requireEnv("GITHUB_APP_PRIVATE_KEY"), "base64").toString("utf8"),
  });
  return app;
}

const clients = new Map<number, InstallationOctokit>();

/** An Octokit authenticated as the App itself. Only for App-level calls. */
export function appOctokit(): AppOctokit {
  return githubApp().octokit;
}

/** An Octokit authenticated as an installation, for reading that installation's repos. */
export async function octokitForInstallation(installationId: number): Promise<InstallationOctokit> {
  const existing = clients.get(installationId);
  if (existing) return existing;

  const client = await githubApp().getInstallationOctokit(installationId);
  clients.set(installationId, client);
  return client;
}

export async function installationIdForRepo(owner: string, repo: string): Promise<number> {
  const { data } = await appOctokit().request("GET /repos/{owner}/{repo}/installation", {
    owner,
    repo,
  });
  return data.id;
}

/** An Octokit authenticated for whichever installation covers this repo. */
export async function octokitForRepo(owner: string, repo: string): Promise<InstallationOctokit> {
  const installationId = await installationIdForRepo(owner, repo);
  return octokitForInstallation(installationId);
}

export function shouldFetchJobs(run: WorkflowRun, storedUpdatedAt: Date | undefined): boolean {
  if (!storedUpdatedAt) return true;
  return new Date(run.updated_at).getTime() > storedUpdatedAt.getTime();
}

export type FetchRunsResult =
  | { notModified: true }
  | { notModified: false; runs: WorkflowRun[]; etag: string | null; totalCount: number };

/**
 * Returns a list of workflow runs for a repo, optionally filtered by a created-date range.
 */
export async function fetchRuns(
  owner: string,
  repo: string,
  octoClient: InstallationOctokit,
  {
    etag = null,
    maxNumOfRuns = 50,
    createdRange = null,
  }: { etag?: string | null; maxNumOfRuns?: number; createdRange?: string | null } = {},
): Promise<FetchRunsResult> {
  const runs: WorkflowRun[] = [];
  let firstPageEtag: string | null = null;
  let totalCount = 0;

  for (let page = 1; runs.length < maxNumOfRuns; page += 1) {
    let response;
    try {
      // eslint-disable-next-line no-await-in-loop
      response = await octoClient.request("GET /repos/{owner}/{repo}/actions/runs", {
        owner,
        repo,
        per_page: 100,
        page,
        ...(createdRange ? { created: createdRange } : {}),
        ...(page === 1 && etag ? { headers: { "if-none-match": etag } } : {}),
      });
    } catch (error) {
      if (page === 1 && error instanceof RequestError && error.status === 304) {
        return { notModified: true };
      }
      throw error;
    }

    if (page === 1) {
      firstPageEtag = response.headers.etag ?? null;
      totalCount = response.data.total_count;
    }

    runs.push(...response.data.workflow_runs);
    if (response.data.workflow_runs.length < 100) break;
  }

  return { notModified: false, runs: runs.slice(0, maxNumOfRuns), etag: firstPageEtag, totalCount };
}

/**
 * Returns the number of runs matching a created-date range.
 * The backfill uses this to decide whether a window fits under a
 * 1,000-result cap before paging through it.
 */
export async function countRuns(
  owner: string,
  repo: string,
  octoClient: InstallationOctokit,
  createdRange: string,
): Promise<number> {
  const response = await octoClient.request("GET /repos/{owner}/{repo}/actions/runs", {
    owner,
    repo,
    per_page: 1,
    created: createdRange,
  });
  return response.data.total_count;
}

export async function fetchJobsForRun(
  owner: string,
  repo: string,
  octoClient: InstallationOctokit,
  runId: number,
) {
  const jobs = await octoClient.paginate("GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs", {
    owner,
    repo,
    run_id: runId,
    per_page: 100,
    filter: "all",
  });

  return jobs;
}

export type WorkflowArtifact =
  Endpoints["GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts"]["response"]["data"]["artifacts"][number];

export async function fetchArtifactsForRun(
  owner: string,
  repo: string,
  octoClient: InstallationOctokit,
  runId: number,
): Promise<WorkflowArtifact[]> {
  return octoClient.paginate("GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts", {
    owner,
    repo,
    run_id: runId,
    per_page: 100,
  });
}

/** The artifact's zip archive as raw bytes. Throws a 410 RequestError if it has expired. */
export async function downloadArtifactZip(
  owner: string,
  repo: string,
  octoClient: InstallationOctokit,
  artifactId: number,
): Promise<Uint8Array> {
  const response = await octoClient.request(
    "GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}",
    { owner, repo, artifact_id: artifactId, archive_format: "zip" },
  );
  return new Uint8Array(response.data as ArrayBuffer);
}

export async function coreRateLimit(octoClient: Octokit) {
  const { data } = await octoClient.request("GET /rate_limit");
  return data.resources.core;
}
