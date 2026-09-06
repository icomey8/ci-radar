CREATE TABLE "processed_artifacts" (
	"github_artifact_id" bigint PRIMARY KEY NOT NULL,
	"repo_id" integer NOT NULL,
	"github_run_id" bigint NOT NULL,
	"outcome" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_results" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "test_results_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"job_attempt_id" integer NOT NULL,
	"test_name" text NOT NULL,
	"outcome" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "processed_artifacts" ADD CONSTRAINT "processed_artifacts_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_job_attempt_id_job_attempts_id_fk" FOREIGN KEY ("job_attempt_id") REFERENCES "public"."job_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "test_results_attempt_test_idx" ON "test_results" USING btree ("job_attempt_id","test_name");