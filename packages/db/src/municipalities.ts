import { sql } from "drizzle-orm";

import type { DB } from "./client";
import gazetteer from "./gazetteer.json";
import { slug } from "./regions";
import { regions } from "./schema";

// gazetteer.json is generated from the official CAOP layers (see
// apps/web/scripts/build-geo.mjs for the GeoJSON side). concelhos: [name, district];
// freguesias: [normalizedName, concelho, district] — one row per distinct name key.
const CONCELHOS = gazetteer.concelhos as [string, string][];
const FREGUESIAS = gazetteer.freguesias as [string, string, string][];

type Hit = { c: string; d: string };

const concByName = new Map<string, Hit[]>();
for (const [c, d] of CONCELHOS) {
  const k = slug(c);
  (concByName.get(k) ?? concByName.set(k, []).get(k)!).push({ c, d });
}

const fregByName = new Map<string, Hit[]>();
const fregByDistrict = new Map<string, { n: string; c: string }[]>();
for (const [n, c, d] of FREGUESIAS) {
  (fregByName.get(n) ?? fregByName.set(n, []).get(n)!).push({ c, d });
  const dk = slug(d);
  (fregByDistrict.get(dk) ?? fregByDistrict.set(dk, []).get(dk)!).push({ n, c });
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

/**
 * Resolve a scraped "city" (a freguesia or freguesia-union string) + district to
 * a canonical concelho name. Tries, in order: exact concelho match → exact
 * freguesia/Des_Simpli match → fuzzy token-overlap against freguesias in the same
 * district (catches union-name spelling drift). District is used to disambiguate
 * names shared across the country. Returns null for the unresolvable tail
 * (mostly islands, which aren't in the continental CAOP).
 */
export function resolveConcelho(
  city: string | null | undefined,
  region: string | null | undefined,
): string | null {
  const ck = slug(city ?? "");
  if (!ck) return null;
  const rd = slug(region ?? "");
  const pick = (opts: Hit[]) => (opts.find((o) => slug(o.d) === rd) ?? opts[0]!).c;

  if (concByName.has(ck)) return pick(concByName.get(ck)!);
  if (fregByName.has(ck)) return pick(fregByName.get(ck)!);

  if (rd) {
    const cand = fregByDistrict.get(rd);
    if (cand) {
      const cks = new Set(ck.split(" "));
      let best = 0;
      let bestC: string | null = null;
      for (const { n, c } of cand) {
        const s = jaccard(cks, new Set(n.split(" ")));
        if (s > best) {
          best = s;
          bestC = c;
        }
      }
      if (best >= 0.5) return bestC;
    }
  }
  return null;
}

/** Seed one municipality-level region per concelho (parentCode = district). Idempotent. */
export async function seedMunicipalities(db: DB): Promise<void> {
  await db
    .insert(regions)
    .values(
      CONCELHOS.map(([c, d]) => ({
        level: "municipality",
        name: c,
        geomKey: slug(c),
        parentCode: d,
      })),
    )
    .onConflictDoNothing();
}

export type MunicipalityResolver = (
  city: string | null | undefined,
  region: string | null | undefined,
) => number | null;

/** Load seeded municipality regions and return a (city, region) → region id resolver. */
export async function buildMunicipalityResolver(db: DB): Promise<MunicipalityResolver> {
  const rows = await db
    .select({ id: regions.id, name: regions.name })
    .from(regions)
    .where(sql`${regions.level} = 'municipality'`);
  const idByName = new Map(rows.map((r) => [slug(r.name), r.id]));

  return (city, region) => {
    const c = resolveConcelho(city, region);
    if (!c) return null;
    return idByName.get(slug(c)) ?? null;
  };
}
