CREATE TABLE "resource_validators" (
	"repo_id" integer NOT NULL,
	"resource" text NOT NULL,
	"etag" text NOT NULL,
	CONSTRAINT "resource_validators_repo_id_resource_pk" PRIMARY KEY("repo_id","resource")
);
--> statement-breakpoint
ALTER TABLE "resource_validators" ADD CONSTRAINT "resource_validators_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;