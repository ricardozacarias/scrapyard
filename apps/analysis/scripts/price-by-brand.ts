// Example one-off: median-ish price stats per brand for active listings.
//
//   pnpm analysis scripts/price-by-brand.ts
//
// Copy this file as a starting point for a new analysis. The pattern:
//   1. get the db
//   2. write a query (drizzle builder or raw `sql`)
//   3. printTable() to eyeball it, save() to export it.

import {
  avg,
  count,
  desc,
  eq,
  getDb,
  listings,
  max,
  min,
  printTable,
  save,
  sql,
} from "../src/_harness";

async function main() {
  const db = getDb();

  const rows = await db
    .select({
      make: listings.make,
      count: count(),
      avgPrice: sql<number>`round(${avg(listings.currentPrice)})`,
      minPrice: min(listings.currentPrice),
      maxPrice: max(listings.currentPrice),
    })
    .from(listings)
    .where(eq(listings.isActive, true))
    .groupBy(listings.make)
    .having(sql`count(*) >= 20`)
    .orderBy(desc(count()));

  printTable(rows);
  save("price-by-make", rows);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
