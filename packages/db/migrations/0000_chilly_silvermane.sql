CREATE TABLE "listings" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"title" text,
	"url" text,
	"city" text,
	"region" text,
	"region_id" integer,
	"seller_type" text,
	"brand" text,
	"fuel" text,
	"model_year" integer,
	"mileage_km" integer,
	"currency" text,
	"current_price" integer,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "listings_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"listing_id" integer NOT NULL,
	"price" integer NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "region_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"region_id" integer NOT NULL,
	"alias" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" serial PRIMARY KEY NOT NULL,
	"level" text NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"geom_key" text NOT NULL,
	"parent_code" text,
	CONSTRAINT "regions_code_unique" UNIQUE("code"),
	CONSTRAINT "regions_level_check" CHECK ("regions"."level" IN ('district', 'municipality'))
);
--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "region_aliases" ADD CONSTRAINT "region_aliases_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listings_price_idx" ON "listings" USING btree ("current_price");--> statement-breakpoint
CREATE INDEX "listings_brand_idx" ON "listings" USING btree ("brand");--> statement-breakpoint
CREATE INDEX "listings_model_year_idx" ON "listings" USING btree ("model_year");--> statement-breakpoint
CREATE INDEX "listings_region_id_idx" ON "listings" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "listings_last_seen_at_idx" ON "listings" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "price_history_listing_observed_idx" ON "price_history" USING btree ("listing_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "region_aliases_region_id_alias_key" ON "region_aliases" USING btree ("region_id","alias");--> statement-breakpoint
CREATE INDEX "region_aliases_alias_idx" ON "region_aliases" USING btree (lower("alias"));--> statement-breakpoint
CREATE UNIQUE INDEX "regions_level_name_idx" ON "regions" USING btree ("level","name");