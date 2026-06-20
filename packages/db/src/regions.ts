import { sql } from "drizzle-orm";

import type { DB } from "./client";
import { regionAliases, regions } from "./schema";

/** The 18 mainland Portuguese districts. */
export const DISTRICTS = [
  "Aveiro",
  "Beja",
  "Braga",
  "Bragança",
  "Castelo Branco",
  "Coimbra",
  "Évora",
  "Faro",
  "Guarda",
  "Leiria",
  "Lisboa",
  "Portalegre",
  "Porto",
  "Santarém",
  "Setúbal",
  "Viana do Castelo",
  "Vila Real",
  "Viseu",
] as const;

/** Alternate spellings -> canonical district name. */
export const ALIASES: ReadonlyArray<{ alias: string; district: string }> = [
  { alias: "Lisbon", district: "Lisboa" },
  { alias: "Setubal", district: "Setúbal" },
  { alias: "Evora", district: "Évora" },
  { alias: "Braganca", district: "Bragança" },
  { alias: "Santarem", district: "Santarém" },
  { alias: "Viana-do-Castelo", district: "Viana do Castelo" },
  { alias: "Vila-Real", district: "Vila Real" },
];

/** Lowercase, strip accents, collapse non-alphanumerics to single spaces. */
export function slug(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // drop combining accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Idempotently seed the 18 districts and their aliases. Safe to call on every
 * scraper run — uses ON CONFLICT DO NOTHING.
 */
export async function seedRegions(db: DB): Promise<void> {
  await db
    .insert(regions)
    .values(DISTRICTS.map((name) => ({ level: "district", name, geomKey: name })))
    .onConflictDoNothing();

  const all = await db
    .select({ id: regions.id, name: regions.name })
    .from(regions)
    .where(sql`${regions.level} = 'district'`);
  const byName = new Map(all.map((r) => [r.name, r.id]));

  const aliasRows = ALIASES.flatMap(({ alias, district }) => {
    const regionId = byName.get(district);
    return regionId ? [{ regionId, alias }] : [];
  });
  if (aliasRows.length > 0) {
    await db.insert(regionAliases).values(aliasRows).onConflictDoNothing();
  }
}

export type RegionResolver = (
  city: string | null | undefined,
  region: string | null | undefined,
) => number | null;

/**
 * Load regions + aliases once and return an in-memory resolver. Tries, in order:
 * exact alias match -> exact district-name match -> loose slug-contains match.
 */
export async function buildRegionResolver(db: DB): Promise<RegionResolver> {
  const districtRows = await db
    .select({ id: regions.id, name: regions.name })
    .from(regions)
    .where(sql`${regions.level} = 'district'`);
  const aliasRows = await db
    .select({ regionId: regionAliases.regionId, alias: regionAliases.alias })
    .from(regionAliases);

  const exact = new Map<string, number>();
  const needles: Array<{ needle: string; regionId: number }> = [];

  for (const r of districtRows) {
    exact.set(r.name.toLowerCase(), r.id);
    needles.push({ needle: slug(r.name), regionId: r.id });
  }
  for (const a of aliasRows) {
    exact.set(a.alias.toLowerCase(), a.regionId);
    needles.push({ needle: slug(a.alias), regionId: a.regionId });
  }
  // Longer needles first so "viana do castelo" wins over a stray "vila".
  needles.sort((a, b) => b.needle.length - a.needle.length);

  return (city, region) => {
    const cand = (region || city || "").trim();
    if (!cand) return null;

    const direct = exact.get(cand.toLowerCase());
    if (direct !== undefined) return direct;

    const s = slug(cand);
    if (!s) return null;
    for (const { needle, regionId } of needles) {
      if (needle && s.includes(needle)) return regionId;
    }
    return null;
  };
}
