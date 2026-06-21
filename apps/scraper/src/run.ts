import { parseArgs } from "node:util";

import {
  buildRegionResolver,
  desc,
  getDb,
  inArray,
  listings,
  priceHistory,
  seedRegions,
  sql,
} from "@scrapyard/db";

import { scrape } from "./standvirtual";

function parseCliArgs() {
  // pnpm's nested `scrape -> start` scripts forward a stray `--` separator into
  // argv (e.g. `pnpm scrape -- --pages 1`). Strip it so parseArgs sees only flags.
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const { values } = parseArgs({
    args,
    options: {
      "max-price": { type: "string" },
      pages: { type: "string", default: "5" },
    },
  });
  const pages = Number.parseInt(values.pages ?? "5", 10);
  const maxPrice = values["max-price"] ? Number.parseInt(values["max-price"], 10) : undefined;
  if (Number.isNaN(pages) || pages < 1) throw new Error(`Invalid --pages: ${values.pages}`);
  return { pages, maxPrice };
}

async function main() {
  const { pages, maxPrice } = parseCliArgs();
  console.log(
    `[run] scraping standvirtual: pages=${pages}` +
      (maxPrice !== undefined ? ` maxPrice=${maxPrice}` : ""),
  );

  const scraped = await scrape({ pages, maxPrice });
  console.log(`[run] parsed ${scraped.length} unique listings`);

  // Fail loudly so CI flags a broken selector / a block, instead of silently
  // writing nothing and looking "green".
  if (scraped.length === 0) {
    throw new Error("No listings parsed — likely a selector change or a block. Failing the run.");
  }

  const db = getDb();
  await seedRegions(db);
  const resolveRegion = await buildRegionResolver(db);

  const values = scraped.map((r) => ({
    externalId: r.externalId,
    title: r.title,
    url: r.url,
    city: r.city,
    region: r.region,
    regionId: resolveRegion(r.city, r.region),
    sellerType: r.sellerType,
    brand: r.brand,
    fuel: r.fuel,
    modelYear: r.modelYear,
    mileageKm: r.mileageKm,
    currency: r.currency,
    currentPrice: r.price,
  }));

  // All inserts/queries below are chunked. A single statement with thousands of
  // rows (a deep backfill parses ~9k listings) overflows the call stack and the
  // Postgres bind-parameter limit. Batches of 500 stay well under both.
  const CHUNK = 500;
  const chunk = <T>(arr: T[], n: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };

  // Upsert current state. On conflict, refresh mutable fields + last_seen_at.
  const upserted: { id: number; currentPrice: number | null }[] = [];
  for (const batch of chunk(values, CHUNK)) {
    const rows = await db
      .insert(listings)
      .values(batch)
      .onConflictDoUpdate({
        target: listings.externalId,
        set: {
          title: sql`excluded.title`,
          url: sql`excluded.url`,
          city: sql`excluded.city`,
          region: sql`excluded.region`,
          regionId: sql`excluded.region_id`,
          sellerType: sql`excluded.seller_type`,
          brand: sql`excluded.brand`,
          fuel: sql`excluded.fuel`,
          modelYear: sql`excluded.model_year`,
          mileageKm: sql`excluded.mileage_km`,
          currency: sql`excluded.currency`,
          currentPrice: sql`excluded.current_price`,
          lastSeenAt: sql`now()`,
          isActive: sql`true`,
        },
      })
      .returning({ id: listings.id, currentPrice: listings.currentPrice });
    upserted.push(...rows);
  }

  // Latest recorded price per scraped listing (one row each via DISTINCT ON).
  const latestById = new Map<number, number>();
  for (const idBatch of chunk(
    upserted.map((u) => u.id),
    CHUNK,
  )) {
    const latestRows = await db
      .selectDistinctOn([priceHistory.listingId], {
        listingId: priceHistory.listingId,
        price: priceHistory.price,
      })
      .from(priceHistory)
      .where(inArray(priceHistory.listingId, idBatch))
      .orderBy(priceHistory.listingId, desc(priceHistory.observedAt));
    for (const r of latestRows) latestById.set(r.listingId, r.price);
  }

  // Append a snapshot only where the price is new or has changed.
  const newPriceRows = upserted
    .filter((u) => u.currentPrice !== null && latestById.get(u.id) !== u.currentPrice)
    .map((u) => ({ listingId: u.id, price: u.currentPrice as number }));
  for (const batch of chunk(newPriceRows, CHUNK)) {
    await db.insert(priceHistory).values(batch);
  }

  // Sold/removed detection. After a full-catalog scrape, any still-active listing
  // we haven't seen in 2+ days is gone (sold or delisted) — mark it inactive.
  // Two guards prevent false positives:
  //   1. Only run after a comprehensive scrape (a small/test/partial run must not
  //      deactivate the whole catalog just because it only refreshed a few pages).
  //   2. The 2-day grace window tolerates an occasional blocked daily run.
  const FULL_SCRAPE_MIN = 20_000;
  let deactivated = 0;
  if (scraped.length >= FULL_SCRAPE_MIN) {
    const rows = await db
      .update(listings)
      .set({ isActive: false })
      .where(sql`${listings.isActive} = true and ${listings.lastSeenAt} < now() - interval '2 days'`)
      .returning({ id: listings.id });
    deactivated = rows.length;
  } else {
    console.log(
      `[run] partial scrape (${scraped.length} < ${FULL_SCRAPE_MIN}) — skipping sold/removed detection`,
    );
  }

  console.log(
    `[run] done: ${upserted.length} listings upserted, ` +
      `${newPriceRows.length} price snapshots recorded, ` +
      `${deactivated} marked inactive (sold/removed)`,
  );
}

main().catch((err) => {
  console.error("[run] FAILED:", err);
  process.exit(1);
});
