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
  brand?: string;
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

export type SortKey = "price" | "year" | "mileage" | "lastSeen" | "brand";

const SORT_COLUMNS = {
  price: listings.currentPrice,
  year: listings.modelYear,
  mileage: listings.mileageKm,
  lastSeen: listings.lastSeenAt,
  brand: listings.brand,
} as const;

export interface ListingRow {
  id: number;
  externalId: string;
  title: string | null;
  url: string | null;
  city: string | null;
  district: string | null;
  sellerType: string | null;
  brand: string | null;
  fuel: string | null;
  modelYear: number | null;
  mileageKm: number | null;
  currency: string | null;
  currentPrice: number | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

function buildWhere(f: ListingFilters): SQL | undefined {
  const conds: SQL[] = [];
  if (f.brand) conds.push(eq(listings.brand, f.brand));
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
      brand: listings.brand,
      fuel: listings.fuel,
      modelYear: listings.modelYear,
      mileageKm: listings.mileageKm,
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
  brands: string[];
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
      .where(sql`${col} is not null`)
      .orderBy(asc(col));
    return rows.map((r) => r.v as string).filter((v) => typeof v === "string" && v !== "");
  };

  const regionRows = await db
    .selectDistinct({ v: regions.name })
    .from(listings)
    .innerJoin(regions, eq(listings.regionId, regions.id))
    .orderBy(asc(regions.name));

  const [brands, fuels, sellerTypes] = await Promise.all([
    distinct(listings.brand),
    distinct(listings.fuel),
    distinct(listings.sellerType),
  ]);

  return { brands, fuels, sellerTypes, regions: regionRows.map((r) => r.v) };
}

// NOTE: intentionally excludes title/url. These rows are shipped to the browser
// to render the client-side scatter, so identifying fields (ad title, link) are
// dropped here to keep the public chart a distribution, not a downloadable
// directory of listings. See CLAUDE.md "Data exposure".
export interface AnalysisRow {
  id: number;
  brand: string | null;
  fuel: string | null;
  sellerType: string | null;
  district: string | null;
  price: number | null;
  mileageKm: number | null;
  modelYear: number | null;
}

/** Listings with the numeric fields the scatter plot uses (capped, de-identified). */
export async function getAnalysisRows(f: ListingFilters, limit = 5000): Promise<AnalysisRow[]> {
  const db = getDb();
  const where = buildWhere(f);
  return db
    .select({
      id: listings.id,
      brand: listings.brand,
      fuel: listings.fuel,
      sellerType: listings.sellerType,
      district: regions.name,
      price: listings.currentPrice,
      mileageKm: listings.mileageKm,
      modelYear: listings.modelYear,
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
  brand: string | null;
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
    SELECT l.id, l.title, l.url, l.brand, l.currency,
      prev.price AS "previousPrice",
      cur.price AS "currentPrice",
      (prev.price - cur.price) AS drop,
      cur.observed_at AS "changedAt"
    FROM ranked cur
    JOIN ranked prev ON prev.listing_id = cur.listing_id AND prev.rn = 2
    JOIN listings l ON l.id = cur.listing_id
    WHERE cur.rn = 1 AND prev.price > cur.price
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
  byBrand: GroupStat[];
  byRegion: GroupStat[];
}

export async function getSummary(): Promise<Summary> {
  const db = getDb();

  const totals = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM listings) AS total,
      (SELECT count(*)::int FROM listings WHERE is_active) AS active,
      (SELECT count(DISTINCT listing_id)::int FROM price_history) AS "withPriceHistory"
  `);
  const t = rowsOf<{ total: number; active: number; withPriceHistory: number }>(totals)[0];

  const byBrand = await db.execute(sql`
    SELECT brand AS label, count(*)::int AS count,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY current_price)::int AS "medianPrice"
    FROM listings
    WHERE brand IS NOT NULL AND current_price IS NOT NULL
    GROUP BY brand ORDER BY count DESC LIMIT 12
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
    byBrand: rowsOf<GroupStat>(byBrand),
    byRegion: rowsOf<GroupStat>(byRegion),
  };
}

/** Normalize neon-http execute() results to a plain row array. */
function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  if (res && typeof res === "object" && "rows" in res) {
    return (res as { rows: T[] }).rows;
  }
  return [];
}
