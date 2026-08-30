import { and, eq } from "drizzle-orm";
import { db, pool } from "../db.js";
import { repos, watchedRepos } from "../schema.js";
import { parseOwnerRepo, requireUser } from "./common.js";

async function main() {
  const { owner, name } = parseOwnerRepo(process.argv[2], "Usage: pnpm add-repo <owner>/<name>");

  const user = await requireUser();

  let [repo] = await db
    .select()
    .from(repos)
    .where(and(eq(repos.owner, owner), eq(repos.name, name)))
    .limit(1);
  if (!repo) {
    [repo] = await db.insert(repos).values({ owner, name }).returning();
  }

  const inserted = await db
    .insert(watchedRepos)
    .values({ userId: user.id, repoId: repo!.id })
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
