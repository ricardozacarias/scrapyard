// Fair-price model + deal score.
//
//   pnpm analysis scripts/fair-price.ts
//
// Per (make, model) cohort with enough active listings, fits an OLS hedonic
// regression in log-price space:
//
//   log(price) = b0 + b1*age + b2*age^2 + b3*(mileage/10k) + b4*(power/100)
//              + b5*diesel + b6*electrified
//
// (fuel dummies centered per cohort; tiny ridge on the non-intercept diagonal
// so single-fuel cohorts — e.g. all-electric models — stay solvable) with a
// robust second pass (refit after dropping >3-sigma residuals, sigma estimated
// via MAD). The fitted value is a median "fair price" for those variables; the
// residual is the deal score (positive = cheaper than expected).
//
// Outputs to out/:
//   depreciation-by-model.csv  per-model depreciation rates + fit quality
//   best-deals.csv             top active listings priced below fair value
//   evaluation-validation.csv  deal score vs standvirtual's own price rating
//   value-retention.html       retention curves for the highest-volume models
//
// Deliberately local-only: best-deals includes title/url, which the web app
// must never ship in bulk (see CLAUDE.md) — out/ is gitignored.

import * as Plot from "@observablehq/plot";

import {
  and,
  chart,
  eq,
  getDb,
  gte,
  isNotNull,
  listings,
  lte,
  or,
  printTable,
  save,
  sql,
} from "../src/_harness";

const CURRENT_YEAR = 2026;
const MIN_COHORT = 40; // listings needed to fit a per-model regression
const MIN_R2 = 0.5; // below this the "fair price" isn't trustworthy
const PREDICTORS = 7; // [1, age, age^2, km10k, power, diesel, electrified]
const RIDGE = 1e-6; // keeps degenerate (e.g. single-fuel) cohorts solvable

const ELECTRIFIED = new Set([
  "Elétrico",
  "Híbrido Plug-In",
  "Híbrido (Gasolina)",
  "Híbrido (Diesel)",
]);

interface Car {
  id: number;
  title: string | null;
  url: string | null;
  make: string;
  model: string;
  age: number;
  km10k: number;
  power: number | null;
  price: number;
  fuel: string | null;
  sellerType: string | null;
  priceEvaluation: string | null;
  region: string | null;
  isActive: boolean;
}

interface Fit {
  beta: number[];
  medianPower: number;
  dieselShare: number; // cohort fuel mix, for centering the dummies
  elecShare: number;
  r2: number;
  sigma: number; // residual std-dev of the robust (kept) set, in log space
  n: number; // cohort size
  nKept: number; // after outlier trim
  maxAge: number; // fit support — don't extrapolate beyond these
  maxKm10k: number;
}

/** Solve A x = b (dense, symmetric-ish) via Gaussian elimination w/ pivoting. */
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
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function fuelFlags(fuel: string | null): { diesel: number; elec: number } {
  if (fuel === "Diesel") return { diesel: 1, elec: 0 };
  if (fuel && ELECTRIFIED.has(fuel)) return { diesel: 0, elec: 1 };
  return { diesel: 0, elec: 0 }; // petrol / LPG / CNG / unknown = baseline
}

function designRow(
  car: Car,
  medianPower: number,
  dieselShare: number,
  elecShare: number,
): number[] {
  const pw = ((car.power ?? medianPower) - medianPower) / 100; // centered → missing ⇒ 0
  const f = fuelFlags(car.fuel);
  return [1, car.age, car.age * car.age, car.km10k, pw, f.diesel - dieselShare, f.elec - elecShare];
}

function predictLogPrice(fit: Fit, row: number[]): number {
  return row.reduce((acc, x, i) => acc + x * fit.beta[i]!, 0);
}

/** Fit one cohort: OLS, then refit without >3-sigma outliers (MAD-based). */
function fitCohort(cars: Car[]): Fit | null {
  const medianPower = median(cars.filter((c) => c.power != null).map((c) => c.power!)) || 0;
  const dieselShare = cars.reduce((a, c) => a + fuelFlags(c.fuel).diesel, 0) / cars.length;
  const elecShare = cars.reduce((a, c) => a + fuelFlags(c.fuel).elec, 0) / cars.length;
  const build = (set: Car[]) => ({
    X: set.map((c) => designRow(c, medianPower, dieselShare, elecShare)),
    y: set.map((c) => Math.log(c.price)),
  });

  let kept = cars;
  let { X, y } = build(kept);
  let beta = ols(X, y);
  if (!beta) return null;

  // Robust pass: estimate sigma via MAD of residuals, drop gross outliers, refit.
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
    nKept: kept.length,
    maxAge: Math.max(...kept.map((c) => c.age)),
    maxKm10k: Math.max(...kept.map((c) => c.km10k)),
  };
}

/** Marginal depreciation over the year from age a to a+1, as a fraction. */
function yearlyDrop(fit: Fit, a: number): number {
  return 1 - Math.exp(fit.beta[1]! + fit.beta[2]! * (2 * a + 1));
}

async function main() {
  const db = getDb();

  // Sane-universe filters: priced, active, plausible year/mileage/price.
  const rows = await db
    .select({
      id: listings.id,
      title: listings.title,
      url: listings.url,
      make: listings.make,
      model: listings.model,
      modelYear: listings.modelYear,
      mileageKm: listings.mileageKm,
      power: listings.enginePower,
      price: listings.currentPrice,
      fuel: listings.fuel,
      sellerType: listings.sellerType,
      priceEvaluation: listings.priceEvaluation,
      region: listings.region,
      isActive: listings.isActive,
    })
    .from(listings)
    .where(
      and(
        // Fit on the live market plus recently-delisted cars (their final ask
        // approximates a market-clearing price); deals stay active-only.
        // Delisted ads with a linked repost weren't sold — their successor
        // already represents the car, so they're excluded entirely.
        or(
          eq(listings.isActive, true),
          and(
            gte(listings.lastSeenAt, new Date(Date.now() - 60 * 86_400_000)),
            sql`not exists (select 1 from listings s where s.relisted_from = ${listings.id})`,
          ),
        ),
        isNotNull(listings.make),
        isNotNull(listings.model),
        isNotNull(listings.modelYear),
        isNotNull(listings.mileageKm),
        isNotNull(listings.currentPrice),
        gte(listings.currentPrice, 500),
        lte(listings.currentPrice, 300_000),
        gte(listings.modelYear, 1998),
        lte(listings.modelYear, CURRENT_YEAR + 1),
        lte(listings.mileageKm, 600_000),
      ),
    );

  const cars: Car[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    make: r.make!,
    model: r.model!,
    age: Math.max(0, CURRENT_YEAR - r.modelYear!),
    km10k: r.mileageKm! / 10_000,
    power: r.power,
    price: r.price!,
    fuel: r.fuel,
    sellerType: r.sellerType,
    priceEvaluation: r.priceEvaluation,
    region: r.region,
    isActive: r.isActive,
  }));
  const activeN = cars.filter((c) => c.isActive).length;
  console.log(
    `universe: ${cars.length} recent priced listings (${activeN} active + ${cars.length - activeN} recently sold)`,
  );

  const cohorts = new Map<string, Car[]>();
  for (const c of cars) {
    const key = `${c.make} ${c.model}`;
    (cohorts.get(key) ?? cohorts.set(key, []).get(key)!).push(c);
  }

  // ── Fit every cohort ──────────────────────────────────────────────────────
  const fits = new Map<string, Fit>();
  for (const [key, set] of cohorts) {
    if (set.length < MIN_COHORT) continue;
    const fit = fitCohort(set);
    if (fit) fits.set(key, fit);
  }
  const usable = [...fits.entries()].filter(([, f]) => f.r2 >= MIN_R2);
  const covered = usable.reduce((a, [k]) => a + cohorts.get(k)!.length, 0);
  console.log(
    `fitted ${fits.size} cohorts (≥${MIN_COHORT} listings), ` +
      `${usable.length} with r² ≥ ${MIN_R2} covering ${covered} listings ` +
      `(${((100 * covered) / cars.length).toFixed(1)}% of universe)`,
  );

  // ── 1. Depreciation table ─────────────────────────────────────────────────
  const depreciation = usable
    .map(([key, f]) => {
      const set = cohorts.get(key)!;
      return {
        model: key,
        listings: f.n,
        medianPrice: Math.round(median(set.map((c) => c.price))),
        "drop%/yr @age3": +(100 * yearlyDrop(f, 2)).toFixed(1),
        "drop%/yr @age8": +(100 * yearlyDrop(f, 7)).toFixed(1),
        "drop% per 10k km": +(100 * (1 - Math.exp(f.beta[3]!))).toFixed(1),
        r2: +f.r2.toFixed(2),
      };
    })
    .sort((a, b) => b.listings - a.listings);
  save("depreciation-by-model", depreciation);
  printTable(depreciation.slice(0, 20));

  // ── 2. Value-retention curves for the highest-volume models ──────────────
  const topModels = depreciation.slice(0, 10).map((d) => d.model);
  const curvePts: { model: string; age: number; retention: number }[] = [];
  for (const key of topModels) {
    const f = fits.get(key)!;
    const at = (age: number) =>
      predictLogPrice(f, [1, age, age * age, (1.5 * age * 10_000) / 10_000, 0, 0, 0]);
    const base = at(1);
    for (let age = 1; age <= Math.min(12, f.maxAge); age++) {
      curvePts.push({ model: key, age, retention: 100 * Math.exp(at(age) - base) });
    }
  }
  chart("value-retention", {
    title: "Predicted value retention (age-1 value = 100, mileage 15k km/yr)",
    width: 800,
    height: 420,
    x: { label: "vehicle age (years)" },
    y: { label: "% of age-1 value", grid: true },
    color: { legend: true },
    marks: [
      Plot.line(curvePts, { x: "age", y: "retention", stroke: "model", curve: "natural" }),
      Plot.dot(curvePts, { x: "age", y: "retention", stroke: "model", r: 2 }),
    ],
  });

  // ── 3. Best deals ─────────────────────────────────────────────────────────
  const deals: Record<string, unknown>[] = [];
  for (const [key, f] of usable) {
    for (const c of cohorts.get(key)!) {
      // Deals must be buyable: delisted cars inform the fit, not the list.
      if (!c.isActive) continue;
      // Stay inside the fit's support — no extrapolated "fair prices".
      if (c.age > f.maxAge || c.km10k > f.maxKm10k) continue;
      const expected = Math.exp(predictLogPrice(f, designRow(c, f.medianPower, f.dieselShare, f.elecShare)));
      const discount = 1 - c.price / expected;
      // <15% isn't a deal; >60% below fair is salvage/scam/typo territory.
      if (discount < 0.15 || discount > 0.6) continue;
      if (c.price < 2_000) continue;
      deals.push({
        model: key,
        year: CURRENT_YEAR - c.age,
        km: Math.round(c.km10k * 10_000),
        price: c.price,
        expected: Math.round(expected),
        "discount%": +(100 * discount).toFixed(1),
        saved: Math.round(expected - c.price),
        svSays: c.priceEvaluation,
        seller: c.sellerType,
        region: c.region,
        title: c.title,
        url: c.url,
      });
    }
  }
  // The same physical car is often posted more than once (different external
  // ids) — collapse identical (model, year, km, price) rows.
  const seen = new Set<string>();
  const unique = deals.filter((d) => {
    const k = `${d.model}|${d.year}|${d.km}|${d.price}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  unique.sort((a, b) => (b["discount%"] as number) - (a["discount%"] as number));
  save("best-deals", unique.slice(0, 100));
  printTable(
    unique.slice(0, 15).map(({ title: _t, url: _u, ...rest }) => rest),
  );

  // Second cut: cheap old high-mileage cars top the raw %-discount list, but
  // there the "discount" is usually unobserved condition. Restrict to newer,
  // higher-value cars and rank by absolute € below fair value.
  const quality = unique
    .filter(
      (d) =>
        (d.price as number) >= 8_000 &&
        (d.year as number) >= CURRENT_YEAR - 8 &&
        (d.km as number) <= 180_000,
    )
    .sort((a, b) => (b.saved as number) - (a.saved as number));
  save("best-deals-recent", quality.slice(0, 100));
  console.log("\nBest deals — 2018+, ≥€8k, ≤180k km, by € below fair value:");
  printTable(
    quality.slice(0, 15).map(({ title: _t, url: _u, ...rest }) => rest),
  );

  // ── 4. Validation against standvirtual's own rating ──────────────────────
  const byEval = new Map<string, number[]>();
  for (const [key, f] of usable) {
    for (const c of cohorts.get(key)!) {
      if (!c.priceEvaluation || c.age > f.maxAge || c.km10k > f.maxKm10k) continue;
      const expected = Math.exp(predictLogPrice(f, designRow(c, f.medianPower, f.dieselShare, f.elecShare)));
      const bucket = byEval.get(c.priceEvaluation) ?? [];
      bucket.push(100 * (1 - c.price / expected));
      byEval.set(c.priceEvaluation, bucket);
    }
  }
  const validation = [...byEval.entries()]
    .map(([evaluation, discounts]) => ({
      svEvaluation: evaluation,
      listings: discounts.length,
      "median model discount%": +median(discounts).toFixed(1),
    }))
    .sort((a, b) => b["median model discount%"] - a["median model discount%"]);
  save("evaluation-validation", validation);
  printTable(validation);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
