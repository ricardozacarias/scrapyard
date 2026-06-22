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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
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

// A logo is "mono-safe" if enough of its canvas is transparent — i.e. it's a thin
// mark, not a solid filled emblem. Below the threshold (filled badges like Fiat's
// circle / Ford's oval, or fully-opaque files) it flattens to a white blob under
// the monochrome treatment, so we fall back to an initials chip instead.
const MONO_MIN_TRANSPARENT = 0.66;

// Minimal PNG decoder → fraction of (near-)transparent pixels. Pure node, no deps.
function transparentFraction(file) {
  const b = readFileSync(file);
  const width = b.readUInt32BE(16);
  const height = b.readUInt32BE(20);
  const bitDepth = b.readUInt8(24);
  const colorType = b.readUInt8(25);
  let plteAlpha = null;
  const idat = [];
  let pos = 8;
  while (pos < b.length - 8) {
    const len = b.readUInt32BE(pos);
    const type = b.toString("ascii", pos + 4, pos + 8);
    const data = b.subarray(pos + 8, pos + 8 + len);
    if (type === "tRNS" && colorType === 3) plteAlpha = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (!idat.length) return 0;
  const raw = inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : colorType === 4 ? 2 : colorType === 2 ? 3 : 1;
  const bpp = Math.max(1, Math.ceil((channels * bitDepth) / 8));
  const rowBytes = Math.ceil((width * channels * bitDepth) / 8);
  const stride = rowBytes + 1;
  const out = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * stride];
    const ri = y * stride + 1;
    const oi = y * rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const rawByte = raw[ri + x];
      const a = x >= bpp ? out[oi + x - bpp] : 0;
      const up = y > 0 ? out[oi - rowBytes + x] : 0;
      const c = y > 0 && x >= bpp ? out[oi - rowBytes + x - bpp] : 0;
      let v;
      if (ft === 0) v = rawByte;
      else if (ft === 1) v = rawByte + a;
      else if (ft === 2) v = rawByte + up;
      else if (ft === 3) v = rawByte + ((a + up) >> 1);
      else {
        const p = a + up - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - c);
        v = rawByte + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c);
      }
      out[oi + x] = v & 0xff;
    }
  }
  let transparent = 0;
  const total = width * height;
  if (colorType === 3 && bitDepth === 8) {
    for (let i = 0; i < total; i++) {
      const idx = out[i];
      const al = plteAlpha && idx < plteAlpha.length ? plteAlpha[idx] : 255;
      if (al < 16) transparent++;
    }
  } else if (colorType === 3) {
    const perByte = 8 / bitDepth;
    const mask = (1 << bitDepth) - 1;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const byte = out[y * rowBytes + Math.floor(x / perByte)];
        const shift = 8 - bitDepth * ((x % perByte) + 1);
        const idx = (byte >> shift) & mask;
        const al = plteAlpha && idx < plteAlpha.length ? plteAlpha[idx] : 255;
        if (al < 16) transparent++;
      }
  } else if (channels === 4 || channels === 2) {
    const ab = bitDepth / 8;
    const px = channels * ab;
    for (let i = 0; i < total; i++) if (out[i * px + (channels - 1) * ab] < 16) transparent++;
  } else {
    return 0; // no alpha at all → fully opaque → not mono-safe
  }
  return transparent / total;
}

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
  const blobs = [];

  for (const { brand } of brandRows) {
    const key = norm(brand);
    const slug = ALIASES[key] ?? slugify(brand);
    const entry = bySlug.get(slug);
    if (!entry) {
      missed.push(brand);
      continue;
    }
    const file = join(OUT_IMG, `${slug}.png`);
    if (!existsSync(file)) {
      const res = await fetch(entry.image.optimized);
      if (!res.ok) {
        missed.push(`${brand} (download ${res.status})`);
        continue;
      }
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
    // Thin marks flatten to a clean white glyph; filled emblems become a blob.
    const frac = transparentFraction(file);
    const mono = frac >= MONO_MIN_TRANSPARENT;
    out[key] = { display: brand, logo: `/brands/${slug}.png`, mono };
    matched.push(brand);
    if (!mono) blobs.push(`${brand} (${Math.round(frac * 100)}% transparent)`);
  }

  writeFileSync(OUT_JSON, JSON.stringify(out, null, 0) + "\n");
  console.log(`[brands] matched ${matched.length}/${brandRows.length} brands`);
  console.log(`[brands] mono glyph: ${matched.length - blobs.length}; name fallback: ${blobs.length}`);
  console.log(`[brands] filled-emblem → fallback: ${blobs.join(", ")}`);
  console.log(`[brands] no logo → fallback: ${missed.join(", ")}`);
}

main().catch((err) => {
  console.error("[brands] FAILED:", err);
  process.exit(1);
});
