CREATE TABLE "ingested_runs" (
	"repo_id" integer NOT NULL,
	"github_run_id" bigint NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ingested_runs_repo_id_github_run_id_pk" PRIMARY KEY("repo_id","github_run_id")
);
--> statement-breakpoint
ALTER TABLE "ingested_runs" ADD CONSTRAINT "ingested_runs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;