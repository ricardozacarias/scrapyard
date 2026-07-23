import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
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
    municipalityId: integer("municipality_id").references(() => regions.id),
    sellerType: text("seller_type"),
    make: text("make"),
    model: text("model"),
    version: text("version"),
    gearbox: text("gearbox"),
    origin: text("origin"),
    enginePower: integer("engine_power"),
    engineCapacity: integer("engine_capacity"),
    priceEvaluation: text("price_evaluation"),
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
    /**
     * Relist linking (set by apps/scraper/src/link-relists.ts): when this ad is
     * a repost of an earlier, now-delisted ad for the same physical car, it
     * points at that predecessor. `relist_kind` says how they matched:
     * 'relist' (same seller reposting), 'trade_in' (private car reappearing at
     * a dealer), 'relocated' (same car, different city). A delisted ad with a
     * successor should not be counted as a true sale.
     */
    relistedFrom: integer("relisted_from").references((): AnyPgColumn => listings.id, {
      onDelete: "set null",
    }),
    relistKind: text("relist_kind"),
  },
  (t) => [
    index("listings_price_idx").on(t.currentPrice),
    index("listings_make_idx").on(t.make),
    index("listings_model_idx").on(t.model),
    index("listings_model_year_idx").on(t.modelYear),
    index("listings_region_id_idx").on(t.regionId),
    index("listings_municipality_id_idx").on(t.municipalityId),
    index("listings_last_seen_at_idx").on(t.lastSeenAt),
    // One successor per predecessor (Postgres allows many NULLs here).
    uniqueIndex("listings_relisted_from_key").on(t.relistedFrom),
    check(
      "listings_relist_kind_check",
      sql`${t.relistKind} IS NULL OR ${t.relistKind} IN ('relist', 'trade_in', 'relocated')`,
    ),
    check(
      "listings_relist_pair_check",
      sql`(${t.relistedFrom} IS NULL) = (${t.relistKind} IS NULL)`,
    ),
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

/**
 * One row per scraper run (cron or manual), recorded by apps/scraper at the end
 * of every run — success or failure — so the dashboard can show run history
 * without going to GitHub Actions. Operational metadata only (counts + timings),
 * no listing data.
 */
export const scrapeRuns = pgTable(
  "scrape_runs",
  {
    id: serial("id").primaryKey(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").notNull(), // 'running' | 'success' | 'failed'
    pagesRequested: integer("pages_requested"),
    parsed: integer("parsed").notNull().default(0),
    upserted: integer("upserted").notNull().default(0),
    snapshots: integer("snapshots").notNull().default(0),
    deactivated: integer("deactivated").notNull().default(0),
    // Total logical database size (pg_database_size) captured at the end of each
    // successful run, so the dashboard can trend storage vs the Neon free-tier cap
    // and project when it runs out. Nullable: runs before this column, and failed
    // runs, leave it unset. bigint since pg_database_size returns int8.
    dbBytes: bigint("db_bytes", { mode: "number" }),
    error: text("error"),
  },
  (t) => [
    index("scrape_runs_started_at_idx").on(t.startedAt),
    check("scrape_runs_status_check", sql`${t.status} IN ('running', 'success', 'failed')`),
  ],
);

export type Region = typeof regions.$inferSelect;
export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;
export type PriceHistoryRow = typeof priceHistory.$inferSelect;
export type ScrapeRun = typeof scrapeRuns.$inferSelect;
