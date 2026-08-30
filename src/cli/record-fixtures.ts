/**
 * One-off: saves real GitHub responses to src/fixtures/ so the mapper tests can
 * run without network access. Re-run it only when you need fresher data.
 */
import { mkdir, writeFile } from "node:fs/promises";
import {
  fetchJobsForRun,
  fetchRuns,
  octokitForRepo,
  type WorkflowJob,
  type WorkflowRun,
} from "../github.js";

const OWNER = "icomey8";
const REPO = "flaky-test";
const MAX_RUNS = 8;
const SCRUBBED_EMAIL = "noreply@github.com";

type RunWithJobs = { run: WorkflowRun; jobs: WorkflowJob[] };

function scrub(recorded: RunWithJobs[]): RunWithJobs[] {
  return recorded.map(({ run, jobs }) => {
    const commit = run.head_commit;
    if (!commit) return { run, jobs };

    return {
      run: {
        ...run,
        head_commit: {
          ...commit,
          author: commit.author ? { ...commit.author, email: SCRUBBED_EMAIL } : commit.author,
          committer: commit.committer
            ? { ...commit.committer, email: SCRUBBED_EMAIL }
            : commit.committer,
        },
      },
      jobs,
    };
  });
}

async function main() {
  const octokit = await octokitForRepo(OWNER, REPO);

  const listed = await fetchRuns(OWNER, REPO, octokit, { maxNumOfRuns: MAX_RUNS });
  if (listed.notModified) {
    throw new Error("Got a 304 without sending an ETag — should be impossible.");
  }

  const recorded: RunWithJobs[] = [];
  for (const run of listed.runs) {
    // eslint-disable-next-line no-await-in-loop
    const jobs = await fetchJobsForRun(OWNER, REPO, octokit, run.id);
    recorded.push({ run, jobs });
  }

  await mkdir("src/fixtures", { recursive: true });
  // oxfmt ignores src/fixtures, so this file's shape is whatever we write here.
  await writeFile(
    "src/fixtures/runs-with-jobs.json",
    `${JSON.stringify(scrub(recorded), null, 2)}\n`,
  );

  const jobCount = recorded.reduce((total, { jobs }) => total + jobs.length, 0);
  console.log(`Saved ${recorded.length} runs and ${jobCount} jobs`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
