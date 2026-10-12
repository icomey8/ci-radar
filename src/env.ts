import "dotenv/config";

/** The variable's value, or a clear error naming it. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export const env = {
  databaseUrl: requireEnv("DATABASE_URL"),
};
