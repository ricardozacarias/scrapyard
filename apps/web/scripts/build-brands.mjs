// Builds the brand-logo collection:
//   node apps/web/scripts/build-brands.mjs   (needs DATABASE_URL + network)
//
// 1. reads the distinct brands from the DB (so it tracks the live catalogue),
// 2. matches each to the open car-logos-dataset (slugify + a small alias table),
// 3. downloads the optimised PNG into apps/web/public/brands/<slug>.png,
// 4. emits apps/web/lib/brands.json — { normalizedBrand: { display, logo } } —
//    which the dashboard consumes. Unmatched brands fall back to an initials chip.
//
// Logos are trademarks of their owners; used here only to identify listings.

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OUT_IMG = join(ROOT, "apps", "web", "public", "brands");
const OUT_JSON = join(ROOT, "apps", "web", "lib", "brands.json");
const DATASET = "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/data.json";

// Resolve neon from the db package regardless of cwd.
const require = createRequire(join(ROOT, "packages", "db", "package.json"));
const { neon } = require("@neondatabase/serverless");

// Our brand string → dataset slug, where slugify() alone doesn't get there.
const ALIASES = {
  vw: "volkswagen",
  rolls: "rolls-royce",
  kgm: "ssangyong", // KGM is the rebranded SsangYong
};

const norm = (s) =>
  (s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const slugify = (s) => norm(s).replace(/\s+/g, "-");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const sql = neon(process.env.DATABASE_URL);

  const brandRows = await sql`
    SELECT brand, count(*)::int n FROM listings WHERE brand IS NOT NULL GROUP BY brand ORDER BY n DESC`;
  const dataset = await (await fetch(DATASET)).json();
  const bySlug = new Map(dataset.map((d) => [d.slug, d]));

  mkdirSync(OUT_IMG, { recursive: true });
  const out = {};
  const matched = [];
  const missed = [];

  for (const { brand } of brandRows) {
    const key = norm(brand);
    const slug = ALIASES[key] ?? slugify(brand);
    const entry = bySlug.get(slug);
    if (!entry) {
      missed.push(brand);
      continue;
    }
    const url = entry.image.optimized;
    const res = await fetch(url);
    if (!res.ok) {
      missed.push(`${brand} (download ${res.status})`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(join(OUT_IMG, `${slug}.png`), buf);
    out[key] = { display: brand, logo: `/brands/${slug}.png` };
    matched.push(brand);
  }

  writeFileSync(OUT_JSON, JSON.stringify(out, null, 0) + "\n");
  console.log(`[brands] matched ${matched.length}/${brandRows.length} brands`);
  console.log(`[brands] no logo (fallback to initials): ${missed.join(", ")}`);
}

main().catch((err) => {
  console.error("[brands] FAILED:", err);
  process.exit(1);
});
