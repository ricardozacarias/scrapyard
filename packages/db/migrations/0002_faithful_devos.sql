DROP INDEX "listings_brand_idx";--> statement-breakpoint
ALTER TABLE "listings" RENAME COLUMN "brand" TO "make";--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "version" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "gearbox" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "engine_power" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "engine_capacity" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "price_evaluation" text;--> statement-breakpoint
CREATE INDEX "listings_make_idx" ON "listings" USING btree ("make");--> statement-breakpoint
CREATE INDEX "listings_model_idx" ON "listings" USING btree ("model");
