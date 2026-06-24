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
  scrapeRuns,
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
  withPriceHistory: number;
  /** Median current price across all priced listings (gauge). */
  medianPrice: number;
  /** Median odometer across listings with a mileage (gauge). */
  medianMileage: number;
  /** 24h new-listing rate ÷ trailing daily average. 1.0 = normal (gauge). */
  marketHeat: number;
  /** Listings first seen since midnight (local server time). */
  newToday: number;
  /**
   * Estimated cars that left the market yesterday: last seen during yesterday
   * but absent from the most recent scrape. A proxy — we can't observe actual
   * sales, only when an ad disappears — and the latest day is provisional until
   * the absence is confirmed across further scrapes.
   */
  soldYesterday: number;
  /** Listings standvirtual rates as priced below market ("good deal"). */
  belowMarket: number;
  /** belowMarket as a % of listings that carry a price rating. */
  belowMarketPct: number;
}

export async function getSummary(): Promise<Summary> {
  const db = getDb();

  const totals = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM listings WHERE ${CONTINENTAL_SQL}) AS total,
      (SELECT count(DISTINCT listing_id)::int FROM price_history) AS "withPriceHistory",
      (SELECT count(*)::int FROM listings
         WHERE first_seen_at >= date_trunc('day', now()) AND ${CONTINENTAL_SQL}) AS "newToday",
      -- left the market yesterday: last seen during yesterday, gone from the
      -- latest scrape (a proxy for "sold" — see Summary.soldYesterday).
      (SELECT count(*)::int FROM listings
         WHERE last_seen_at >= date_trunc('day', now()) - interval '1 day'
           AND last_seen_at <  date_trunc('day', now())
           AND last_seen_at <  (SELECT max(last_seen_at) FROM listings WHERE ${CONTINENTAL_SQL})
           AND ${CONTINENTAL_SQL}) AS "soldYesterday",
      (SELECT count(*)::int FROM listings
         WHERE price_evaluation = 'BELOW' AND ${CONTINENTAL_SQL}) AS "belowMarket",
      (SELECT count(*)::int FROM listings
         WHERE price_evaluation IS NOT NULL AND ${CONTINENTAL_SQL}) AS "rated",
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY current_price)::int
         FROM listings WHERE current_price IS NOT NULL AND ${CONTINENTAL_SQL}) AS "medianPrice",
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY mileage_km)::int
         FROM listings WHERE mileage_km IS NOT NULL AND ${CONTINENTAL_SQL}) AS "medianMileage"
  `);
  const t = rowsOf<{
    total: number;
    withPriceHistory: number;
    newToday: number;
    soldYesterday: number;
    belowMarket: number;
    rated: number;
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

  const belowMarket = t?.belowMarket ?? 0;
  const rated = t?.rated ?? 0;

  return {
    total: t?.total ?? 0,
    withPriceHistory: t?.withPriceHistory ?? 0,
    medianPrice: t?.medianPrice ?? 0,
    medianMileage: t?.medianMileage ?? 0,
    marketHeat,
    newToday: t?.newToday ?? 0,
    soldYesterday: t?.soldYesterday ?? 0,
    belowMarket,
    belowMarketPct: rated > 0 ? Math.round((100 * belowMarket) / rated) : 0,
  };
}

export interface ModelStat {
  make: string;
  model: string;
  count: number;
}

/** The most-listed make+model combinations, by listing count (volume). */
export async function getTopModels(limit = 15): Promise<ModelStat[]> {
  const db = getDb();
  const res = await db.execute(sql`
    SELECT make, model, count(*)::int AS count
    FROM listings
    WHERE make IS NOT NULL AND model IS NOT NULL AND ${CONTINENTAL_SQL}
    GROUP BY make, model
    ORDER BY count DESC
    LIMIT ${limit}
  `);
  return rowsOf<ModelStat>(res);
}

export interface YearStat {
  year: number;
  count: number;
}

/** Listing count per model year over the last ~20 model years, oldest→newest. */
export async function getInventoryByYear(): Promise<YearStat[]> {
  const db = getDb();
  const res = await db.execute(sql`
    SELECT model_year AS year, count(*)::int AS count
    FROM listings
    WHERE model_year IS NOT NULL
      AND model_year >= extract(year FROM now())::int - 20
      AND model_year <= extract(year FROM now())::int + 1
      AND ${CONTINENTAL_SQL}
    GROUP BY model_year
    ORDER BY model_year
  `);
  return rowsOf<YearStat>(res);
}


/**
 * Compact, dictionary-encoded, columnar payload of every priced listing, for
 * the interactive map. Aggregation (median price per region under arbitrary
 * make/model/year/mileage filters) happens client-side, so the raw points must
 * ship to the browser. Deliberately DE-IDENTIFIED — no title / url / id — so it
 * exposes structured attributes only, never the per-ad identity. See CLAUDE.md
 * "Data exposure".
 */
export interface MapPayload {
  makes: string[];
  models: string[];
  municipalities: string[];
  districts: string[];
  /** Per-listing columns (parallel arrays, length === count). Indices point
   *  into the dictionaries above; -1 means "unknown". */
  make: number[];
  model: number[];
  year: number[]; // 0 when unknown
  mileage: number[]; // -1 when unknown
  price: number[];
  muni: number[];
  dist: number[];
  count: number;
}

interface MapRow {
  make: string | null;
  model: string | null;
  year: number | null;
  mileage: number | null;
  price: number | null;
  municipality: string | null;
  district: string | null;
}

export async function getMapData(): Promise<MapPayload> {
  const db = getDb();
  const res = await db.execute(sql`
    SELECT l.make AS make, l.model AS model, l.model_year AS year,
      l.mileage_km AS mileage, l.current_price AS price,
      muni.name AS municipality, dist.name AS district
    FROM listings l
    JOIN regions dist ON dist.id = l.region_id AND dist.level = 'district'
    LEFT JOIN regions muni ON muni.id = l.municipality_id AND muni.level = 'municipality'
    WHERE l.current_price IS NOT NULL AND l.region_id IS NOT NULL
  `);
  const rows = rowsOf<MapRow>(res);

  // Dictionary-encode the string columns so each listing ships as small ints.
  const makes: string[] = [];
  const models: string[] = [];
  const municipalities: string[] = [];
  const districts: string[] = [];
  const intern = (dict: string[], idx: Map<string, number>, v: string | null): number => {
    if (v == null) return -1;
    let i = idx.get(v);
    if (i === undefined) {
      i = dict.length;
      dict.push(v);
      idx.set(v, i);
    }
    return i;
  };
  const makeIdx = new Map<string, number>();
  const modelIdx = new Map<string, number>();
  const muniIdx = new Map<string, number>();
  const distIdx = new Map<string, number>();

  const out: MapPayload = {
    makes,
    models,
    municipalities,
    districts,
    make: [],
    model: [],
    year: [],
    mileage: [],
    price: [],
    muni: [],
    dist: [],
    count: rows.length,
  };

  for (const r of rows) {
    out.make.push(intern(makes, makeIdx, r.make));
    out.model.push(intern(models, modelIdx, r.model));
    out.year.push(r.year ?? 0);
    // Round mileage to the nearest 1000 km — smaller payload, better gzip, and a
    // touch more de-identifying. Plenty precise for a regional median.
    out.mileage.push(r.mileage == null ? -1 : Math.round(r.mileage / 1000) * 1000);
    out.price.push(r.price ?? 0);
    out.muni.push(intern(municipalities, muniIdx, r.municipality));
    out.dist.push(intern(districts, distIdx, r.district));
  }
  return out;
}

export interface ScrapeRunRow {
  id: number;
  startedAt: Date;
  finishedAt: Date | null;
  status: string;
  pagesRequested: number | null;
  parsed: number;
  upserted: number;
  snapshots: number;
  deactivated: number;
  error: string | null;
}

/** Recent scraper runs (newest first) — the cron history. Operational metadata only. */
export async function getScrapeRuns(limit = 30): Promise<ScrapeRunRow[]> {
  const db = getDb();
  return db.select().from(scrapeRuns).orderBy(desc(scrapeRuns.startedAt)).limit(limit);
}

export interface DayActivity {
  day: string;
  snapshots: number;
  newListings: number;
}

/**
 * Derived day-by-day activity from the data itself (price snapshots + first-seen),
 * so the runs page has real history even before the scrape_runs table fills up.
 */
export async function getScrapeActivity(days = 14): Promise<DayActivity[]> {
  const db = getDb();
  const res = await db.execute(sql`
    WITH snaps AS (
      SELECT date_trunc('day', observed_at) AS d, count(*)::int AS n
      FROM price_history
      WHERE observed_at >= now() - make_interval(days => ${days})
      GROUP BY 1
    ),
    fresh AS (
      SELECT date_trunc('day', first_seen_at) AS d, count(*)::int AS n
      FROM listings
      WHERE first_seen_at >= now() - make_interval(days => ${days})
      GROUP BY 1
    )
    SELECT to_char(COALESCE(snaps.d, fresh.d), 'YYYY-MM-DD') AS day,
      COALESCE(snaps.n, 0) AS snapshots,
      COALESCE(fresh.n, 0) AS "newListings"
    FROM snaps FULL OUTER JOIN fresh ON snaps.d = fresh.d
    ORDER BY 1 DESC
  `);
  return rowsOf<DayActivity>(res);
}

/** Normalize neon-http execute() results to a plain row array. */
function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  if (res && typeof res === "object" && "rows" in res) {
    return (res as { rows: T[] }).rows;
  }
  return [];
}
