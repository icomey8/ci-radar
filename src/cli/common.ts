import { and, eq } from "drizzle-orm";
import { db } from "../db.js";
import { repos, users, watchedRepos } from "../schema.js";

export function parseOwnerRepo(
  value: string | undefined,
  usage: string,
): { owner: string; name: string } {
  if (!value) {
    throw new Error(usage);
  }
  const parts = value.split("/");
  const [owner, name] = parts;
  if (parts.length !== 2 || !owner || !name) {
    throw new Error(`Expected <owner>/<name>, got "${value}"`);
  }
  return { owner, name };
}

/** The single local user every CLI acts as. Throws if the database is unseeded. */
export async function requireUser(): Promise<typeof users.$inferSelect> {
  const [user] = await db.select().from(users).limit(1);
  if (!user) {
    throw new Error("No user found. Run `pnpm seed` first.");
  }
  return user;
}

/** The watched repo's id, or an error pointing at `pnpm add-repo`. */
export async function requireWatchedRepo(
  userId: number,
  owner: string,
  name: string,
): Promise<number> {
  const [watched] = await db
    .select({ repoId: repos.id })
    .from(watchedRepos)
    .innerJoin(repos, eq(watchedRepos.repoId, repos.id))
    .where(and(eq(watchedRepos.userId, userId), eq(repos.owner, owner), eq(repos.name, name)))
    .limit(1);

  if (!watched) {
    throw new Error(`Not watching ${owner}/${name}. Run \`pnpm add-repo ${owner}/${name}\` first.`);
  }
  return watched.repoId;
}
