CREATE TABLE "repos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "repos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "repos_owner_name_idx" ON "repos" USING btree ("owner","name");--> statement-breakpoint
INSERT INTO "repos" ("owner", "name")
SELECT DISTINCT "owner", "name" FROM "watched_repos";--> statement-breakpoint
ALTER TABLE "job_attempts" ADD COLUMN "repo_id" integer;--> statement-breakpoint
ALTER TABLE "watched_repos" ADD COLUMN "repo_id" integer;--> statement-breakpoint
UPDATE "watched_repos" wr
SET "repo_id" = r."id"
FROM "repos" r
WHERE r."owner" = wr."owner" AND r."name" = wr."name";--> statement-breakpoint
UPDATE "job_attempts" ja
SET "repo_id" = wr."repo_id"
FROM "watched_repos" wr
WHERE ja."watched_repo_id" = wr."id";--> statement-breakpoint
ALTER TABLE "job_attempts" ALTER COLUMN "repo_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "watched_repos" ALTER COLUMN "repo_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "job_attempts" DROP CONSTRAINT "job_attempts_watched_repo_id_watched_repos_id_fk";
--> statement-breakpoint
DROP INDEX "watched_repos_user_owner_name_idx";--> statement-breakpoint
ALTER TABLE "job_attempts" ADD CONSTRAINT "job_attempts_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watched_repos" ADD CONSTRAINT "watched_repos_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "watched_repos_user_repo_idx" ON "watched_repos" USING btree ("user_id","repo_id");--> statement-breakpoint
ALTER TABLE "job_attempts" DROP COLUMN "watched_repo_id";--> statement-breakpoint
ALTER TABLE "watched_repos" DROP COLUMN "owner";--> statement-breakpoint
ALTER TABLE "watched_repos" DROP COLUMN "name";
