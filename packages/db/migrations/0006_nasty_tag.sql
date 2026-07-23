ALTER TABLE "listings" ADD COLUMN "relisted_from" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "relist_kind" text;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_relisted_from_listings_id_fk" FOREIGN KEY ("relisted_from") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "listings_relisted_from_key" ON "listings" USING btree ("relisted_from");--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_relist_kind_check" CHECK ("listings"."relist_kind" IS NULL OR "listings"."relist_kind" IN ('relist', 'trade_in', 'relocated'));--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_relist_pair_check" CHECK (("listings"."relisted_from" IS NULL) = ("listings"."relist_kind" IS NULL));