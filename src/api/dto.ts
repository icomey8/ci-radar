/** A watched repo as `GET /repos` returns it (spec §3.3). */
export type RepoDto = {
  id: number;
  owner: string;
  name: string;
  /** ISO-8601 UTC to the second; null when the repo has never been ingested. */
  latestDataAt: string | null;
  flakyCount: number;
  brokenCount: number;
};

/** The body of every non-2xx response. */
export type ErrorBody = {
  error: { code: string; message: string };
};

/** One ranked job or test, as `rank()` produced it (spec §3.3). */
export type RowDto = {
  kind: "job" | "test";
  workflowName: string;
  jobName: string;
  /** Explicit null on job rows. */
  testName: string | null;
  failures: number;
  runs: number;
};

/** The body of `GET /repos/:id/ranking`; `flaky` and `broken` keep `rank()`'s order. */
export type RankingDto = {
  repo: RepoDto;
  daysBack: number;
  flaky: RowDto[];
  broken: RowDto[];
};

/** A repo before ranking fills in its counts. */
export type UnrankedRepo = Omit<RepoDto, "flakyCount" | "brokenCount">;
