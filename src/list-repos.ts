import { eq } from "drizzle-orm";
import { db, pool } from "./db.js";
import { repos, watchedRepos } from "./schema.js";

const watched = await db
  .select({ owner: repos.owner, name: repos.name })
  .from(watchedRepos)
  .innerJoin(repos, eq(watchedRepos.repoId, repos.id));

if (watched.length === 0) {
  console.log("No repos watched yet. Add one with `pnpm add-repo <owner>/<name>`.");
} else {
  for (const repo of watched) {
    console.log(`${repo.owner}/${repo.name}`);
  }
}

await pool.end();
