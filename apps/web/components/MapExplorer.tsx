"use client";

import * as Plot from "@observablehq/plot";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatNumber, formatPrice } from "@/lib/format";
import type { MapPayload } from "@/lib/queries";

import DualRange from "./DualRange";

// Colour ramp (green → yellow → orange → red) and the distinct "no data /
// below threshold" fill — deliberately a cool neutral so it reads as N/A and
// can't be confused with the bg (#141414) or any ramp stop.
const RAMP = ["#3fb950", "#ffd400", "#ff6a13", "#ff3340"];
const MAP_EMPTY = "#3c3f47";

interface GeoFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
}
interface GeoJson {
  type: "FeatureCollection";
  features: GeoFeature[];
}

/** Lowercase, strip accents, collapse non-alphanumerics — match GeoJSON ↔ DB names. */
function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s-])([a-zà-ú])/g, (_m, a, b) => a + b.toUpperCase());
}

interface RegionStat {
  count: number;
  median: number;
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = n >> 1;
  return n % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** 5th–95th percentile of the medians on screen, so one freak region can't
 *  compress the colour scale. */
function clampDomain(values: number[]): [number, number] | undefined {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (v.length < 4) return undefined;
  const q = (f: number) => v[Math.min(v.length - 1, Math.max(0, Math.round(f * (v.length - 1))))]!;
  const d: [number, number] = [q(0.05), q(0.95)];
  return d[0] === d[1] ? undefined : d;
}

export default function MapExplorer({ data }: { data: MapPayload }) {
  // ---- geo ----
  const [distritos, setDistritos] = useState<GeoJson | null>(null);
  const [concelhos, setConcelhos] = useState<GeoJson | null>(null);
  useEffect(() => {
    let on = true;
    Promise.all([
      fetch("/geo/distritos.geojson").then((r) => r.json()),
      fetch("/geo/concelhos.geojson").then((r) => r.json()),
    ])
      .then(([d, c]) => {
        if (on) {
          setDistritos(d as GeoJson);
          setConcelhos(c as GeoJson);
        }
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, []);

  // ---- derived dictionaries / bounds (once) ----
  const makeOrder = useMemo(() => {
    // makes sorted by listing frequency, descending
    const counts = new Array(data.makes.length).fill(0);
    for (const mi of data.make) if (mi >= 0) counts[mi]++;
    return data.makes
      .map((name, i) => ({ name, i, n: counts[i] }))
      .sort((a, b) => b.n - a.n);
  }, [data]);

  const modelsByMake = useMemo(() => {
    const map = new Map<number, Map<number, number>>(); // makeIdx -> (modelIdx -> count)
    for (let k = 0; k < data.count; k++) {
      const mk = data.make[k]!;
      const md = data.model[k]!;
      if (mk < 0 || md < 0) continue;
      let inner = map.get(mk);
      if (!inner) map.set(mk, (inner = new Map()));
      inner.set(md, (inner.get(md) ?? 0) + 1);
    }
    return map;
  }, [data]);

  const yearBounds = useMemo<[number, number]>(() => {
    // Floor the low end at the 1st percentile so one vintage / mis-parsed year
    // (e.g. a stray 1900) doesn't stretch the slider across a useless range.
    const ys = data.year.filter((y) => y > 0).sort((a, b) => a - b);
    if (!ys.length) return [1990, 2026];
    const p1 = ys[Math.floor(0.01 * (ys.length - 1))]!;
    return [p1, ys[ys.length - 1]!];
  }, [data]);

  const mileageBounds = useMemo<[number, number]>(() => {
    const vals = data.mileage.filter((m) => m >= 0).sort((a, b) => a - b);
    if (!vals.length) return [0, 300000];
    const p99 = vals[Math.min(vals.length - 1, Math.round(0.99 * (vals.length - 1)))]!;
    return [0, Math.max(p99, 10000)];
  }, [data]);

  // ---- controls ----
  const [resolution, setResolution] = useState<"district" | "municipality">("district");
  const [makeSel, setMakeSel] = useState(-1); // makeIdx, -1 = all
  const [modelSel, setModelSel] = useState(-1); // modelIdx, -1 = all
  const [yearRange, setYearRange] = useState<[number, number]>(yearBounds);
  const [mileageRange, setMileageRange] = useState<[number, number]>(mileageBounds);
  const [threshold, setThreshold] = useState(1);
  const [zoomDistrict, setZoomDistrict] = useState<string | null>(null);

  // keep ranges in sync once bounds are known
  useEffect(() => setYearRange(yearBounds), [yearBounds]);
  useEffect(() => setMileageRange(mileageBounds), [mileageBounds]);

  const modelOptions = useMemo(() => {
    if (makeSel < 0) return [];
    const inner = modelsByMake.get(makeSel);
    if (!inner) return [];
    return [...inner.entries()]
      .map(([idx, n]) => ({ idx, name: data.models[idx]!, n }))
      .sort((a, b) => b.n - a.n);
  }, [makeSel, modelsByMake, data]);

  const yearActive = yearRange[0] > yearBounds[0] || yearRange[1] < yearBounds[1];
  const mileageActive = mileageRange[0] > mileageBounds[0] || mileageRange[1] < mileageBounds[1];

  // ---- aggregation: median price per region (both grains in one pass) ----
  const { distStat, muniStat, totalMatched } = useMemo(() => {
    const distBuckets = new Map<number, number[]>();
    const muniBuckets = new Map<number, number[]>();
    let matched = 0;
    for (let k = 0; k < data.count; k++) {
      if (makeSel >= 0 && data.make[k] !== makeSel) continue;
      if (modelSel >= 0 && data.model[k] !== modelSel) continue;
      if (yearActive) {
        const y = data.year[k]!;
        if (y < yearRange[0] || y > yearRange[1]) continue;
      }
      if (mileageActive) {
        const m = data.mileage[k]!;
        if (m < 0 || m < mileageRange[0] || m > mileageRange[1]) continue;
      }
      matched++;
      const price = data.price[k]!;
      const di = data.dist[k]!;
      if (di >= 0) (distBuckets.get(di) ?? distBuckets.set(di, []).get(di)!).push(price);
      const mi = data.muni[k]!;
      if (mi >= 0) (muniBuckets.get(mi) ?? muniBuckets.set(mi, []).get(mi)!).push(price);
    }
    const toStat = (buckets: Map<number, number[]>, dict: string[]) => {
      const out = new Map<string, RegionStat>();
      for (const [idx, prices] of buckets) {
        prices.sort((a, b) => a - b);
        out.set(norm(dict[idx]!), { count: prices.length, median: median(prices) });
      }
      return out;
    };
    return {
      distStat: toStat(distBuckets, data.districts),
      muniStat: toStat(muniBuckets, data.municipalities),
      totalMatched: matched,
    };
  }, [data, makeSel, modelSel, yearRange, mileageRange, yearActive, mileageActive]);

  // ---- main map render ----
  const wrapRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(340);
  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const update = () => setWidth(Math.min(el.clientWidth || 360, 380));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = resolution === "district" ? distritos : concelhos;
  const nameProp = resolution === "district" ? "district" : "municipality";
  const stat = resolution === "district" ? distStat : muniStat;

  useEffect(() => {
    if (!geo || !plotRef.current) return;
    const container = plotRef.current;
    const shown = (s: RegionStat | undefined) => (s && s.count >= threshold ? s : undefined);
    const domainVals: number[] = [];
    for (const s of stat.values()) if (s.count >= threshold) domainVals.push(s.median);
    const domain = clampDomain(domainVals);

    const marks: Plot.Markish[] = [
      Plot.geo(geo, {
        fill: (d: GeoFeature) => {
          const s = shown(stat.get(norm(String(d.properties[nameProp] ?? ""))));
          return s ? s.median : null;
        },
        stroke: "#141414",
        strokeWidth: 0.5,
        channels: {
          Region: (d: GeoFeature) => titleCase(String(d.properties[nameProp] ?? "")),
          Median: (d: GeoFeature) => {
            const s = shown(stat.get(norm(String(d.properties[nameProp] ?? ""))));
            return s ? formatPrice(s.median) : "no data";
          },
          Listings: (d: GeoFeature) => {
            const s = stat.get(norm(String(d.properties[nameProp] ?? "")));
            return formatNumber(s?.count ?? 0);
          },
        },
        tip: true,
      }),
    ];
    // District delimiters stay visible on the high-res concelho map.
    if (resolution === "municipality" && distritos) {
      marks.push(Plot.geo(distritos, { fill: "none", stroke: "#9a9a90", strokeWidth: 1 }));
    }

    container.replaceChildren();
    const plot = Plot.plot({
      width,
      projection: { type: "mercator", domain: geo },
      style: { background: "transparent", color: "#f0f0f0", fontFamily: "ui-monospace, monospace" },
      color: {
        type: "linear",
        domain,
        clamp: true,
        range: RAMP,
        unknown: MAP_EMPTY,
        label: "Median price (€)",
        legend: true,
      },
      marks,
    });
    container.append(plot);

    // Click a region → zoom into its district. Plot binds the data *index* (not
    // the feature) to each path, so map by position within the fill mark's group
    // — the first <g aria-label="geo">, whose paths are in feature order. Both
    // layers carry `district` (concelhos were enriched from the gazetteer).
    const fillGroup = plot.querySelector('g[aria-label="geo"]');
    if (fillGroup) {
      const paths = fillGroup.querySelectorAll("path");
      paths.forEach((path, i) => {
        const target = String(geo.features[i]?.properties?.district ?? "");
        if (!target) return;
        (path as SVGPathElement).style.cursor = "pointer";
        path.addEventListener("click", () => setZoomDistrict(target));
      });
    }
    return () => plot.remove();
  }, [geo, distritos, stat, nameProp, resolution, width, threshold]);

  // ---- inset (click-to-zoom) ----
  const insetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!zoomDistrict || !concelhos || !insetRef.current) return;
    const container = insetRef.current;
    const features = concelhos.features.filter(
      (f) => norm(String(f.properties.district ?? "")) === norm(zoomDistrict),
    );
    if (!features.length) return;
    const fc: GeoJson = { type: "FeatureCollection", features };
    const domainVals: number[] = [];
    for (const f of features) {
      const s = muniStat.get(norm(String(f.properties.municipality ?? "")));
      if (s && s.count >= threshold) domainVals.push(s.median);
    }
    const domain = clampDomain(domainVals);

    container.replaceChildren();
    const plot = Plot.plot({
      width: 320,
      projection: { type: "mercator", domain: fc },
      style: { background: "transparent", color: "#f0f0f0", fontFamily: "ui-monospace, monospace" },
      color: { type: "linear", domain, clamp: true, range: RAMP, unknown: MAP_EMPTY },
      marks: [
        Plot.geo(fc, {
          fill: (d: GeoFeature) => {
            const s = muniStat.get(norm(String(d.properties.municipality ?? "")));
            return s && s.count >= threshold ? s.median : null;
          },
          stroke: "#141414",
          strokeWidth: 0.6,
          channels: {
            Concelho: (d: GeoFeature) => titleCase(String(d.properties.municipality ?? "")),
            Median: (d: GeoFeature) => {
              const s = muniStat.get(norm(String(d.properties.municipality ?? "")));
              return s && s.count >= threshold ? formatPrice(s.median) : "no data";
            },
            Listings: (d: GeoFeature) => {
              const s = muniStat.get(norm(String(d.properties.municipality ?? "")));
              return formatNumber(s?.count ?? 0);
            },
          },
          tip: true,
        }),
      ],
    });
    container.append(plot);
    return () => plot.remove();
  }, [zoomDistrict, concelhos, muniStat, threshold]);

  const shownRegions = useMemo(() => {
    let n = 0;
    for (const s of stat.values()) if (s.count >= threshold) n++;
    return n;
  }, [stat, threshold]);

  const grainLabel = resolution === "district" ? "districts" : "concelhos";

  return (
    <div className="map-explorer">
      <div className="map-controls">
        <div className="seg" role="group" aria-label="Resolution">
          <button
            className={resolution === "district" ? "active" : ""}
            onClick={() => setResolution("district")}
          >
            District
          </button>
          <button
            className={resolution === "municipality" ? "active" : ""}
            onClick={() => setResolution("municipality")}
          >
            Concelho
          </button>
        </div>

        <label className="ctl">
          <span>Make</span>
          <select
            value={makeSel}
            onChange={(e) => {
              setMakeSel(Number(e.target.value));
              setModelSel(-1);
            }}
          >
            <option value={-1}>All makes</option>
            {makeOrder.map((m) => (
              <option key={m.i} value={m.i}>
                {m.name} ({m.n})
              </option>
            ))}
          </select>
        </label>

        <label className="ctl">
          <span>Model</span>
          <select
            value={modelSel}
            disabled={makeSel < 0}
            onChange={(e) => setModelSel(Number(e.target.value))}
          >
            <option value={-1}>{makeSel < 0 ? "Pick a make first" : "All models"}</option>
            {modelOptions.map((m) => (
              <option key={m.idx} value={m.idx}>
                {m.name} ({m.n})
              </option>
            ))}
          </select>
        </label>

        <div className="ctl">
          <span>
            Year · {yearRange[0]}–{yearRange[1]}
          </span>
          <DualRange
            min={yearBounds[0]}
            max={yearBounds[1]}
            value={yearRange}
            onChange={setYearRange}
          />
        </div>

        <div className="ctl">
          <span>
            Mileage · {formatNumber(mileageRange[0])}–{formatNumber(mileageRange[1])} km
          </span>
          <DualRange
            min={mileageBounds[0]}
            max={mileageBounds[1]}
            step={5000}
            value={mileageRange}
            onChange={setMileageRange}
          />
        </div>

        <div className="ctl">
          <span>Min listings · {threshold}</span>
          <input
            type="range"
            min={1}
            max={50}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
          />
        </div>
      </div>

      <p className="map-summary muted">
        {formatNumber(totalMatched)} listings match · {shownRegions} {grainLabel} at/above the
        listing threshold.{" "}
        <span className="map-empty-key">
          <i style={{ background: MAP_EMPTY }} /> no data / below threshold
        </span>
      </p>

      <div className="map-stage">
        <div ref={wrapRef} className="map-plot" style={{ flex: 1 }}>
          <div ref={plotRef} />
          {!geo && <p className="muted">Loading map…</p>}
        </div>

        {zoomDistrict && (
          <div className="map-inset panel">
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <strong>{titleCase(zoomDistrict)}</strong>
              <button className="btn secondary" onClick={() => setZoomDistrict(null)}>
                Close
              </button>
            </div>
            <div ref={insetRef} className="map-plot" />
            <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
              Concelhos of {titleCase(zoomDistrict)} · same filters applied.
            </p>
          </div>
        )}
      </div>
      {!zoomDistrict && (
        <p className="muted" style={{ fontSize: 11 }}>
          Tip: click a region to zoom into its concelhos.
        </p>
      )}
    </div>
  );
}
