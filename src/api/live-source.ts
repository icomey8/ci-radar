import { eq, max } from "drizzle-orm";
import { requireUser } from "../cli/common.js";
import { db } from "../db.js";
import { rank } from "../rank.js";
import { grabAttempts } from "../ranking.js";
import { jobAttempts, repos, watchedRepos } from "../schema.js";
import { isoSeconds } from "../time.js";
import type { RankingSource } from "./app.js";
import type { RepoDto } from "./dto.js";

/** Answers from Postgres, ranking each repo exactly as `pnpm rank` does. */
export const liveRankingSource: RankingSource = {
  async listRepos() {
    const user = await requireUser();

    const watched = await db
      .select({
        id: repos.id,
        owner: repos.owner,
        name: repos.name,
        // All-time, not the ranking window: "when did data last arrive".
        latestDataAt: max(jobAttempts.ingestedAt),
      })
      .from(watchedRepos)
      .innerJoin(repos, eq(watchedRepos.repoId, repos.id))
      .leftJoin(jobAttempts, eq(jobAttempts.repoId, repos.id))
      .where(eq(watchedRepos.userId, user.id))
      .groupBy(repos.id);

    return Promise.all(
      watched.map(async (repo): Promise<RepoDto> => {
        const { flaky, broken } = rank(await grabAttempts(repo.id));
        return {
          id: repo.id,
          owner: repo.owner,
          name: repo.name,
          latestDataAt: repo.latestDataAt ? isoSeconds(repo.latestDataAt) : null,
          flakyCount: flaky.length,
          brokenCount: broken.length,
        };
      }),
    );
  },
};
