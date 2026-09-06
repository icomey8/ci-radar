# Test fixtures

Everything in this directory exists for the test suite — none of it ships as a
product feature. The files are real responses and artifacts captured from the
`icomey8/flaky-test` fixture repo, saved so tests run offline with no GitHub
credentials.

| Contents | Consumed by | Refreshed with |
| --- | --- | --- |
| `runs-with-jobs.json` | `github.test.ts`, `job-attempt.test.ts` | `pnpm record-fixtures` |
| `junit/*.xml`, `junit/*.zip` | `junit.test.ts` | `pnpm record-artifact-fixtures` |

`junit/malformed.xml` is the exception: it is a hand-truncated copy of
`test-results-3.11.xml` used to test that a corrupt file fails cleanly. The
recorder scripts do not regenerate it — if you re-record, keep or re-truncate
it yourself.

Tests assert on the specific contents of these files (test names, counts,
which tests failed), so re-recording may require updating assertions too.
