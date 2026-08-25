import type { WorkflowJob, WorkflowRun } from "./github.js";
import type { jobAttempts } from "./schema.js";

export type NewJobAttempt = typeof jobAttempts.$inferInsert;

/**
 * Turns one GitHub job into one row, or null if the job has no final result yet.
 */
export function toJobAttemptRow(
  run: WorkflowRun,
  job: WorkflowJob,
  repoId: number,
): NewJobAttempt | null {
  if (job.status !== "completed" || job.conclusion === null || job.completed_at === null) {
    return null;
  }

  return {
    repoId,
    githubJobId: job.id,
    githubRunId: run.id,
    runAttempt: job.run_attempt ?? 1,
    workflowName: run.name ?? run.path,
    jobName: job.name,
    headSha: run.head_sha,
    conclusion: job.conclusion,
    startedAt: new Date(job.started_at),
    completedAt: new Date(job.completed_at),
  };
}
