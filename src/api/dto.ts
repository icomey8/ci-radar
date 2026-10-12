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
