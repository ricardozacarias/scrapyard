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
  const { values } = parseArgs({
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

  // Upsert current state. On conflict, refresh mutable fields + last_seen_at.
  const upserted = await db
    .insert(listings)
    .values(values)
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

  const ids = upserted.map((u) => u.id);

  // Latest recorded price per scraped listing (one row each via DISTINCT ON).
  const latestRows =
    ids.length > 0
      ? await db
          .selectDistinctOn([priceHistory.listingId], {
            listingId: priceHistory.listingId,
            price: priceHistory.price,
          })
          .from(priceHistory)
          .where(inArray(priceHistory.listingId, ids))
          .orderBy(priceHistory.listingId, desc(priceHistory.observedAt))
      : [];
  const latestById = new Map(latestRows.map((r) => [r.listingId, r.price]));

  // Append a snapshot only where the price is new or has changed.
  const newPriceRows = upserted
    .filter((u) => u.currentPrice !== null && latestById.get(u.id) !== u.currentPrice)
    .map((u) => ({ listingId: u.id, price: u.currentPrice as number }));
  if (newPriceRows.length > 0) {
    await db.insert(priceHistory).values(newPriceRows);
  }

  console.log(
    `[run] done: ${upserted.length} listings upserted, ` +
      `${newPriceRows.length} price snapshots recorded`,
  );
}

main().catch((err) => {
  console.error("[run] FAILED:", err);
  process.exit(1);
});
