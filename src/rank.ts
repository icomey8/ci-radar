export const defaultRankConfig = {
  daysBack: 14,
  minRuns: 10,
  failRateCeiling: 0.8,
  failRateFloor: 0.05,
};

export type RankConfig = typeof defaultRankConfig;

export type RankAttempt = {
  workflowName: string;
  jobName: string;
  conclusion: string;
};

type JobTally = {
  workflowName: string;
  jobName: string;
  runs: number;
  failures: number;
};

const organizeAttempts = (attempts: RankAttempt[]) => {
  const groups = new Map<string, JobTally>();
  for (const attempt of attempts) {
    const key = `${attempt.workflowName}\u0000${attempt.jobName}`;

    let tally = groups.get(key);
    if (!tally) {
      tally = {
        workflowName: attempt.workflowName,
        jobName: attempt.jobName,
        runs: 0,
        failures: 0,
      };
      groups.set(key, tally);
    }

    if (attempt.conclusion === "cancelled" || attempt.conclusion === "skipped") {
      continue;
    }

    tally.runs += 1;
    if (attempt.conclusion === "failure" || attempt.conclusion === "timed_out") {
      tally.failures += 1;
    }
  }

  return groups;
};

export function rank(attempts: RankAttempt[], config: RankConfig = defaultRankConfig) {
  const groupedAttempts = organizeAttempts(attempts);
  const broken: JobTally[] = [];
  const flaky: JobTally[] = [];

  for (const job of groupedAttempts.values()) {
    if (job.runs < config.minRuns) continue;

    const failureRate = job.failures / job.runs;
    if (failureRate >= config.failRateCeiling) {
      broken.push(job);
    } else if (failureRate >= config.failRateFloor) {
      flaky.push(job);
    }
  }

  flaky.sort(
    (a, b) => b.failures - a.failures || b.runs - a.runs || a.jobName.localeCompare(b.jobName),
  );

  broken.sort((a, b) => b.runs - a.runs || a.jobName.localeCompare(b.jobName));

  return { flaky, broken };
}
