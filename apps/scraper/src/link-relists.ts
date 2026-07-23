// Relist linking pass: connect a delisted ad to its successor ad when the
// strict spec fingerprint says they are the same physical car, so "sold"
// analytics can exclude reposts. Idempotent — only fills NULLs, safe to re-run;
// `UPDATE listings SET relisted_from = NULL, relist_kind = NULL` resets it.
//
//   pnpm --filter scraper exec tsx src/link-relists.ts
//
// All tiers require the full spec fingerprint (make, model, model_year,
// version, fuel, engine_power — nulls compare equal) plus known mileage on both
// sides, and only link unambiguous 1:1 pairs within the tier: if a delisted ad
// has two plausible successors (fleet twins), we refuse and it stays counted
// as sold — today's behavior, so the pass can only improve accuracy.
//
// Tiers, in priority order (numbers measured July 2026 — see session notes):
//   relist     same city + seller type, Δkm −100…+500,      gap −2d … +7d
//   trade_in   Particular → Profissional, Δkm −100…+2000,   gap −2d … +60d
//   relocated  different city, Δkm −100…+250,               gap −2d … +14d
//
// The −2d lower bound covers scrape-timing overlap (old and new ad briefly
// coexist). Odometers don't run backward: the −100 floor only allows small
// seller corrections — validation showed negative deltas beyond that are twin
// cars, not reposts. Pairs where BOTH ads show < 1,000 km are skipped entirely:
// fleets of identical brand-new cars are indistinguishable by fingerprint.

import { getDb, sql } from "@scrapyard/db";

/** How far back we consider delisted ads on each run. Keeps the pass cheap and
 *  matches the fair-price model's SOLD_WINDOW_DAYS horizon. */
const LOOKBACK_DAYS = 45;

interface Tier {
  kind: "relist" | "trade_in" | "relocated";
  /** Extra pair conditions beyond the shared fingerprint (g = gone, n = new). */
  where: string;
}

const TIERS: Tier[] = [
  {
    kind: "relist",
    where: `
      coalesce(n.city, '') = coalesce(g.city, '') AND g.city IS NOT NULL
      AND n.seller_type IS NOT DISTINCT FROM g.seller_type
      AND (n.mileage_km - g.mileage_km) BETWEEN -100 AND 500
      AND n.first_seen_at <= g.last_seen_at + interval '7 days'`,
  },
  {
    kind: "trade_in",
    where: `
      g.seller_type = 'Particular' AND n.seller_type = 'Profissional'
      AND (n.mileage_km - g.mileage_km) BETWEEN -100 AND 2000
      AND n.first_seen_at <= g.last_seen_at + interval '60 days'`,
  },
  {
    kind: "relocated",
    where: `
      g.city IS NOT NULL AND n.city IS NOT NULL AND n.city <> g.city
      AND (n.mileage_km - g.mileage_km) BETWEEN -100 AND 250
      AND n.first_seen_at <= g.last_seen_at + interval '14 days'`,
  },
];

async function linkTier(db: ReturnType<typeof getDb>, tier: Tier): Promise<number> {
  // Pairs: delisted g × candidate successor n, fingerprint + tier conditions,
  // both sides still unlinked. Then keep only 1:1 groups and update.
  const res = await db.execute(sql`
    WITH pairs AS (
      SELECT g.id AS gid, n.id AS nid
      FROM listings g
      JOIN listings n
        ON n.make = g.make
       AND n.model = g.model
       AND n.model_year IS NOT DISTINCT FROM g.model_year
       AND coalesce(n.version, '') = coalesce(g.version, '')
       AND coalesce(n.fuel, '') = coalesce(g.fuel, '')
       AND n.engine_power IS NOT DISTINCT FROM g.engine_power
       AND n.id <> g.id
      WHERE NOT g.is_active
        AND g.last_seen_at >= now() - make_interval(days => ${LOOKBACK_DAYS})
        AND g.mileage_km IS NOT NULL
        AND n.mileage_km IS NOT NULL
        AND NOT (g.mileage_km < 1000 AND n.mileage_km < 1000)
        AND n.first_seen_at > g.first_seen_at
        AND n.first_seen_at >= g.last_seen_at - interval '2 days'
        AND n.relisted_from IS NULL
        AND NOT EXISTS (SELECT 1 FROM listings s WHERE s.relisted_from = g.id)
        AND ${sql.raw(tier.where)}
    ),
    unambiguous AS (
      SELECT gid, nid FROM (
        SELECT gid, nid,
          count(*) OVER (PARTITION BY gid) AS succs_per_gone,
          count(*) OVER (PARTITION BY nid) AS gones_per_succ
        FROM pairs
      ) ranked
      WHERE succs_per_gone = 1 AND gones_per_succ = 1
    )
    UPDATE listings
    SET relisted_from = u.gid, relist_kind = ${tier.kind}
    FROM unambiguous u
    WHERE listings.id = u.nid
    RETURNING listings.id
  `);
  const rows = Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? []);
  return rows.length;
}

async function main() {
  const db = getDb();
  console.log(`[link-relists] linking delisted ads from the last ${LOOKBACK_DAYS} days…`);

  // Each new link can disambiguate a previously-contested pair (its rival
  // candidate is no longer free), so iterate to a fixed point.
  let total = 0;
  for (let round = 1; round <= 20; round++) {
    let linkedThisRound = 0;
    for (const tier of TIERS) {
      const linked = await linkTier(db, tier);
      linkedThisRound += linked;
      if (linked > 0) console.log(`[link-relists]   round ${round} ${tier.kind}: +${linked}`);
    }
    total += linkedThisRound;
    if (linkedThisRound === 0) break;
  }

  const res = await db.execute(sql`
    SELECT relist_kind AS kind, count(*)::int AS n
    FROM listings WHERE relist_kind IS NOT NULL
    GROUP BY relist_kind ORDER BY n DESC
  `);
  const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as {
    kind: string;
    n: number;
  }[];
  const totals = rows.map((r) => `${r.kind}=${r.n}`).join(", ") || "none";
  console.log(`[link-relists] done: ${total} new links this run; totals: ${totals}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
