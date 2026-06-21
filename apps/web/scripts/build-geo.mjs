// Regenerates the GeoJSON in apps/web/public/geo/ from the official CAOP source.
//
//   node apps/web/scripts/build-geo.mjs
//
// Pipeline per layer: download (EPSG:3763, projected metres) → reproject to
// WGS84 → simplify → keep only the name field → REVERSE ring winding.
//
// The winding step is load-bearing: the source (and mapshaper's rfc7946 output)
// use counter-clockwise exterior rings, but d3-geo / Observable Plot — which we
// render with — expect CLOCKWISE exterior rings. RFC7946-wound polygons make
// d3-geo fill the whole sphere (the map shows a solid rectangle). We reverse
// every ring so exteriors are CW and holes CCW.
//
// Requires network + npx (downloads mapshaper on first run).

import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "geo");
const BASE = "https://raw.githubusercontent.com/nmota/caop_GeoJSON/master";

/** @type {{src: string, out: string, nameField: string, prop: string, simplify: string}[]} */
const LAYERS = [
  { src: "ContinenteDistritos.geojson", out: "distritos.geojson", nameField: "Distrito", prop: "district", simplify: "3%" },
  { src: "ContinenteConcelhos.geojson", out: "concelhos.geojson", nameField: "Concelho", prop: "municipality", simplify: "2%" },
];

function reverseRings(geo) {
  for (const f of geo.features) {
    const g = f.geometry;
    if (g.type === "Polygon") g.coordinates.forEach((r) => r.reverse());
    else if (g.type === "MultiPolygon") g.coordinates.forEach((p) => p.forEach((r) => r.reverse()));
  }
  return geo;
}

const tmp = mkdtempSync(join(tmpdir(), "scrapyard-geo-"));
mkdirSync(OUT_DIR, { recursive: true });

for (const layer of LAYERS) {
  const url = `${BASE}/${layer.src}`;
  const raw = join(tmp, "raw.geojson");
  const clean = join(tmp, "clean.geojson");
  const projected = join(tmp, "proj.geojson");

  console.log(`[geo] ${layer.src} → ${layer.out}`);
  execSync(`curl -fsSL "${url}" -o "${raw}"`, { stdio: "inherit" });
  // Strip BOM so mapshaper reads the embedded CRS.
  writeFileSync(clean, readFileSync(raw, "utf8").replace(/^﻿/, ""));

  execSync(
    `npx -y mapshaper "${clean}" ` +
      `-proj from=EPSG:3763 wgs84 ` +
      `-simplify ${layer.simplify} keep-shapes ` +
      `-each '${layer.prop}=${layer.nameField}' -filter-fields ${layer.prop} ` +
      `-o format=geojson rfc7946 precision=0.0001 force "${projected}"`,
    { stdio: "inherit" },
  );

  const geo = reverseRings(JSON.parse(readFileSync(projected, "utf8")));
  writeFileSync(join(OUT_DIR, layer.out), JSON.stringify(geo));
  console.log(`[geo] wrote ${layer.out} (${geo.features.length} features)`);
}

console.log("[geo] done");
