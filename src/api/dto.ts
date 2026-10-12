/** A watched repo as `GET /repos` returns it (spec §3.3). */
export type RepoDto = {
  id: number;
  owner: string;
  name: string;
  /** ISO-8601 UTC; null when the repo has never been ingested. */
  latestDataAt: string | null;
  flakyCount: number;
  brokenCount: number;
};

/** The body of every non-2xx response. */
export type ErrorBody = {
  error: { code: string; message: string };
};

/**
 * `2026-10-12T09:41:07Z`. Whole seconds, because Swift's `.iso8601` date
 * decoding rejects fractional seconds.
 */
export function toApiTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, "Z");
}
