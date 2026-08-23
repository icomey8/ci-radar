CREATE TABLE "job_attempts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "job_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"watched_repo_id" integer NOT NULL,
	"github_job_id" bigint NOT NULL,
	"github_run_id" bigint NOT NULL,
	"run_attempt" integer NOT NULL,
	"workflow_name" text NOT NULL,
	"job_name" text NOT NULL,
	"head_sha" text NOT NULL,
	"conclusion" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_attempts_github_job_id_unique" UNIQUE("github_job_id")
);
--> statement-breakpoint
ALTER TABLE "job_attempts" ADD CONSTRAINT "job_attempts_watched_repo_id_watched_repos_id_fk" FOREIGN KEY ("watched_repo_id") REFERENCES "public"."watched_repos"("id") ON DELETE cascade ON UPDATE no action;