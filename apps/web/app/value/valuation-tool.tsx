"use client";

import * as Plot from "@observablehq/plot";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import type { ModelPoint, ValuationModel } from "@/lib/fair-price";
import { formatNumber, formatPrice } from "@/lib/format";

import { fetchModelPoints } from "./points-action";

// Pure client-side inference: the props are per-model regression coefficients
// (aggregates — see CLAUDE.md), so estimates are instant and nothing about the
// user's inputs leaves the browser. The scatter fetches that one model's
// de-identified points (no title/url/id) on demand via a server action.

type FuelChoice = "unknown" | "petrol" | "diesel" | "electrified";

const FUEL_OPTIONS: { value: FuelChoice; label: string }[] = [
  { value: "unknown", label: "Not sure" },
  { value: "petrol", label: "Gasolina / GPL" },
  { value: "diesel", label: "Diesel" },
  { value: "electrified", label: "Elétrico / Híbrido" },
];

const FUEL_LABEL: Record<ModelPoint["fuel"], string> = {
  petrol: "Gasolina / GPL",
  diesel: "Diesel",
  elec: "Elétrico / Híbrido",
};
const FUEL_COLOR: Record<string, string> = {
  "Gasolina / GPL": "#8c8c84",
  Diesel: "#7aa2f7",
  "Elétrico / Híbrido": "#4fd1a1",
};

const TIP_STYLE = { fill: "#14140f", stroke: "#3f3f35" };

const FUEL_OF: Record<ModelPoint["fuel"], FuelChoice> = {
  petrol: "petrol",
  diesel: "diesel",
  elec: "electrified",
};

/** Same year (and same fuel, when one is chosen) — the user's direct competition. */
function isPeer(p: ModelPoint, yearNum: number | null, fuel: FuelChoice): boolean {
  return yearNum !== null && p.year === yearNum && (fuel === "unknown" || FUEL_OF[p.fuel] === fuel);
}

interface Estimate {
  mid: number;
  low: number;
  high: number;
  extrapolated: string | null;
}

function predictAt(
  m: ValuationModel,
  year: number,
  km: number,
  fuel: FuelChoice,
  power: number | undefined,
): { mid: number; low: number; high: number } {
  const currentYear = new Date().getFullYear();
  const age = Math.max(0, currentYear - year);
  const pw = ((power ?? m.medianPower) - m.medianPower) / 100;
  const d = fuel === "unknown" ? 0 : (fuel === "diesel" ? 1 : 0) - m.dieselShare;
  const e = fuel === "unknown" ? 0 : (fuel === "electrified" ? 1 : 0) - m.elecShare;
  const row = [1, age, age * age, km / 10_000, pw, d, e];
  const logPrice = row.reduce((acc, x, i) => acc + x * m.beta[i]!, 0);
  return {
    mid: Math.exp(logPrice),
    low: Math.exp(logPrice - m.sigma),
    high: Math.exp(logPrice + m.sigma),
  };
}

function estimate(
  m: ValuationModel,
  year: number,
  km: number,
  fuel: FuelChoice,
  power: number | undefined,
): Estimate {
  const p = predictAt(m, year, km, fuel, power);
  const warnings: string[] = [];
  if (year < m.minYear || year > m.maxYear) {
    warnings.push(`the model was fitted on ${m.minYear}–${m.maxYear} cars`);
  }
  if (km > m.maxKm) {
    warnings.push(`on mileages up to ${formatNumber(m.maxKm)} km`);
  }
  return { ...p, extrapolated: warnings.length > 0 ? warnings.join(" and ") : null };
}

interface Confidence {
  level: "high" | "medium" | "low";
  reason: string;
}

function confidenceFor(m: ValuationModel, e: Estimate, powerOutside: boolean): Confidence {
  if (e.extrapolated || powerOutside) return { level: "low", reason: "inputs outside the fitted data" };
  if (m.n < 60) return { level: "low", reason: "few comparable listings" };
  if (m.r2 < 0.7) return { level: "low", reason: "prices vary a lot within this model" };
  if (m.r2 >= 0.85 && m.n >= 150) return { level: "high", reason: "large sample, tight fit" };
  return { level: "medium", reason: m.n < 150 ? "moderate sample" : "moderate fit" };
}

export default function ValuationTool({ models }: { models: ValuationModel[] }) {
  const makes = useMemo(() => [...new Set(models.map((m) => m.make))].sort(), [models]);

  const [make, setMake] = useState("");
  const [modelKey, setModelKey] = useState("");
  const [year, setYear] = useState("");
  const [km, setKm] = useState("");
  const [fuel, setFuel] = useState<FuelChoice>("unknown");
  const [power, setPower] = useState("");
  const [xKey, setXKey] = useState<"km" | "year">("km");

  const [points, setPoints] = useState<ModelPoint[] | null>(null);
  const [, startTransition] = useTransition();

  const wrapRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const update = () => setWidth(el.clientWidth || 800);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const makeModels = useMemo(
    () => models.filter((m) => m.make === make).sort((a, b) => b.n - a.n),
    [models, make],
  );
  const selected = models.find((m) => m.key === modelKey);

  // Fetch the cohort's de-identified points whenever the model changes.
  useEffect(() => {
    setPoints(null);
    if (!modelKey) return;
    let stale = false;
    startTransition(async () => {
      const pts = await fetchModelPoints(modelKey);
      if (!stale) setPoints(pts);
    });
    return () => {
      stale = true;
    };
  }, [modelKey]);

  const years = useMemo(() => {
    if (!selected) return [];
    const ys: number[] = [];
    for (let y = selected.maxYear; y >= selected.minYear; y--) ys.push(y);
    return ys;
  }, [selected]);

  const kmNum = Number(km);
  const powerNum = Number(power);
  const powerVal =
    power.trim() !== "" && Number.isFinite(powerNum) && powerNum > 0 ? powerNum : undefined;
  const kmValid = km.trim() !== "" && Number.isFinite(kmNum) && kmNum >= 0;
  const result =
    selected && year !== "" && kmValid
      ? estimate(selected, Number(year), kmNum, fuel, powerVal)
      : null;

  const peerCount = useMemo(
    () =>
      points && year !== ""
        ? points.filter((p) => !p.sold && isPeer(p, Number(year), fuel)).length
        : 0,
    [points, year, fuel],
  );

  /** Median asking price of the live same-year (and fuel) rivals. */
  const peerMedian = useMemo(() => {
    if (!points || year === "") return null;
    const prices = points
      .filter((p) => !p.sold && isPeer(p, Number(year), fuel))
      .map((p) => p.price)
      .sort((a, b) => a - b);
    if (prices.length === 0) return null;
    const m = prices.length >> 1;
    return prices.length % 2 ? prices[m]! : (prices[m - 1]! + prices[m]!) / 2;
  }, [points, year, fuel]);

  /** Most common power figures for this model — autocomplete for the cv input. */
  const commonPowers = useMemo(() => {
    if (!points) return [];
    const counts = new Map<number, number>();
    for (const p of points) {
      if (p.power != null) counts.set(p.power, (counts.get(p.power) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([v]) => v)
      .sort((a, b) => a - b);
  }, [points]);

  const powerBounds = useMemo(() => {
    if (!points) return null;
    const ps = points.filter((p) => p.power != null).map((p) => p.power!);
    return ps.length > 0 ? { min: Math.min(...ps), max: Math.max(...ps) } : null;
  }, [points]);
  const powerOutside =
    powerVal !== undefined &&
    powerBounds !== null &&
    (powerVal < powerBounds.min * 0.85 || powerVal > powerBounds.max * 1.15);

  const confidence = result && selected ? confidenceFor(selected, result, powerOutside) : null;
  const fuelMixHint =
    fuel === "unknown" && selected && (selected.dieselShare >= 0.15 || selected.elecShare >= 0.15);

  const fillExample = () => {
    if (models.length === 0) return;
    const ex = models.reduce((a, b) => (b.n > a.n ? b : a), models[0]!);
    const y = Math.max(ex.minYear, ex.maxYear - 5);
    setMake(ex.make);
    setModelKey(ex.key);
    setYear(String(y));
    setKm(String(Math.max(10_000, (new Date().getFullYear() - y) * 15_000)));
    setFuel("unknown");
    setPower("");
  };

  // ── Scatter: the model's market cloud + fair-price curve + your car ──────
  useEffect(() => {
    if (!plotRef.current) return;
    const container = plotRef.current;
    container.replaceChildren();
    if (!selected || !points || points.length === 0) return;

    const yearNum = year === "" ? null : Number(year);
    const cloud = points.map((p) => ({
      x: xKey === "km" ? p.km : p.year,
      price: p.price,
      fuel: FUEL_LABEL[p.fuel],
      peer: !p.sold && isPeer(p, yearNum, fuel),
      sold: p.sold,
      label: `${p.sold ? "sold · " : ""}${p.year} · ${formatNumber(p.km)} km${p.power ? ` · ${p.power} cv` : ""}\n${formatPrice(p.price, "EUR")}`,
    }));
    const ghosts = cloud.filter((p) => p.sold);
    const others = cloud.filter((p) => !p.sold && !p.peer);
    const peers = cloud.filter((p) => p.peer);

    const marks: Plot.Markish[] = [
      // Recently-sold ghosts: hollow, faint, underneath the live market.
      Plot.dot(ghosts, {
        x: "x",
        y: "price",
        stroke: "fuel",
        strokeOpacity: 0.3,
        r: 3,
        title: "label",
        tip: TIP_STYLE,
      }),
      Plot.dot(others, {
        x: "x",
        y: "price",
        fill: "fuel",
        r: 4,
        fillOpacity: peers.length > 0 ? 0.35 : 0.6,
        title: "label",
        tip: TIP_STYLE,
      }),
      Plot.dot(peers, {
        x: "x",
        y: "price",
        fill: "fuel",
        r: 6.5,
        fillOpacity: 1,
        stroke: "#f0f0f0",
        strokeWidth: 1.5,
        title: "label",
        tip: TIP_STYLE,
      }),
    ];

    // Fair-price curve + band at the user's inputs, along the chosen axis.
    if (result && year !== "" && kmValid) {
      const yearNum = Number(year);
      const curve: { x: number; mid: number; low: number; high: number }[] = [];
      if (xKey === "km") {
        const kmMax = Math.max(selected.maxKm, kmNum);
        for (let x = 0; x <= kmMax; x += kmMax / 80) {
          curve.push({ x, ...predictAt(selected, yearNum, x, fuel, powerVal) });
        }
      } else {
        for (let y = selected.minYear; y <= selected.maxYear; y++) {
          curve.push({ x: y, ...predictAt(selected, y, kmNum, fuel, powerVal) });
        }
      }
      marks.push(
        Plot.line(curve, { x: "x", y: "low", stroke: "#8c8c84", strokeDasharray: "4,4" }),
        Plot.line(curve, { x: "x", y: "high", stroke: "#8c8c84", strokeDasharray: "4,4" }),
        Plot.line(curve, { x: "x", y: "mid", stroke: "#ffd400", strokeWidth: 2 }),
      );

      const you = { x: xKey === "km" ? kmNum : Number(year), price: result.mid };
      marks.push(
        Plot.dot([you], { x: "x", y: "price", r: 8, fill: "#ffd400", stroke: "#111" }),
        Plot.text([you], {
          x: "x",
          y: "price",
          text: () => "your car",
          dy: -14,
          fill: "#ffd400",
          fontWeight: "bold",
        }),
      );
    }

    const plot = Plot.plot({
      width,
      height: 440,
      marginLeft: 65,
      marginBottom: 45,
      style: { background: "transparent", color: "#f0f0f0" },
      grid: true,
      x: {
        label: xKey === "km" ? "Mileage (km)" : "Model year",
        labelAnchor: "center",
        tickFormat: xKey === "year" ? (d: number) => String(d) : undefined,
      },
      y: { label: "Asking price (€)", labelAnchor: "center" },
      color: { legend: true, domain: Object.keys(FUEL_COLOR), range: Object.values(FUEL_COLOR) },
      marks,
    });
    container.append(plot);
    return () => plot.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, points, xKey, width, year, km, fuel, power]);

  return (
    <div ref={wrapRef}>
      <div className="panel">
        <div className="filters" style={{ marginBottom: 8 }}>
          <div className="field">
            <label htmlFor="val-make">Make</label>
            <select
              id="val-make"
              value={make}
              onChange={(e) => {
                setMake(e.target.value);
                setModelKey("");
                setYear("");
              }}
            >
              <option value="">—</option>
              {makes.map((mk) => (
                <option key={mk} value={mk}>
                  {mk}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="val-model">Model</label>
            <select
              id="val-model"
              value={modelKey}
              disabled={!make}
              onChange={(e) => {
                setModelKey(e.target.value);
                setYear("");
              }}
            >
              <option value="">—</option>
              {makeModels.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.model}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="val-year">Year</label>
            <select
              id="val-year"
              value={year}
              disabled={!selected}
              onChange={(e) => setYear(e.target.value)}
            >
              <option value="">—</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="val-km">Mileage (km)</label>
            <input
              id="val-km"
              type="number"
              placeholder="e.g. 120000"
              value={km}
              onChange={(e) => setKm(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="val-fuel">Fuel</label>
            <select
              id="val-fuel"
              value={fuel}
              onChange={(e) => setFuel(e.target.value as FuelChoice)}
            >
              {FUEL_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="val-power">Power (cv, optional)</label>
            <input
              id="val-power"
              type="number"
              list="val-powers"
              placeholder={selected ? `typical ${selected.medianPower}` : "—"}
              value={power}
              onChange={(e) => setPower(e.target.value)}
            />
            <datalist id="val-powers">
              {commonPowers.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
        </div>

        {result && selected && confidence ? (
          <div className="val-result">
            <div className="val-result-main">
              <div className="val-price">
                {formatPrice(Math.round(result.mid), "EUR")}
                <span className={`val-badge ${confidence.level}`}>
                  {confidence.level} confidence
                </span>
              </div>
              <div className="val-range">
                <div
                  className="val-range-marker"
                  style={{
                    left: `${Math.min(98, Math.max(2, (100 * (result.mid - result.low)) / (result.high - result.low)))}%`,
                  }}
                />
              </div>
              <div className="val-range-labels">
                <span>{formatPrice(Math.round(result.low), "EUR")}</span>
                <span>fair range</span>
                <span>{formatPrice(Math.round(result.high), "EUR")}</span>
              </div>
            </div>
            <div className="val-facts">
              <span className="muted">
                Based on {formatNumber(selected.n)} recent {selected.key} listings (fit R²{" "}
                {selected.r2.toFixed(2)}) — {confidence.reason}.
              </span>
              <span className="muted">
                {peerCount > 0 && peerMedian !== null ? (
                  <>
                    Direct competition: {peerCount} same-year
                    {fuel !== "unknown" ? ", same-fuel" : ""} listing
                    {peerCount === 1 ? "" : "s"}, median{" "}
                    {formatPrice(Math.round(peerMedian), "EUR")}.
                  </>
                ) : points !== null ? (
                  "No same-year listings on the market right now — less to haggle against."
                ) : (
                  "Loading market context…"
                )}
              </span>
              {fuelMixHint && (
                <span className="muted">
                  Assumes this model&apos;s typical fuel mix — pick a fuel to sharpen the estimate.
                </span>
              )}
              {result.extrapolated && (
                <span style={{ color: "var(--gauge-mid)" }}>
                  ⚠ Outside the fitted data ({result.extrapolated}) — treat as a rough
                  extrapolation.
                </span>
              )}
              {powerOutside && powerBounds && (
                <span style={{ color: "var(--gauge-mid)" }}>
                  ⚠ {powerVal} cv is outside the {powerBounds.min}–{powerBounds.max} cv seen for
                  this model.
                </span>
              )}
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 4 }}>
            <p className="muted">
              {make === ""
                ? "Pick a make to get started. Only models with at least 40 recent listings can be valued."
                : !modelKey
                  ? "Pick a model."
                  : "Pick the year and enter the mileage to get an estimate."}
            </p>
            {make === "" && (
              <button type="button" className="btn secondary" onClick={fillExample}>
                Try an example
              </button>
            )}
          </div>
        )}
      </div>

      {selected && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="filters" style={{ marginBottom: 6 }}>
            <div className="field">
              <label htmlFor="val-x">Chart axis</label>
              <select
                id="val-x"
                value={xKey}
                onChange={(e) => setXKey(e.target.value as "km" | "year")}
              >
                <option value="km">Price vs mileage</option>
                <option value="year">Price vs year</option>
              </select>
            </div>
          </div>
          {points === null ? (
            <p className="muted">Loading {selected.key} listings…</p>
          ) : points.length === 0 ? (
            <p className="muted">No points available for this model.</p>
          ) : (
            <>
              <div ref={plotRef} />
              <p className="muted" style={{ marginTop: 8 }}>
                Filled dots are active {selected.key} listings; faint hollow dots are cars sold
                in the last 60 days ({formatNumber(points.length)} shown in total).{" "}
                {result ? (
                  <>
                    The ringed dots are your direct competition — same year
                    {fuel !== "unknown" ? " and fuel" : ""} ({formatNumber(peerCount)} listed).
                    The yellow line is the fair price for your year, fuel and power along this
                    axis; dashed lines bound the typical range; the big dot is your car at its
                    estimated value.
                  </>
                ) : (
                  "Fill in year and mileage above to see your car on the chart."
                )}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
