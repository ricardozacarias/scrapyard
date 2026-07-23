// Validation + stats for the relist linking pass (apps/scraper/src/link-relists.ts).
//
//   pnpm analysis scripts/relist-check.ts
//
// Emits out/relist-sample.csv — linked pairs with both URLs so the matches can
// be eyeballed on standvirtual (old ad should be dead, new ad the same car) —
// and prints per-kind stats: counts, price deltas, time gaps.

import { getDb, printTable, save, sql } from "../src/_harness";

interface PairRow extends Record<string, unknown> {
  kind: string;
  model: string;
  oldPrice: number | null;
  newPrice: number | null;
  oldKm: number | null;
  newKm: number | null;
  gapDays: number;
  oldUrl: string | null;
  newUrl: string | null;
}

async function main() {
  const db = getDb();

  const stats = await db.execute(sql`
    SELECT n.relist_kind AS kind,
      count(*)::int AS links,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY n.current_price - g.current_price)::int
        AS "medianPriceDelta",
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY extract(epoch FROM (n.first_seen_at - g.last_seen_at)) / 86400
      )::numeric(6,1) AS "medianGapDays",
      count(*) FILTER (WHERE n.current_price < g.current_price)::int AS cheaper,
      count(*) FILTER (WHERE n.current_price > g.current_price)::int AS pricier
    FROM listings n JOIN listings g ON g.id = n.relisted_from
    GROUP BY n.relist_kind ORDER BY links DESC
  `);
  const statRows = (Array.isArray(stats) ? stats : ((stats as { rows?: unknown[] }).rows ?? [])) as Record<
    string,
    unknown
  >[];
  printTable(statRows);

  // 10 pairs per kind for manual eyeballing, spread across the id range.
  const sample = await db.execute(sql`
    SELECT * FROM (
      SELECT n.relist_kind AS kind,
        g.make || ' ' || g.model AS model,
        g.current_price AS "oldPrice", n.current_price AS "newPrice",
        g.mileage_km AS "oldKm", n.mileage_km AS "newKm",
        round(extract(epoch FROM (n.first_seen_at - g.last_seen_at)) / 86400)::int AS "gapDays",
        g.url AS "oldUrl", n.url AS "newUrl",
        row_number() OVER (PARTITION BY n.relist_kind ORDER BY md5(n.id::text)) AS rn
      FROM listings n JOIN listings g ON g.id = n.relisted_from
    ) t WHERE rn <= 10 ORDER BY kind, rn
  `);
  const sampleRows = (
    Array.isArray(sample) ? sample : ((sample as { rows?: unknown[] }).rows ?? [])
  ) as PairRow[];
  save(
    "relist-sample",
    sampleRows.map(({ rn: _rn, ...rest }) => rest),
  );
  printTable(sampleRows.map(({ oldUrl: _o, newUrl: _n, rn: _rn, ...rest }) => rest));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
