// Shared plumbing for ad-hoc, one-off analyses.
//
// Each script under `scripts/` is a standalone tsx entry. Import from here to
// get the db client, the drizzle query builder, and helpers for printing /
// exporting results — so a new analysis is "copy a file, write one query".
//
//   pnpm analysis scripts/price-by-brand.ts
//
// Outputs written by `save()` land in `apps/analysis/out/` (gitignored).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as Plot from "@observablehq/plot";
import { JSDOM } from "jsdom";

// Re-export everything from the db package so scripts depend only on the
// harness: getDb, the tables (listings, priceHistory, regions, ...), and the
// drizzle operators (eq, and, desc, sql, count, avg, ...).
export * from "@scrapyard/db";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const OUT_DIR = resolve(HERE, "../out");

/**
 * Nothing in this repo auto-loads `.env` for CLIs (see CLAUDE.md). So if
 * DATABASE_URL isn't already in the environment, parse the repo-root `.env`
 * ourselves. Minimal KEY=VALUE parser — enough for this file's format.
 */
function loadRootEnv(): void {
  if (process.env.DATABASE_URL) return;
  let raw: string;
  try {
    raw = readFileSync(join(REPO_ROOT, ".env"), "utf8");
  } catch {
    return; // no .env file — getDb() will throw a clear error if URL is unset
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1]!;
    if (process.env[key] !== undefined) continue;
    let val = m[2]!.trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadRootEnv();

type Row = Record<string, unknown>;

/** Pretty-print rows as a table, with a trailing row count. */
export function printTable(rows: Row[]): void {
  if (rows.length === 0) {
    console.log("(no rows)");
    return;
  }
  console.table(rows);
  console.log(`${rows.length} row${rows.length === 1 ? "" : "s"}`);
}

function toCsv(rows: Row[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.join(",");
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n");
  return `${head}\n${body}\n`;
}

/**
 * Write rows to `out/<name>.<ext>` for sharing / spreadsheets / notebooks.
 * `format` defaults to "csv"; pass "json" for raw structured output.
 * Returns the absolute path written.
 */
export function save(name: string, rows: Row[], format: "csv" | "json" = "csv"): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, `${name}.${format}`);
  const contents = format === "json" ? JSON.stringify(rows, null, 2) : toCsv(rows);
  writeFileSync(path, contents);
  console.log(`→ wrote ${rows.length} rows to ${path}`);
  return path;
}

/**
 * Render an Observable Plot spec to a static file in `out/` — same library the
 * web app uses, so a chart prototyped here lifts cleanly into a web component.
 *
 *   chart("price-vs-year", {
 *     marks: [Plot.dot(rows, { x: "year", y: "price" })],
 *     y: { grid: true },
 *   });
 *
 * Plot returns a bare <svg> for simple plots and a <figure> wrapper when the
 * spec adds a title/caption/legend; we save the former as `.svg` and the latter
 * as a self-contained `.html` (the figure embeds its own svg + legend markup).
 * Returns the absolute path written.
 */
export function chart(name: string, options: Plot.PlotOptions): string {
  const { document } = new JSDOM("").window;
  const node = Plot.plot({ ...options, document });

  mkdirSync(OUT_DIR, { recursive: true });
  const isSvg = node.tagName.toLowerCase() === "svg";
  if (isSvg && !node.getAttribute("xmlns")) {
    node.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  const ext = isSvg ? "svg" : "html";
  const path = join(OUT_DIR, `${name}.${ext}`);
  const contents = isSvg
    ? node.outerHTML
    : `<!doctype html><meta charset="utf-8"><body style="margin:1rem;font:13px system-ui">${node.outerHTML}`;
  writeFileSync(path, contents);
  console.log(`→ wrote chart to ${path}`);
  return path;
}
