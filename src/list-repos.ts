import { db, pool } from "./db.js";
import { watchedRepos } from "./schema.js";

const repos = await db.select().from(watchedRepos);

if (repos.length === 0) {
  console.log("No repos watched yet. Add one with `pnpm add-repo <owner>/<name>`.");
} else {
  for (const repo of repos) {
    console.log(`${repo.owner}/${repo.name}`);
  }
}

await pool.end();
