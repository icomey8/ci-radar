/**
 * `2026-10-12T09:41:07Z` — ISO 8601 UTC without milliseconds. GitHub's created
 * filter wants this, and Swift's `.iso8601` date decoding rejects fractions.
 */
export function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}
