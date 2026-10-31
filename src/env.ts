import "dotenv/config";

/** The variable's value, or a clear error naming it. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

/** The variables holding the GitHub App's credentials. */
export const GITHUB_APP_VARS = {
  appId: "GITHUB_APP_ID",
  privateKey: "GITHUB_APP_PRIVATE_KEY",
};

/** The GitHub App variables `vars` lacks; empty counts as unset, as in `requireEnv`. */
export function missingGithubCredentials(vars: NodeJS.ProcessEnv): string[] {
  return Object.values(GITHUB_APP_VARS).filter((name) => !vars[name]);
}

export const env = {
  // Read on use, so `pnpm dev` can import this without needing a database itself.
  get databaseUrl() {
    return requireEnv("DATABASE_URL");
  },
};
