import { defaultRankConfig, rank, type RankAttempt, type RankedRow } from "../rank.js";
import type { RankingDto, RowDto, UnrankedRepo } from "./dto.js";

function rowDto(row: RankedRow): RowDto {
  return {
    kind: row.kind,
    workflowName: row.workflowName,
    jobName: row.jobName,
    testName: row.kind === "test" ? row.testName : null,
    failures: row.failures,
    runs: row.runs,
  };
}

/** Ranks a repo's attempts exactly as `pnpm rank` does, in the API's shape. */
export function rankingDto(repo: UnrankedRepo, attempts: RankAttempt[]): RankingDto {
  const { flaky, broken } = rank(attempts);
  return {
    repo: { ...repo, flakyCount: flaky.length, brokenCount: broken.length },
    daysBack: defaultRankConfig.daysBack,
    flaky: flaky.map(rowDto),
    broken: broken.map(rowDto),
  };
}
