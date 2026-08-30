CREATE TABLE "backfill_progress" (
	"repo_id" integer PRIMARY KEY NOT NULL,
	"target_date" timestamp with time zone NOT NULL,
	"cursor" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backfill_progress" ADD CONSTRAINT "backfill_progress_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;