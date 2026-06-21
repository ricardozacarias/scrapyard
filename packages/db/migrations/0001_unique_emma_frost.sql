ALTER TABLE "listings" ADD COLUMN "municipality_id" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_municipality_id_regions_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listings_municipality_id_idx" ON "listings" USING btree ("municipality_id");