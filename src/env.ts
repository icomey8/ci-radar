import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  githubAppId: required("GITHUB_APP_ID"),
  githubAppPrivKey: required("GITHUB_APP_PRIVATE_KEY"),
};
