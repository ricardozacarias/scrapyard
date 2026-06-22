import "server-only";

import {
  and,
  type AnyPgColumn,
  asc,
  desc,
  eq,
  getDb,
  gte,
  listings,
  lte,
  type SQL,
  regions,
  sql,
} from "@scrapyard/db";

export interface ListingFilters {
  make?: string;
  model?: string;
  fuel?: string;
  sellerType?: string;
  region?: string; // canonical district name
  minPrice?: number;
  maxPrice?: number;
  minYear?: number;
  maxYear?: number;
  maxMileage?: number;
  sort?: SortKey;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export type SortKey = "price" | "year" | "mileage" | "lastSeen" | "make";

const SORT_COLUMNS = {
  price: listings.currentPrice,
  year: listings.modelYear,
  mileage: listings.mileageKm,
  lastSeen: listings.lastSeenAt,
  make: listings.make,
} as const;

export interface ListingRow {
  id: number;
  externalId: string;
  title: string | null;
  url: string | null;
  city: string | null;
  district: string | null;
  sellerType: string | null;
  make: string | null;
  model: string | null;
  version: string | null;
  fuel: string | null;
  modelYear: number | null;
  mileageKm: number | null;
  gearbox: string | null;
  origin: string | null;
  enginePower: number | null;
  engineCapacity: number | null;
  priceEvaluation: string | null;
  currency: string | null;
  currentPrice: number | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

// Continental Portugal only: drop listings whose location parsed to a
// non-mainland region (Madeira, Azores, the odd Spanish border town) — those have
// a region string but no mainland-district region_id. Rows with no parsed region
// at all (unknown location) are kept. As raw SQL for the execute() queries:
const CONTINENTAL_SQL = sql`(region IS NULL OR region_id IS NOT NULL)`;
// As a drizzle condition for the query-builder queries:
const continental = (): SQL =>
  sql`(${listings.region} is null or ${listings.regionId} is not null)`;

function buildWhere(f: ListingFilters): SQL | undefined {
  const conds: SQL[] = [continental()];
  if (f.make) conds.push(eq(listings.make, f.make));
  if (f.model) conds.push(eq(listings.model, f.model));
  if (f.fuel) conds.push(eq(listings.fuel, f.fuel));
  if (f.sellerType) conds.push(eq(listings.sellerType, f.sellerType));
  if (f.region) conds.push(eq(regions.name, f.region));
  if (f.minPrice !== undefined) conds.push(gte(listings.currentPrice, f.minPrice));
  if (f.maxPrice !== undefined) conds.push(lte(listings.currentPrice, f.maxPrice));
  if (f.minYear !== undefined) conds.push(gte(listings.modelYear, f.minYear));
  if (f.maxYear !== undefined) conds.push(lte(listings.modelYear, f.maxYear));
  if (f.maxMileage !== undefined) conds.push(lte(listings.mileageKm, f.maxMileage));
  return conds.length ? and(...conds) : undefined;
}

export async function getListings(f: ListingFilters): Promise<{
  rows: ListingRow[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const db = getDb();
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 50));
  const where = buildWhere(f);
  const orderCol = SORT_COLUMNS[f.sort ?? "lastSeen"];
  const orderBy = (f.dir === "asc" ? asc : desc)(orderCol);

  const rows = await db
    .select({
      id: listings.id,
      externalId: listings.externalId,
      title: listings.title,
      url: listings.url,
      city: listings.city,
      district: regions.name,
      sellerType: listings.sellerType,
      make: listings.make,
      model: listings.model,
      version: listings.version,
      fuel: listings.fuel,
      modelYear: listings.modelYear,
      mileageKm: listings.mileageKm,
      gearbox: listings.gearbox,
      origin: listings.origin,
      enginePower: listings.enginePower,
      engineCapacity: listings.engineCapacity,
      priceEvaluation: listings.priceEvaluation,
      currency: listings.currency,
      currentPrice: listings.currentPrice,
      firstSeenAt: listings.firstSeenAt,
      lastSeenAt: listings.lastSeenAt,
    })
    .from(listings)
    .leftJoin(regions, eq(listings.regionId, regions.id))
    .where(where)
    .orderBy(orderBy)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(listings)
    .leftJoin(regions, eq(listings.regionId, regions.id))
    .where(where);
  const total = countResult[0]?.count ?? 0;

  return { rows, total, page, pageSize };
}

export interface FilterOptions {
  makes: string[];
  fuels: string[];
  sellerTypes: string[];
  regions: string[];
}

export async function getFilterOptions(): Promise<FilterOptions> {
  const db = getDb();
  const distinct = async (col: AnyPgColumn): Promise<string[]> => {
    const rows = await db
      .selectDistinct({ v: col })
      .from(listings)
      .where(and(sql`${col} is not null`, continental()))
      .orderBy(asc(col));
    return rows.map((r) => r.v as string).filter((v) => typeof v === "string" && v !== "");
  };

  const regionRows = await db
    .selectDistinct({ v: regions.name })
    .from(listings)
    .innerJoin(regions, eq(listings.regionId, regions.id))
    .orderBy(asc(regions.name));

  const [makes, fuels, sellerTypes] = await Promise.all([
    distinct(listings.make),
    distinct(listings.fuel),
    distinct(listings.sellerType),
  ]);

  return { makes, fuels, sellerTypes, regions: regionRows.map((r) => r.v) };
}

// NOTE: intentionally excludes title/url. These rows are shipped to the browser
// to render the client-side scatter, so identifying fields (ad title, link) are
// dropped here to keep the public chart a distribution, not a downloadable
// directory of listings. See CLAUDE.md "Data exposure".
export interface AnalysisRow {
  id: number;
  make: string | null;
  model: string | null;
  fuel: string | null;
  sellerType: string | null;
  district: string | null;
  price: number | null;
  mileageKm: number | null;
  modelYear: number | null;
  enginePower: number | null;
}

/** Listings with the numeric fields the scatter plot uses (capped, de-identified). */
export async function getAnalysisRows(f: ListingFilters, limit = 5000): Promise<AnalysisRow[]> {
  const db = getDb();
  const where = buildWhere(f);
  return db
    .select({
      id: listings.id,
      make: listings.make,
      model: listings.model,
      fuel: listings.fuel,
      sellerType: listings.sellerType,
      district: regions.name,
      price: listings.currentPrice,
      mileageKm: listings.mileageKm,
      modelYear: listings.modelYear,
      enginePower: listings.enginePower,
    })
    .from(listings)
    .leftJoin(regions, eq(listings.regionId, regions.id))
    .where(where)
    .limit(limit);
}

export interface PriceDrop {
  id: number;
  title: string | null;
  url: string | null;
  make: string | null;
  model: string | null;
  currency: string | null;
  previousPrice: number;
  currentPrice: number;
  drop: number;
  changedAt: string;
}

/** Listings whose most recent price snapshot is lower than the prior one. */
export async function getBiggestPriceDrops(limit = 20): Promise<PriceDrop[]> {
  const db = getDb();
  const res = await db.execute(sql`
    WITH ranked AS (
      SELECT listing_id, price, observed_at,
        row_number() OVER (PARTITION BY listing_id ORDER BY observed_at DESC) AS rn
      FROM price_history
    )
    SELECT l.id, l.title, l.url, l.make, l.model, l.currency,
      prev.price AS "previousPrice",
      cur.price AS "currentPrice",
      (prev.price - cur.price) AS drop,
      cur.observed_at AS "changedAt"
    FROM ranked cur
    JOIN ranked prev ON prev.listing_id = cur.listing_id AND prev.rn = 2
    JOIN listings l ON l.id = cur.listing_id
    WHERE cur.rn = 1 AND prev.price > cur.price
      AND (l.region IS NULL OR l.region_id IS NOT NULL)
    ORDER BY drop DESC
    LIMIT ${limit}
  `);
  return rowsOf<PriceDrop>(res);
}

export interface GroupStat {
  label: string;
  count: number;
  medianPrice: number;
}

export interface Summary {
  total: number;
  active: number;
  withPriceHistory: number;
  /** Median current price across all priced listings (gauge). */
  medianPrice: number;
  /** Median odometer across listings with a mileage (gauge). */
  medianMileage: number;
  /** 24h new-listing rate ÷ trailing daily average. 1.0 = normal (gauge). */
  marketHeat: number;
  /** Listings first seen since midnight (local server time). */
  newToday: number;
  /** Listings whose latest price snapshot dropped within the last 24h. */
  drops24h: number;
  byMake: GroupStat[];
  byRegion: GroupStat[];
}

export async function getSummary(): Promise<Summary> {
  const db = getDb();

  const totals = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM listings WHERE ${CONTINENTAL_SQL}) AS total,
      (SELECT count(*)::int FROM listings WHERE is_active AND ${CONTINENTAL_SQL}) AS active,
      (SELECT count(DISTINCT listing_id)::int FROM price_history) AS "withPriceHistory",
      (SELECT count(*)::int FROM listings
         WHERE first_seen_at >= date_trunc('day', now()) AND ${CONTINENTAL_SQL}) AS "newToday",
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY current_price)::int
         FROM listings WHERE current_price IS NOT NULL AND ${CONTINENTAL_SQL}) AS "medianPrice",
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY mileage_km)::int
         FROM listings WHERE mileage_km IS NOT NULL AND ${CONTINENTAL_SQL}) AS "medianMileage"
  `);
  const t = rowsOf<{
    total: number;
    active: number;
    withPriceHistory: number;
    newToday: number;
    medianPrice: number;
    medianMileage: number;
  }>(totals)[0];

  // Market heat = listings added in the last 24h ÷ trailing daily average over
  // the available window. ~1.0 means a typical day; >1 a busier-than-usual one.
  const heatRows = await db.execute(sql`
    WITH fs AS (
      SELECT first_seen_at FROM listings
      WHERE first_seen_at >= now() - interval '30 days' AND ${CONTINENTAL_SQL}
    )
    SELECT
      (SELECT count(*)::int FROM fs WHERE first_seen_at >= now() - interval '24 hours') AS last24,
      count(*)::int AS recent_total,
      greatest(1, least(30, ceil(extract(epoch FROM (now() - min(first_seen_at))) / 86400)))::int AS span_days
    FROM fs
  `);
  const h = rowsOf<{ last24: number; recent_total: number; span_days: number }>(heatRows)[0];
  const avgDaily = h && h.span_days > 0 ? h.recent_total / h.span_days : 0;
  const marketHeat = avgDaily > 0 ? (h?.last24 ?? 0) / avgDaily : 0;

  // Count listings whose most recent price snapshot is a drop, within 24h.
  const recentDrops = await db.execute(sql`
    WITH ranked AS (
      SELECT listing_id, price, observed_at,
        row_number() OVER (PARTITION BY listing_id ORDER BY observed_at DESC) AS rn
      FROM price_history
    )
    SELECT count(*)::int AS n
    FROM ranked cur
    JOIN ranked prev ON prev.listing_id = cur.listing_id AND prev.rn = 2
    JOIN listings l ON l.id = cur.listing_id
    WHERE cur.rn = 1 AND prev.price > cur.price
      AND cur.observed_at >= now() - interval '24 hours'
      AND (l.region IS NULL OR l.region_id IS NOT NULL)
  `);
  const drops24h = rowsOf<{ n: number }>(recentDrops)[0]?.n ?? 0;

  const byMake = await db.execute(sql`
    SELECT make AS label, count(*)::int AS count,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY current_price)::int AS "medianPrice"
    FROM listings
    WHERE make IS NOT NULL AND current_price IS NOT NULL AND ${CONTINENTAL_SQL}
    GROUP BY make ORDER BY count DESC LIMIT 12
  `);

  const byRegion = await db.execute(sql`
    SELECT r.name AS label, count(*)::int AS count,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY l.current_price)::int AS "medianPrice"
    FROM listings l JOIN regions r ON r.id = l.region_id
    WHERE l.current_price IS NOT NULL
    GROUP BY r.name ORDER BY count DESC LIMIT 18
  `);

  return {
    total: t?.total ?? 0,
    active: t?.active ?? 0,
    withPriceHistory: t?.withPriceHistory ?? 0,
    medianPrice: t?.medianPrice ?? 0,
    medianMileage: t?.medianMileage ?? 0,
    marketHeat,
    newToday: t?.newToday ?? 0,
    drops24h,
    byMake: rowsOf<GroupStat>(byMake),
    byRegion: rowsOf<GroupStat>(byRegion),
  };
}

export interface RegionStat {
  name: string;
  count: number;
  medianPrice: number;
}

/**
 * Median price + listing count per district, for the choropleth. Aggregates
 * only (no per-listing rows) — safe to ship to the client. See CLAUDE.md
 * "Data exposure".
 */
export async function getDistrictStats(): Promise<RegionStat[]> {
  const db = getDb();
  const res = await db.execute(sql`
    SELECT r.name AS name, count(*)::int AS count,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY l.current_price)::int AS "medianPrice"
    FROM listings l
    JOIN regions r ON r.id = l.region_id
    WHERE l.current_price IS NOT NULL AND r.level = 'district'
    GROUP BY r.name
  `);
  return rowsOf<RegionStat>(res);
}

/**
 * Median price + listing count per municipality (concelho), for the high-res
 * choropleth. Aggregates only — safe to ship to the client.
 */
export async function getMunicipalityStats(): Promise<RegionStat[]> {
  const db = getDb();
  const res = await db.execute(sql`
    SELECT r.name AS name, count(*)::int AS count,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY l.current_price)::int AS "medianPrice"
    FROM listings l
    JOIN regions r ON r.id = l.municipality_id
    WHERE l.current_price IS NOT NULL AND r.level = 'municipality'
    GROUP BY r.name
  `);
  return rowsOf<RegionStat>(res);
}

/** Normalize neon-http execute() results to a plain row array. */
function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  if (res && typeof res === "object" && "rows" in res) {
    return (res as { rows: T[] }).rows;
  }
  return [];
}
