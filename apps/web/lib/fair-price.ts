import "server-only";

import { and, eq, getDb, gte, isNotNull, listings, lte, or, regions } from "@scrapyard/db";

// Fair-price model: per (make, model) cohort with enough active listings, an
// OLS hedonic regression in log-price space —
//
//   log(price) = b0 + b1*age + b2*age^2 + b3*(mileage/10k) + b4*(power/100)
//              + b5*diesel + b6*electrified
//
// (fuel dummies centered per cohort; tiny ridge on the non-intercept diagonal
// so single-fuel cohorts stay solvable) with a robust second pass (refit after
// dropping >3-sigma residuals, sigma via MAD). The fitted value is a median
// "fair price" for those variables; the residual is the deal score. Prototyped
// in apps/analysis/scripts/fair-price.ts — keep the two fits in sync.
//
// Data exposure (see CLAUDE.md): everything in `models` / `validation` is an
// aggregate and safe to ship to the client. Deal rows carry title/url; they
// leave the server only through `queryDeals` (called by the fetchDeals server
// action), which always returns a filtered top-N (DEAL_LIMIT) — never the pool.
// Don't raise the cap or add pagination to it.

const MIN_COHORT = 40; // listings needed to fit a per-model regression
const MIN_R2 = 0.5; // below this the "fair price" isn't trustworthy
// The fit also uses recently-delisted listings (their final ask is close to a
// market-clearing price and counters the active pool's overpriced-cars-linger
// bias), but only within this window so stale prices age out of the model.
const SOLD_WINDOW_DAYS = 60;
const PREDICTORS = 7; // [1, age, age^2, km10k, power, diesel, electrified]
const RIDGE = 1e-6; // keeps degenerate (e.g. single-fuel) cohorts solvable
const KM_PER_YEAR = 15_000; // mileage assumption for the retention curves
const DEAL_LIMIT = 25; // hard cap on rows returned per deals query

const ELECTRIFIED = new Set([
  "Elétrico",
  "Híbrido Plug-In",
  "Híbrido (Gasolina)",
  "Híbrido (Diesel)",
]);

/** Client-safe per-model aggregates (no listing identities). */
export interface FairPriceModel {
  key: string; // "VW Golf"
  n: number;
  medianPrice: number;
  dropYr3: number; // % lost over the year around age 3
  dropYr8: number; // ... around age 8
  dropPer10k: number; // % per 10,000 km
  r2: number;
  retention5: number | null; // % of age-1 value left at age 5
  curve: { age: number; retention: number }[]; // vs age-1 = 100
}

/** Server-render only — carries title/url. */
export interface FairPriceDeal {
  key: string;
  title: string | null;
  url: string | null;
  year: number;
  km: number;
  price: number;
  expected: number;
  discountPct: number;
  saved: number;
  svSays: string | null;
  sellerType: string | null;
  district: string | null;
}

export interface FairPriceData {
  universe: number; // active priced listings considered
  covered: number; // listings in a usable cohort
  models: FairPriceModel[]; // sorted by cohort size desc
  validation: { bucket: string; n: number; medianDiscountPct: number }[];
  fittedAt: string; // ISO timestamp of the cached fit
}

export interface DealFilter {
  models?: string[]; // FairPriceModel keys; empty/undefined = all
  minPrice?: number;
  maxPrice?: number;
  minYear?: number;
  maxKm?: number;
  sortBy?: "saved" | "discountPct";
}

/** Default cut: newer/higher-value cars, where the model is most trustworthy. */
export function defaultDealFilter(): DealFilter {
  return {
    minPrice: 8_000,
    minYear: new Date().getFullYear() - 8,
    maxKm: 180_000,
    sortBy: "saved",
  };
}

interface Car {
  age: number;
  km10k: number;
  power: number | null;
  fuel: string | null;
  price: number;
  priceEvaluation: string | null;
  title: string | null;
  url: string | null;
  sellerType: string | null;
  district: string | null;
  year: number;
  isActive: boolean; // false ⇒ used for fitting only, never deals/points
}

interface Fit {
  beta: number[];
  medianPower: number;
  dieselShare: number; // cohort fuel mix, for centering the dummies
  elecShare: number;
  r2: number;
  sigma: number; // residual std-dev in log space (≈ relative price spread)
  n: number;
  minAge: number; // fit support — don't extrapolate beyond these
  maxAge: number;
  maxKm10k: number;
}

/**
 * Client-safe per-model regression parameters for the "what's my car worth"
 * tool — aggregates only (coefficients + support), no listing identities.
 * Prediction happens client-side: exp(beta · [1, age, age², km/10k,
 * (power−medianPower)/100, diesel−dieselShare, elec−elecShare]).
 */
export interface ValuationModel {
  make: string;
  model: string;
  key: string;
  n: number;
  r2: number;
  beta: number[];
  medianPower: number;
  dieselShare: number;
  elecShare: number;
  sigma: number;
  minYear: number; // support expressed as model years (currentYear - maxAge …)
  maxYear: number;
  maxKm: number;
}

/**
 * One de-identified cohort listing for the valuation scatter — same exposure
 * class as the /analysis scatter (see CLAUDE.md): numeric attributes only, no
 * title/url/id, mileage rounded to 1000 km.
 */
export interface ModelPoint {
  year: number;
  km: number;
  price: number;
  fuel: "petrol" | "diesel" | "elec";
  power: number | null;
  /** Delisted within SOLD_WINDOW_DAYS — drawn as a ghost dot, not competition. */
  sold: boolean;
}

/** Solve A x = b via Gauss-Jordan elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[pivot]![col]!)) pivot = r;
    }
    if (Math.abs(M[pivot]![col]!) < 1e-10) return null; // singular
    [M[col], M[pivot]] = [M[pivot]!, M[col]!];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]! / M[col]![col]!;
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

/** OLS of y on X via normal equations, with a tiny ridge on the non-intercept
 *  diagonal so constant (centered-to-zero) columns don't make XtX singular. */
function ols(X: number[][], y: number[]): number[] | null {
  const k = X[0]!.length;
  const XtX = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const Xty = new Array<number>(k).fill(0);
  for (let i = 0; i < X.length; i++) {
    const row = X[i]!;
    for (let a = 0; a < k; a++) {
      Xty[a]! += row[a]! * y[i]!;
      for (let b = a; b < k; b++) XtX[a]![b]! += row[a]! * row[b]!;
    }
  }
  for (let a = 0; a < k; a++) for (let b = 0; b < a; b++) XtX[a]![b] = XtX[b]![a]!;
  for (let a = 1; a < k; a++) XtX[a]![a]! += RIDGE;
  return solve(XtX, Xty);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length === 0 ? 0 : s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function fuelFlags(fuel: string | null): { diesel: number; elec: number } {
  if (fuel === "Diesel") return { diesel: 1, elec: 0 };
  if (fuel && ELECTRIFIED.has(fuel)) return { diesel: 0, elec: 1 };
  return { diesel: 0, elec: 0 }; // petrol / LPG / CNG / unknown = baseline
}

function designRow(car: Car, fit: Pick<Fit, "medianPower" | "dieselShare" | "elecShare">): number[] {
  const pw = ((car.power ?? fit.medianPower) - fit.medianPower) / 100; // centered → missing ⇒ 0
  const f = fuelFlags(car.fuel);
  return [
    1,
    car.age,
    car.age * car.age,
    car.km10k,
    pw,
    f.diesel - fit.dieselShare,
    f.elec - fit.elecShare,
  ];
}

function predict(fit: Fit, row: number[]): number {
  return row.reduce((acc, x, i) => acc + x * fit.beta[i]!, 0);
}

function fitCohort(cars: Car[]): Fit | null {
  const medianPower = median(cars.filter((c) => c.power != null).map((c) => c.power!)) || 0;
  const dieselShare = cars.reduce((a, c) => a + fuelFlags(c.fuel).diesel, 0) / cars.length;
  const elecShare = cars.reduce((a, c) => a + fuelFlags(c.fuel).elec, 0) / cars.length;
  const shares = { medianPower, dieselShare, elecShare };
  const build = (set: Car[]) => ({
    X: set.map((c) => designRow(c, shares)),
    y: set.map((c) => Math.log(c.price)),
  });

  let kept = cars;
  let { X, y } = build(kept);
  let beta = ols(X, y);
  if (!beta) return null;

  const resid = y.map((yi, i) => yi - X[i]!.reduce((a, x, j) => a + x * beta![j]!, 0));
  const mad = median(resid.map((r) => Math.abs(r - median(resid))));
  const sigmaMad = 1.4826 * mad;
  if (sigmaMad > 0) {
    const inliers = cars.filter((_, i) => Math.abs(resid[i]!) <= 3 * sigmaMad);
    if (inliers.length >= PREDICTORS * 4 && inliers.length < cars.length) {
      kept = inliers;
      ({ X, y } = build(kept));
      const refit = ols(X, y);
      if (refit) beta = refit;
    }
  }

  const fitted = X.map((row) => row.reduce((a, x, j) => a + x * beta![j]!, 0));
  const meanY = y.reduce((a, b) => a + b, 0) / y.length;
  const ssTot = y.reduce((a, yi) => a + (yi - meanY) ** 2, 0);
  const ssRes = y.reduce((a, yi, i) => a + (yi - fitted[i]!) ** 2, 0);
  if (ssTot === 0) return null;

  return {
    beta,
    medianPower,
    dieselShare,
    elecShare,
    r2: 1 - ssRes / ssTot,
    sigma: Math.sqrt(ssRes / Math.max(1, y.length - PREDICTORS)),
    n: cars.length,
    minAge: Math.min(...kept.map((c) => c.age)),
    maxAge: Math.max(...kept.map((c) => c.age)),
    maxKm10k: Math.max(...kept.map((c) => c.km10k)),
  };
}

/** Marginal depreciation over the year from age a to a+1, as a fraction. */
function yearlyDrop(fit: Fit, a: number): number {
  return 1 - Math.exp(fit.beta[1]! + fit.beta[2]! * (2 * a + 1));
}

interface FitResult {
  data: FairPriceData;
  /** Full deduped pool of scored deals — server memory only, never shipped. */
  allDeals: FairPriceDeal[];
  /** Client-safe regression params for the valuation tool. */
  valuation: ValuationModel[];
  /** De-identified cohort points per model key, for the valuation scatter. */
  points: Map<string, ModelPoint[]>;
}

async function compute(): Promise<FitResult> {
  const db = getDb();
  const currentYear = new Date().getFullYear();

  const rows = await db
    .select({
      title: listings.title,
      url: listings.url,
      make: listings.make,
      model: listings.model,
      modelYear: listings.modelYear,
      mileageKm: listings.mileageKm,
      power: listings.enginePower,
      fuel: listings.fuel,
      price: listings.currentPrice,
      priceEvaluation: listings.priceEvaluation,
      sellerType: listings.sellerType,
      district: regions.name,
      isActive: listings.isActive,
    })
    .from(listings)
    .leftJoin(regions, eq(listings.regionId, regions.id))
    .where(
      and(
        or(
          eq(listings.isActive, true),
          gte(listings.lastSeenAt, new Date(Date.now() - SOLD_WINDOW_DAYS * 86_400_000)),
        ),
        isNotNull(listings.make),
        isNotNull(listings.model),
        isNotNull(listings.modelYear),
        isNotNull(listings.mileageKm),
        isNotNull(listings.currentPrice),
        gte(listings.currentPrice, 500),
        lte(listings.currentPrice, 300_000),
        gte(listings.modelYear, 1998),
        lte(listings.modelYear, currentYear + 1),
        lte(listings.mileageKm, 600_000),
        // continental Portugal only, matching lib/queries.ts
        isNotNull(listings.regionId),
      ),
    );

  const cohorts = new Map<string, Car[]>();
  const cohortMeta = new Map<string, { make: string; model: string }>();
  for (const r of rows) {
    const key = `${r.make} ${r.model}`;
    if (!cohortMeta.has(key)) cohortMeta.set(key, { make: r.make!, model: r.model! });
    const car: Car = {
      age: Math.max(0, currentYear - r.modelYear!),
      km10k: r.mileageKm! / 10_000,
      power: r.power,
      fuel: r.fuel,
      price: r.price!,
      priceEvaluation: r.priceEvaluation,
      title: r.title,
      url: r.url,
      sellerType: r.sellerType,
      district: r.district,
      year: r.modelYear!,
      isActive: r.isActive,
    };
    (cohorts.get(key) ?? cohorts.set(key, []).get(key)!).push(car);
  }

  const usable: [string, Fit][] = [];
  for (const [key, set] of cohorts) {
    if (set.length < MIN_COHORT) continue;
    const fit = fitCohort(set);
    if (fit && fit.r2 >= MIN_R2) usable.push([key, fit]);
  }

  const models: FairPriceModel[] = usable
    .map(([key, f]) => {
      const set = cohorts.get(key)!;
      const at = (age: number) =>
        predict(f, [1, age, age * age, (KM_PER_YEAR * age) / 10_000, 0, 0, 0]);
      const base = at(1);
      const curve: { age: number; retention: number }[] = [];
      for (let age = 1; age <= Math.min(12, f.maxAge); age++) {
        curve.push({ age, retention: +(100 * Math.exp(at(age) - base)).toFixed(1) });
      }
      return {
        key,
        n: f.n,
        medianPrice: Math.round(median(set.map((c) => c.price))),
        dropYr3: +(100 * yearlyDrop(f, 2)).toFixed(1),
        dropYr8: +(100 * yearlyDrop(f, 7)).toFixed(1),
        dropPer10k: +(100 * (1 - Math.exp(f.beta[3]!))).toFixed(1),
        r2: +f.r2.toFixed(2),
        retention5: curve.find((p) => p.age === 5)?.retention ?? null,
        curve,
      };
    })
    .sort((a, b) => b.n - a.n);

  // Deals + validation, scoring each cohort listing against its fit (inside
  // the fit's support only — no extrapolated fair prices).
  const allDeals: FairPriceDeal[] = [];
  const byEval = new Map<string, number[]>();
  for (const [key, f] of usable) {
    for (const c of cohorts.get(key)!) {
      if (c.age > f.maxAge || c.km10k > f.maxKm10k) continue;
      const expected = Math.exp(predict(f, designRow(c, f)));
      const discount = 1 - c.price / expected;
      if (c.priceEvaluation) {
        const bucket = byEval.get(c.priceEvaluation) ?? [];
        bucket.push(100 * discount);
        byEval.set(c.priceEvaluation, bucket);
      }
      // Deals must be buyable: delisted cars inform the fit, not the list.
      if (!c.isActive) continue;
      // <15% isn't a deal; >60% below fair is salvage/scam/typo territory.
      if (discount < 0.15 || discount > 0.6 || c.price < 2_000) continue;
      allDeals.push({
        key,
        title: c.title,
        url: c.url,
        year: c.year,
        km: Math.round(c.km10k * 10_000),
        price: c.price,
        expected: Math.round(expected),
        discountPct: +(100 * discount).toFixed(1),
        saved: Math.round(expected - c.price),
        svSays: c.priceEvaluation,
        sellerType: c.sellerType,
        district: c.district,
      });
    }
  }

  // The same physical car is often posted more than once — collapse dupes.
  const seen = new Set<string>();
  const deduped = allDeals.filter((d) => {
    const k = `${d.key}|${d.year}|${d.km}|${d.price}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const validation = [...byEval.entries()]
    .map(([bucket, discounts]) => ({
      bucket,
      n: discounts.length,
      medianDiscountPct: +median(discounts).toFixed(1),
    }))
    .sort((a, b) => b.medianDiscountPct - a.medianDiscountPct);

  const points = new Map<string, ModelPoint[]>();
  for (const [key] of usable) {
    points.set(
      key,
      // Live market plus recently-sold ghosts; the client separates them.
      cohorts.get(key)!.map((c) => {
        const flags = fuelFlags(c.fuel);
        return {
          year: c.year,
          km: Math.round((c.km10k * 10_000) / 1000) * 1000,
          price: c.price,
          fuel: flags.diesel ? ("diesel" as const) : flags.elec ? ("elec" as const) : ("petrol" as const),
          power: c.power,
          sold: !c.isActive,
        };
      }),
    );
  }

  const valuation: ValuationModel[] = usable
    .map(([key, f]) => {
      const meta = cohortMeta.get(key)!;
      return {
        make: meta.make,
        model: meta.model,
        key,
        n: f.n,
        r2: +f.r2.toFixed(2),
        beta: f.beta.map((b) => +b.toPrecision(6)),
        medianPower: f.medianPower,
        dieselShare: +f.dieselShare.toFixed(3),
        elecShare: +f.elecShare.toFixed(3),
        sigma: +f.sigma.toFixed(4),
        minYear: currentYear - f.maxAge,
        maxYear: currentYear - f.minAge,
        maxKm: Math.round(f.maxKm10k * 10_000),
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  return {
    data: {
      universe: rows.length,
      covered: usable.reduce((a, [k]) => a + cohorts.get(k)!.length, 0),
      models,
      validation,
      fittedAt: new Date().toISOString(),
    },
    allDeals: deduped,
    valuation,
    points,
  };
}

// The fit reads ~45k rows and data only changes once a day (daily cron), so
// memoize per server instance with a TTL instead of hitting Neon per request.
let cached: { at: number; result: FitResult } | null = null;
let inflight: Promise<FitResult> | null = null;
const TTL_MS = 30 * 60 * 1000;

async function getFit(): Promise<FitResult> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.result;
  if (!inflight) {
    inflight = compute()
      .then((result) => {
        cached = { at: Date.now(), result };
        return result;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export async function getFairPriceData(): Promise<FairPriceData> {
  return (await getFit()).data;
}

/** Per-model regression params for the client-side valuation tool (aggregates only). */
export async function getValuationModels(): Promise<ValuationModel[]> {
  return (await getFit()).valuation;
}

const POINT_LIMIT = 1200; // cap the scatter payload for very large cohorts

/** De-identified cohort points for one model's valuation scatter. */
export async function getModelPoints(key: string): Promise<ModelPoint[]> {
  const all = (await getFit()).points.get(key) ?? [];
  if (all.length <= POINT_LIMIT) return all;
  // Deterministic thinning (every nth) — keeps the cloud's shape without RNG.
  const step = all.length / POINT_LIMIT;
  const out: ModelPoint[] = [];
  for (let i = 0; i < all.length; i += step) out.push(all[Math.floor(i)]!);
  return out.slice(0, POINT_LIMIT);
}

/**
 * Filtered top-N deals. The DEAL_LIMIT cap is the exposure boundary — callers
 * (the fetchDeals server action) get at most one screenful per query, never
 * the pool.
 */
export async function queryDeals(f: DealFilter): Promise<FairPriceDeal[]> {
  const { allDeals } = await getFit();
  const modelSet = f.models && f.models.length > 0 ? new Set(f.models) : null;
  const sortBy = f.sortBy === "discountPct" ? "discountPct" : "saved";
  return allDeals
    .filter(
      (d) =>
        (!modelSet || modelSet.has(d.key)) &&
        (f.minPrice === undefined || d.price >= f.minPrice) &&
        (f.maxPrice === undefined || d.price <= f.maxPrice) &&
        (f.minYear === undefined || d.year >= f.minYear) &&
        (f.maxKm === undefined || d.km <= f.maxKm),
    )
    .sort((a, b) => b[sortBy] - a[sortBy])
    .slice(0, DEAL_LIMIT);
}
