CREATE TABLE "scrape_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"pages_requested" integer,
	"parsed" integer DEFAULT 0 NOT NULL,
	"upserted" integer DEFAULT 0 NOT NULL,
	"snapshots" integer DEFAULT 0 NOT NULL,
	"deactivated" integer DEFAULT 0 NOT NULL,
	"error" text,
	CONSTRAINT "scrape_runs_status_check" CHECK ("scrape_runs"."status" IN ('success', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "scrape_runs_started_at_idx" ON "scrape_runs" USING btree ("started_at");