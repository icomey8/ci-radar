import {
  pgTable,
  integer,
  text,
  timestamp,
  uniqueIndex,
  bigint,
  boolean,
  primaryKey,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const repos = pgTable(
  "repos",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("repos_owner_name_idx").on(table.owner, table.name)],
);

export const watchedRepos = pgTable(
  "watched_repos",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    repoId: integer("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("watched_repos_user_repo_idx").on(table.userId, table.repoId)],
);

export const jobAttempts = pgTable("job_attempts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  repoId: integer("repo_id")
    .notNull()
    .references(() => repos.id, { onDelete: "cascade" }),
  githubJobId: bigint("github_job_id", { mode: "number" }).notNull().unique(),
  githubRunId: bigint("github_run_id", { mode: "number" }).notNull(),
  runAttempt: integer("run_attempt").notNull(),
  workflowName: text("workflow_name").notNull(),
  jobName: text("job_name").notNull(),
  headSha: text("head_sha").notNull(),
  conclusion: text("conclusion").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
});

export const resourceValidators = pgTable(
  "resource_validators",
  {
    repoId: integer("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    resource: text("resource").notNull(),
    etag: text("etag").notNull(),
  },
  (table) => [primaryKey({ columns: [table.repoId, table.resource] })],
);

export const backfillProgress = pgTable("backfill_progress", {
  repoId: integer("repo_id")
    .primaryKey()
    .references(() => repos.id, { onDelete: "cascade" }),
  targetDate: timestamp("target_date", { withTimezone: true }).notNull(),
  cursor: timestamp("cursor", { withTimezone: true }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  done: boolean("done").notNull().default(false),
});

export const ingestedRuns = pgTable(
  "ingested_runs",
  {
    repoId: integer("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    githubRunId: bigint("github_run_id", { mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.repoId, table.githubRunId] })],
);
