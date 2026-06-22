"use client";

import * as Plot from "@observablehq/plot";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatNumber } from "@/lib/format";
import {
  DEFAULT_THRESHOLDS,
  detectOutliers,
  linearRegression,
  type OutlierMethod,
} from "@/lib/stats";

// De-identified on purpose: no ad title or url. The public scatter shows the
// distribution (make/model + numerics), not links back to individual listings.
export interface ScatterPoint {
  make: string | null;
  model: string | null;
  price: number | null;
  mileageKm: number | null;
  modelYear: number | null;
  enginePower: number | null;
}

type FieldKey = "price" | "mileageKm" | "modelYear" | "enginePower";

const FIELDS: { key: FieldKey; label: string }[] = [
  { key: "price", label: "Price (€)" },
  { key: "mileageKm", label: "Mileage (km)" },
  { key: "modelYear", label: "Model year" },
  { key: "enginePower", label: "Power (cv)" },
];

export default function Scatter({ data }: { data: ScatterPoint[] }) {
  const [xKey, setXKey] = useState<FieldKey>("mileageKm");
  const [yKey, setYKey] = useState<FieldKey>("price");
  const [method, setMethod] = useState<OutlierMethod>("mad");
  const [threshold, setThreshold] = useState<number>(DEFAULT_THRESHOLDS.mad);

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

  const { points, regression, outlierCount } = useMemo(() => {
    const valid = data.filter((d) => d[xKey] !== null && d[yKey] !== null);
    const xs = valid.map((d) => d[xKey] as number);
    const ys = valid.map((d) => d[yKey] as number);
    const reg = linearRegression(xs, ys);
    if (!reg) {
      return { points: valid.map((d) => ({ d, outlier: false })), regression: null, outlierCount: 0 };
    }
    const residuals = ys.map((y, i) => y - reg.predict(xs[i] as number));
    const flags = detectOutliers(residuals, method, threshold);
    const pts = valid.map((d, i) => ({ d, outlier: flags[i] ?? false }));
    return { points: pts, regression: reg, outlierCount: flags.filter(Boolean).length };
  }, [data, xKey, yKey, method, threshold]);

  useEffect(() => {
    if (!plotRef.current) return;
    const container = plotRef.current;
    container.replaceChildren();

    const rows = points.map((p) => ({
      x: p.d[xKey] as number,
      y: p.d[yKey] as number,
      outlier: p.outlier,
      label: `${[p.d.make, p.d.model].filter(Boolean).join(" ") || "(unknown)"}\n${FIELDS.find((f) => f.key === xKey)?.label}: ${formatNumber(p.d[xKey] as number)}\n${FIELDS.find((f) => f.key === yKey)?.label}: ${formatNumber(p.d[yKey] as number)}`,
    }));
    const normal = rows.filter((r) => !r.outlier);
    const outliers = rows.filter((r) => r.outlier);

    const xLabel = FIELDS.find((f) => f.key === xKey)?.label ?? xKey;
    const yLabel = FIELDS.find((f) => f.key === yKey)?.label ?? yKey;

    const marks: Plot.Markish[] = [
      Plot.dot(normal, {
        x: "x",
        y: "y",
        fill: "#8c8c84",
        fillOpacity: 0.6,
        r: 3,
        title: "label",
        tip: true,
      }),
      Plot.dot(outliers, {
        x: "x",
        y: "y",
        fill: "#ff3340",
        r: 4,
        title: "label",
        tip: true,
      }),
    ];

    if (regression && rows.length >= 2) {
      const xsAll = rows.map((r) => r.x);
      const xmin = Math.min(...xsAll);
      const xmax = Math.max(...xsAll);
      marks.push(
        Plot.line(
          [
            { x: xmin, y: regression.predict(xmin) },
            { x: xmax, y: regression.predict(xmax) },
          ],
          { x: "x", y: "y", stroke: "#ffd400", strokeWidth: 2 },
        ),
      );
    }

    const plot = Plot.plot({
      width,
      height: 460,
      marginLeft: 70,
      marginBottom: 50,
      style: { background: "transparent", color: "#f0f0f0" },
      grid: true,
      x: { label: xLabel, labelAnchor: "center" },
      y: { label: yLabel, labelAnchor: "center" },
      marks,
    });
    container.append(plot);
    return () => plot.remove();
  }, [points, regression, xKey, yKey, width]);

  return (
    <div ref={wrapRef}>
      <div className="filters" style={{ marginBottom: 16 }}>
        <div className="field">
          <label htmlFor="xKey">X axis</label>
          <select id="xKey" value={xKey} onChange={(e) => setXKey(e.target.value as FieldKey)}>
            {FIELDS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="yKey">Y axis</label>
          <select id="yKey" value={yKey} onChange={(e) => setYKey(e.target.value as FieldKey)}>
            {FIELDS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="method">Outlier method</label>
          <select
            id="method"
            value={method}
            onChange={(e) => {
              const m = e.target.value as OutlierMethod;
              setMethod(m);
              setThreshold(DEFAULT_THRESHOLDS[m]);
            }}
          >
            <option value="mad">MAD (robust)</option>
            <option value="zscore">Z-score</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="threshold">Threshold ({threshold.toFixed(1)})</label>
          <input
            id="threshold"
            type="range"
            min={1}
            max={7}
            step={0.1}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
          />
        </div>
      </div>

      <div ref={plotRef} />

      <p className="muted" style={{ marginTop: 10 }}>
        {regression ? (
          <>
            {points.length.toLocaleString("pt-PT")} points · y = {regression.slope.toFixed(4)}·x +{" "}
            {regression.intercept.toFixed(0)} · R² = {regression.r2.toFixed(3)} · {outlierCount}{" "}
            outliers (red). Hover a point for its make/model and values.
          </>
        ) : (
          "Not enough variance to fit a regression with the current axes."
        )}
      </p>
    </div>
  );
}
