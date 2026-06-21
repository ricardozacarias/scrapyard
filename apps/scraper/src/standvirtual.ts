import { load, type CheerioAPI, type Cheerio } from "cheerio";
import type { Element } from "domhandler";

const BASE = "https://www.standvirtual.com";

export interface ParsedListing {
  externalId: string;
  title: string | null;
  url: string;
  city: string | null;
  region: string | null;
  sellerType: string | null;
  price: number | null;
  currency: string | null;
  brand: string | null;
  fuel: string | null;
  modelYear: number | null;
  mileageKm: number | null;
}

// Real listing IDs are an uppercase "ID" prefix + alphanumerics, e.g. ID8Q0vzr.
// Must be case-SENSITIVE and alphanumeric-only: a case-insensitive /id/ would
// match the "id" inside slug words ("hybrid", "tids", "vw-id-3") and capture
// junk, corrupting externalId (our dedupe key).
const ID_RE = /ID([A-Za-z0-9]+)\.html/;
const INT_RE = /\d[\d .]*/;

// Multiword brand prefixes so "Alfa Romeo Giulia" -> "Alfa Romeo", not "Alfa".
const MULTIWORD_BRANDS = [
  "alfa romeo",
  "aston martin",
  "land rover",
  "mercedes-benz",
  "mercedes benz",
];

function toInt(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = String(text).replace(/[ .]/g, "");
  const n = Number.parseInt(cleaned, 10);
  return Number.isNaN(n) ? null : n;
}

/** Realistic browser-ish headers — plain library defaults get blocked faster. */
function browserHeaders(): Record<string, string> {
  return {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetch one search-results page, with retry + exponential backoff. */
export async function fetchHtml(
  maxPrice: number | undefined,
  page: number,
  retries = 3,
): Promise<string> {
  const params = new URLSearchParams({ page: String(page) });
  if (maxPrice !== undefined) {
    params.set("search[filter_float_price:to]", String(maxPrice));
  }
  const url = `${BASE}/carros?${params.toString()}`;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: browserHeaders(),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const backoff = 1000 * 2 ** attempt + Math.floor(Math.random() * 500);
        console.warn(
          `[fetch] page ${page} attempt ${attempt + 1} failed: ${String(err)}; ` +
            `retrying in ${backoff}ms`,
        );
        await sleep(backoff);
      }
    }
  }
  throw new Error(`Failed to fetch page ${page} after ${retries + 1} attempts: ${String(lastErr)}`);
}

function findResultCards($: CheerioAPI): Cheerio<Element>[] {
  const container = $('[data-testid="search-results"]').first();
  if (container.length === 0) return [];
  const cards: Cheerio<Element>[] = [];
  container.find("article").each((_, art) => {
    const a = $(art).find("a[href]").first();
    const href = a.attr("href") ?? "";
    if (href.includes("/carros/anuncio/") && href.includes("ID") && href.endsWith(".html")) {
      cards.push($(art));
    }
  });
  return cards;
}

function extractUrlAndId($: CheerioAPI, art: Cheerio<Element>): [string | null, string | null] {
  const href = art.find("a[href]").first().attr("href");
  if (!href) return [null, null];
  const url = new URL(href, BASE).toString();
  const m = ID_RE.exec(url);
  return [url, m ? m[1] ?? null : null];
}

function extractTitle(art: Cheerio<Element>): string | null {
  const h = art.find("h2, h3").first();
  const t = h.text().trim();
  return t || null;
}

function extractParams($: CheerioAPI, art: Cheerio<Element>): Record<string, string | null> {
  const param = (name: string): string | null => {
    const dd = art.find(`dd[data-parameter="${name}"]`).first();
    const t = dd.text().replace(/\s+/g, " ").trim();
    return t || null;
  };
  return {
    mileage: param("mileage"),
    fuel_type: param("fuel_type"),
    gearbox: param("gearbox"),
    first_registration_year: param("first_registration_year"),
  };
}

// Location: "City (Region)" e.g. "Porto (Porto)" or "Sintra (Lisboa)".
const LOCATION_RE = /^([^()•€]+?)\s*\(([^)]+)\)\s*$/;

function extractLocationAndSeller(
  $: CheerioAPI,
  art: Cheerio<Element>,
): [string | null, string | null, string | null] {
  let city: string | null = null;
  let region: string | null = null;
  let sellerType: string | null = null;

  // Location and seller each live in their own <p> within the card.
  art.find("p").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (!t) return;

    if (city === null) {
      const m = LOCATION_RE.exec(t);
      if (m) {
        city = (m[1] ?? "").trim() || null;
        region = (m[2] ?? "").trim() || null;
      }
    }
    if (sellerType === null) {
      if (t.includes("Profissional")) sellerType = "Profissional";
      else if (t.includes("Particular")) sellerType = "Particular";
    }
  });

  return [city, region, sellerType];
}

function extractPriceCurrency($: CheerioAPI, art: Cheerio<Element>): [number | null, string | null] {
  let price: number | null = null;
  let currency: string | null = null;
  const h3s = art.find("h3");
  for (let i = 0; i < h3s.length; i++) {
    const h3 = h3s.eq(i);
    const text = h3.text().trim();
    const m = INT_RE.exec(text);
    if (m) {
      price = toInt(m[0]);
      const sib = h3.next("p");
      if (sib.length) currency = sib.text().trim() || null;
      break;
    }
  }
  if (price !== null && !currency) currency = "EUR";
  return [price, currency];
}

function extractBrandFromTitle(title: string | null): string | null {
  if (!title) return null;
  const low = title.toLowerCase();
  for (const b of MULTIWORD_BRANDS) {
    if (low.startsWith(b + " ")) return title.slice(0, b.length);
  }
  return title.split(/\s+/)[0] ?? null;
}

export function parsePage(html: string): ParsedListing[] {
  const $ = load(html);
  const cards = findResultCards($);
  const out: ParsedListing[] = [];

  for (const art of cards) {
    const [url, externalId] = extractUrlAndId($, art);
    if (!url || !externalId) continue;

    const title = extractTitle(art);
    const [city, region, sellerType] = extractLocationAndSeller($, art);
    const [price, currency] = extractPriceCurrency($, art);
    const params = extractParams($, art);

    let mileageKm: number | null = null;
    if (params.mileage) {
      const m = INT_RE.exec(params.mileage);
      mileageKm = m ? toInt(m[0]) : null;
    }
    const fuel = params.fuel_type
      ? params.fuel_type.charAt(0).toUpperCase() + params.fuel_type.slice(1).toLowerCase()
      : null;
    const modelYear = toInt(params.first_registration_year);
    const brand = extractBrandFromTitle(title);

    out.push({
      externalId,
      title,
      url,
      city,
      region,
      sellerType,
      price,
      currency,
      brand,
      fuel,
      modelYear,
      mileageKm,
    });
  }
  return out;
}

/** De-dupe by externalId, keeping first occurrence. */
export function dedupe(records: ParsedListing[]): ParsedListing[] {
  const seen = new Set<string>();
  const out: ParsedListing[] = [];
  for (const r of records) {
    if (seen.has(r.externalId)) continue;
    seen.add(r.externalId);
    out.push(r);
  }
  return out;
}

export interface ScrapeOptions {
  maxPrice?: number;
  pages: number;
  politeDelayMs?: [number, number];
  /** Flush accumulated listings via onFlush every N pages (and once at the end). */
  flushEvery?: number;
  /**
   * Called with the listings scraped since the last flush. When provided, scrape()
   * streams batches to the caller (durable mid-run ingestion) instead of buffering
   * everything; it returns an empty array. When omitted, scrape() buffers and
   * returns the full de-duped list as before.
   */
  onFlush?: (records: ParsedListing[]) => Promise<void>;
}

/**
 * Fetch up to N pages. Without onFlush, returns the full de-duped list. With
 * onFlush, streams batches every `flushEvery` pages (+ a final partial batch) and
 * returns an empty array, so a deep run never holds the whole catalog in memory
 * and already-flushed pages survive a later failure.
 */
export async function scrape(opts: ScrapeOptions): Promise<ParsedListing[]> {
  const { maxPrice, pages, flushEvery, onFlush } = opts;
  const [lo, hi] = opts.politeDelayMs ?? [1000, 4000];
  const all: ParsedListing[] = [];
  let buffer: ParsedListing[] = [];

  const flush = async () => {
    if (onFlush && buffer.length > 0) {
      const batch = buffer;
      buffer = [];
      await onFlush(batch);
    }
  };

  for (let page = 1; page <= pages; page++) {
    let recs = parsePage(await fetchHtml(maxPrice, page));

    // A 200-OK anti-bot interstitial parses to 0 listings just like the genuine
    // end of results. Distinguish them by re-fetching: a transient block clears,
    // the true end stays empty. Without this, one hiccup truncates a deep run.
    for (let retry = 0; recs.length === 0 && retry < 2; retry++) {
      console.warn(`[scrape] page ${page}: 0 parsed; re-fetching (${retry + 1}/2)`);
      await sleep(2000 + Math.random() * 2000);
      recs = parsePage(await fetchHtml(maxPrice, page));
    }

    console.log(`[scrape] page ${page}/${pages}: ${recs.length} listings`);
    if (recs.length === 0) break; // still empty after retries → past the last page

    if (onFlush) {
      buffer.push(...recs);
      if (flushEvery && page % flushEvery === 0) await flush();
    } else {
      all.push(...recs);
    }
    if (page < pages) await sleep(lo + Math.random() * (hi - lo));
  }

  await flush(); // emit any remaining buffered listings
  return dedupe(all); // empty when streaming via onFlush
}
