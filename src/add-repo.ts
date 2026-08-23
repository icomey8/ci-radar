import { db, pool } from "./db.js";
import { users, watchedRepos } from "./schema.js";

function parseRepo(input: string | undefined): { owner: string; name: string } {
  if (!input) {
    throw new Error("Usage: pnpm add-repo <owner>/<name>");
  }
  const parts = input.split("/");
  const [owner, name] = parts;
  if (parts.length !== 2 || !owner || !name) {
    throw new Error(`Expected <owner>/<name>, got "${input}"`);
  }
  return { owner, name };
}

async function main() {
  const { owner, name } = parseRepo(process.argv[2]);

  const [user] = await db.select().from(users).limit(1);
  if (!user) {
    throw new Error("No user found. Run `pnpm seed` first.");
  }

  const inserted = await db
    .insert(watchedRepos)
    .values({ userId: user.id, owner, name })
    .onConflictDoNothing()
    .returning();

  console.log(
    inserted.length > 0 ? `Now watching ${owner}/${name}` : `Already watching ${owner}/${name}`,
  );

  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
