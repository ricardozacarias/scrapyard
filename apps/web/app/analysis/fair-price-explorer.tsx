"use client";

import * as Plot from "@observablehq/plot";
import { useEffect, useMemo, useRef, useState } from "react";

import type { FairPriceModel } from "@/lib/fair-price";
import { formatNumber } from "@/lib/format";

// Aggregates only (per-model depreciation stats + retention curves) — no
// listing identities are ever passed to this component. See CLAUDE.md.

type SortKey = "key" | "n" | "medianPrice" | "dropYr3" | "dropYr8" | "dropPer10k" | "retention5";

const COLUMNS: { key: SortKey; label: string; num: boolean }[] = [
  { key: "key", label: "Model", num: false },
  { key: "n", label: "Listings", num: true },
  { key: "medianPrice", label: "Median €", num: true },
  { key: "dropYr3", label: "%/yr @ age 3", num: true },
  { key: "dropYr8", label: "%/yr @ age 8", num: true },
  { key: "dropPer10k", label: "% per 10k km", num: true },
  { key: "retention5", label: "5-yr retention", num: true },
];

export default function FairPriceExplorer({ models }: { models: FairPriceModel[] }) {
  const [selected, setSelected] = useState<string[]>(() => models.slice(0, 6).map((m) => m.key));
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("n");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

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

  const byKey = useMemo(() => new Map(models.map((m) => [m.key, m])), [models]);

  useEffect(() => {
    if (!plotRef.current) return;
    const container = plotRef.current;
    container.replaceChildren();

    const pts = selected.flatMap((key) => {
      const m = byKey.get(key);
      if (!m) return [];
      return m.curve.map((p) => ({
        model: key,
        age: p.age,
        retention: p.retention,
        label: `${key}\nage ${p.age}: ${p.retention.toFixed(0)}% of age-1 value`,
      }));
    });

    const plot = Plot.plot({
      width,
      height: 420,
      marginLeft: 55,
      marginBottom: 45,
      style: { background: "transparent", color: "#f0f0f0" },
      grid: true,
      x: { label: "Vehicle age (years)", labelAnchor: "center", ticks: 12 },
      y: { label: "% of age-1 value", labelAnchor: "center" },
      color: { legend: true },
      marks: [
        Plot.ruleY([100], { stroke: "#8c8c84", strokeDasharray: "3,4" }),
        Plot.line(pts, { x: "age", y: "retention", stroke: "model", strokeWidth: 2 }),
        Plot.dot(pts, { x: "age", y: "retention", stroke: "model", r: 2.5, title: "label", tip: true }),
      ],
    });
    container.append(plot);
    return () => plot.remove();
  }, [selected, byKey, width]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? models.filter((m) => m.key.toLowerCase().includes(q)) : models;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      return (typeof av === "string" ? av.localeCompare(bv as string) : av - (bv as number)) * dir;
    });
  }, [models, query, sortKey, sortDir]);

  const toggle = (key: string) =>
    setSelected((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));

  const header = (col: (typeof COLUMNS)[number]) => (
    <th
      key={col.key}
      className={col.num ? "num" : undefined}
      style={{ cursor: "pointer", whiteSpace: "nowrap", userSelect: "none" }}
      onClick={() => {
        if (sortKey === col.key) {
          setSortDir(sortDir === "asc" ? "desc" : "asc");
        } else {
          setSortKey(col.key);
          setSortDir(col.key === "key" ? "asc" : "desc");
        }
      }}
    >
      {col.label}
      {sortKey === col.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
    </th>
  );

  return (
    <div ref={wrapRef}>
      <div ref={plotRef} />
      <p className="muted" style={{ marginTop: 6 }}>
        Predicted value vs. an age-1 example of the same model, assuming{" "}
        {formatNumber(15000)} km/year. Click table rows to add or remove curves.
      </p>

      <div className="filters" style={{ margin: "14px 0 10px" }}>
        <div className="field">
          <label htmlFor="fp-search">Search models</label>
          <input
            id="fp-search"
            type="text"
            placeholder="e.g. Golf, Tesla, Clio…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="field">
          <label>&nbsp;</label>
          <button type="button" onClick={() => setSelected([])} disabled={selected.length === 0}>
            Clear chart ({selected.length})
          </button>
        </div>
      </div>

      <div style={{ maxHeight: 420, overflowY: "auto" }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 28 }} />
              {COLUMNS.map(header)}
              <th className="num">R²</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((m) => {
              const on = selected.includes(m.key);
              return (
                <tr
                  key={m.key}
                  onClick={() => toggle(m.key)}
                  style={{ cursor: "pointer", opacity: on ? 1 : 0.75 }}
                >
                  <td>{on ? "●" : "○"}</td>
                  <td>{m.key}</td>
                  <td className="num">{formatNumber(m.n)}</td>
                  <td className="num">{formatNumber(m.medianPrice)}</td>
                  <td className="num">{m.dropYr3.toFixed(1)}%</td>
                  <td className="num">{m.dropYr8.toFixed(1)}%</td>
                  <td className="num">{m.dropPer10k.toFixed(1)}%</td>
                  <td className="num">{m.retention5 == null ? "—" : `${m.retention5.toFixed(0)}%`}</td>
                  <td className="num">{m.r2.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        {visible.length} of {models.length} models shown. Depreciation rates are the model&apos;s
        predicted year-over-year price loss at that age; &quot;% per 10k km&quot; is the mileage
        effect at constant age.
      </p>
    </div>
  );
}
