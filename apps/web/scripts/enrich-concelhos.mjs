// One-off: adds a `district` property to every feature in concelhos.geojson,
// derived from packages/db/src/gazetteer.json (concelho -> district). The
// click-to-zoom inset needs to select all concelhos of a clicked district, and
// the upstream CAOP layer only carries the municipality name.
//
//   node apps/web/scripts/enrich-concelhos.mjs
//
// Re-runnable and offline. Safe to delete after running; kept for provenance.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const GEO = join(here, "..", "public", "geo", "concelhos.geojson");
const GAZ = join(here, "..", "..", "..", "packages", "db", "src", "gazetteer.json");

const norm = (s) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const gaz = JSON.parse(readFileSync(GAZ, "utf8"));
const byConcelho = new Map();
for (const [c, d] of gaz.concelhos) byConcelho.set(norm(c), d);

const geo = JSON.parse(readFileSync(GEO, "utf8"));
let matched = 0;
const misses = [];
for (const f of geo.features) {
  const muni = String(f.properties.municipality ?? "");
  const district = byConcelho.get(norm(muni));
  if (district) {
    f.properties.district = district;
    matched++;
  } else {
    misses.push(muni);
  }
}

writeFileSync(GEO, JSON.stringify(geo));
console.log(`[enrich] ${matched}/${geo.features.length} concelhos matched to a district`);
if (misses.length) console.log(`[enrich] unmatched:`, misses.join(", "));
