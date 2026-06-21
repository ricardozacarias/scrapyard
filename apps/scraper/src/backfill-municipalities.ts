// One-off: seed municipality regions and backfill listings.municipality_id for
// rows scraped before the column existed. Idempotent — safe to re-run.
//
//   pnpm --filter @scrapyard/scraper exec tsx src/backfill-municipalities.ts
//
// Resolution happens per distinct (city, region) pair (~1k), not per row, so
// this is ~1k UPDATEs rather than one per listing.

import {
  and,
  buildMunicipalityResolver,
  eq,
  getDb,
  listings,
  seedMunicipalities,
  sql,
} from "@scrapyard/db";

async function main() {
  const db = getDb();
  console.log("[backfill] seeding municipality regions…");
  await seedMunicipalities(db);
  const resolve = await buildMunicipalityResolver(db);

  const pairs = await db
    .selectDistinct({ city: listings.city, region: listings.region })
    .from(listings)
    .where(sql`${listings.city} is not null`);

  let mappedRows = 0;
  let mappedPairs = 0;
  let unresolved = 0;
  for (const { city, region } of pairs) {
    const municipalityId = resolve(city, region);
    if (municipalityId === null) {
      unresolved++;
      continue;
    }
    const res = await db
      .update(listings)
      .set({ municipalityId })
      .where(
        and(eq(listings.city, city as string), sql`${listings.region} is not distinct from ${region}`),
      )
      .returning({ id: listings.id });
    mappedRows += res.length;
    mappedPairs++;
  }

  const remaining = await db.execute(
    sql`SELECT count(*)::int AS n FROM listings WHERE municipality_id IS NULL`,
  );
  const arr = (
    Array.isArray(remaining) ? remaining : (remaining as unknown as { rows: unknown[] }).rows
  ) as { n: number }[];
  const n = arr?.[0]?.n;

  console.log(
    `[backfill] done: ${mappedPairs} pairs mapped → ${mappedRows} rows updated; ` +
      `${unresolved} pairs unresolved; ${n ?? "?"} listings still without a municipality.`,
  );
}

main().catch((err) => {
  console.error("[backfill] FAILED:", err);
  process.exit(1);
});
