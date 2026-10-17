import { and, eq, max } from "drizzle-orm";
import { requireUser } from "../cli/common.js";
import { db } from "../db.js";
import { grabAttempts } from "../ranking.js";
import { jobAttempts, repos, watchedRepos } from "../schema.js";
import { isoSeconds } from "../time.js";
import type { RankingSource } from "./app.js";
import type { UnrankedRepo } from "./dto.js";
import { rankingDto } from "./ranking-dto.js";

/** The seeded user's watched repos, or just the one with `repoId` if given. */
async function loadWatchedRepos(repoId?: number): Promise<UnrankedRepo[]> {
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
    .where(
      and(
        eq(watchedRepos.userId, user.id),
        repoId === undefined ? undefined : eq(repos.id, repoId),
      ),
    )
    .groupBy(repos.id);

  return watched.map((repo) => ({
    id: repo.id,
    owner: repo.owner,
    name: repo.name,
    latestDataAt: repo.latestDataAt ? isoSeconds(repo.latestDataAt) : null,
  }));
}

/** Ranks one repo exactly as `pnpm rank` does. */
async function rankRepo(repo: UnrankedRepo) {
  return rankingDto(repo, await grabAttempts(repo.id));
}

/** Answers from Postgres. */
export const liveRankingSource: RankingSource = {
  async listRepos() {
    const watched = await loadWatchedRepos();
    return Promise.all(watched.map(async (repo) => (await rankRepo(repo)).repo));
  },

  async ranking(repoId) {
    const [repo] = await loadWatchedRepos(repoId);
    return repo ? rankRepo(repo) : null;
  },
};
