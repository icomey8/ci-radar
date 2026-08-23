import { App } from "octokit";
import { env } from "./env.js";

const app = new App({
  appId: env.githubAppId,
  privateKey: Buffer.from(env.githubAppPrivKey, "base64").toString("utf8"),
});

type AppOctokit = App["octokit"];
type InstallationOctokit = Awaited<ReturnType<App["getInstallationOctokit"]>>;

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
  const { data } = await appOctokit.request(
    "GET /repos/{owner}/{repo}/installation",
    { owner, repo },
  );
  return data.id;
}
