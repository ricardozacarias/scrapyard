import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Canonical Portuguese regions (the 18 mainland districts, with room for
 * municipalities later). Used to map a scraped, free-text location onto a
 * stable id so the dashboard can aggregate by district.
 */
export const regions = pgTable(
  "regions",
  {
    id: serial("id").primaryKey(),
    level: text("level").notNull(), // 'district' | 'municipality'
    code: text("code").unique(),
    name: text("name").notNull(),
    geomKey: text("geom_key").notNull(),
    parentCode: text("parent_code"),
  },
  (t) => [
    uniqueIndex("regions_level_name_idx").on(t.level, t.name),
    check("regions_level_check", sql`${t.level} IN ('district', 'municipality')`),
  ],
);

/** Alternate spellings ("Lisbon" -> Lisboa, "Setubal" -> Setúbal, ...). */
export const regionAliases = pgTable(
  "region_aliases",
  {
    id: serial("id").primaryKey(),
    regionId: integer("region_id")
      .notNull()
      .references(() => regions.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
  },
  (t) => [
    uniqueIndex("region_aliases_region_id_alias_key").on(t.regionId, t.alias),
    index("region_aliases_alias_idx").on(sql`lower(${t.alias})`),
  ],
);

/**
 * Current state of each car listing. One row per real-world listing, keyed by
 * the marketplace's own id (`external_id`). Mutable fields + `last_seen_at` are
 * refreshed on every scrape via upsert; price changes are recorded separately
 * in `price_history`.
 */
export const listings = pgTable(
  "listings",
  {
    id: serial("id").primaryKey(),
    externalId: text("external_id").notNull().unique(),
    title: text("title"),
    url: text("url"),
    city: text("city"),
    region: text("region"),
    regionId: integer("region_id").references(() => regions.id),
    sellerType: text("seller_type"),
    brand: text("brand"),
    fuel: text("fuel"),
    modelYear: integer("model_year"),
    mileageKm: integer("mileage_km"),
    currency: text("currency"),
    currentPrice: integer("current_price"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    index("listings_price_idx").on(t.currentPrice),
    index("listings_brand_idx").on(t.brand),
    index("listings_model_year_idx").on(t.modelYear),
    index("listings_region_id_idx").on(t.regionId),
    index("listings_last_seen_at_idx").on(t.lastSeenAt),
  ],
);

/**
 * Append-only price time series. A row is inserted only when a listing's scraped
 * price differs from its most recently recorded price, so the table stays lean
 * while preserving every change (price drops, trends, etc.).
 */
export const priceHistory = pgTable(
  "price_history",
  {
    id: serial("id").primaryKey(),
    listingId: integer("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    price: integer("price").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("price_history_listing_observed_idx").on(t.listingId, t.observedAt)],
);

export type Region = typeof regions.$inferSelect;
export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;
export type PriceHistoryRow = typeof priceHistory.$inferSelect;
