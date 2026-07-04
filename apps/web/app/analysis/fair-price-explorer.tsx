"use client";

import * as Plot from "@observablehq/plot";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import type { DealFilter, FairPriceDeal, FairPriceModel } from "@/lib/fair-price";
import { formatNumber, formatPrice } from "@/lib/format";

import { fetchDeals } from "./deals-action";

// The chart/table receive aggregates only (per-model depreciation stats +
// retention curves). Deal rows (title/url) arrive via the fetchDeals server
// action, which returns a capped top-N per query — see CLAUDE.md.

// Plot's default tip is white-on-white against our dark theme (tip text uses
// the figure's currentColor). Dark background + subtle border fixes it.
const TIP_STYLE = { fill: "#14140f", stroke: "#3f3f35" };

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

interface Props {
  models: FairPriceModel[];
  /** Server-chosen default chart selection; initialDeals is computed for it. */
  initialSelection: string[];
  initialDeals: FairPriceDeal[];
  initialFilter: DealFilter;
}

export default function FairPriceExplorer({
  models,
  initialSelection,
  initialDeals,
  initialFilter,
}: Props) {
  const [selected, setSelected] = useState<string[]>(initialSelection);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("n");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Deal filter controls (strings so inputs can be cleared).
  const [minPrice, setMinPrice] = useState(initialFilter.minPrice?.toString() ?? "");
  const [maxPrice, setMaxPrice] = useState(initialFilter.maxPrice?.toString() ?? "");
  const [minYear, setMinYear] = useState(initialFilter.minYear?.toString() ?? "");
  const [maxKm, setMaxKm] = useState(initialFilter.maxKm?.toString() ?? "");
  const [dealSort, setDealSort] = useState<"saved" | "discountPct">(
    initialFilter.sortBy ?? "saved",
  );
  const [linkDeals, setLinkDeals] = useState(true);
  const [deals, setDeals] = useState<FairPriceDeal[]>(initialDeals);
  const [pending, startTransition] = useTransition();

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

  // ── Retention chart ───────────────────────────────────────────────────────
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
        Plot.dot(pts, {
          x: "age",
          y: "retention",
          stroke: "model",
          r: 2.5,
          title: "label",
          tip: TIP_STYLE,
        }),
      ],
    });
    container.append(plot);
    return () => plot.remove();
  }, [selected, byKey, width]);

  // ── Deals refetch (debounced) ─────────────────────────────────────────────
  const parseNum = (s: string): number | undefined => {
    const v = Number(s);
    return s.trim() !== "" && Number.isFinite(v) ? v : undefined;
  };
  const dealModels = linkDeals && selected.length > 0 ? selected : undefined;
  const filterKey = JSON.stringify([dealModels, minPrice, maxPrice, minYear, maxKm, dealSort]);
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = setTimeout(() => {
      startTransition(async () => {
        setDeals(
          await fetchDeals({
            models: dealModels,
            minPrice: parseNum(minPrice),
            maxPrice: parseNum(maxPrice),
            minYear: parseNum(minYear),
            maxKm: parseNum(maxKm),
            sortBy: dealSort,
          }),
        );
      });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  // ── Model table ───────────────────────────────────────────────────────────
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
      <div className="panel">
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
                    <td className="num">
                      {m.retention5 == null ? "—" : `${m.retention5.toFixed(0)}%`}
                    </td>
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

      <div className="panel" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>
          Top deals
          {linkDeals && selected.length > 0 ? (
            <span className="muted" style={{ fontWeight: "normal" }}>
              {" "}
              — {selected.length} selected model{selected.length === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="muted" style={{ fontWeight: "normal" }}>
              {" "}
              — all models
            </span>
          )}
        </h3>

        <div className="filters" style={{ marginBottom: 12 }}>
          <div className="field">
            <label htmlFor="fp-min-price">Min €</label>
            <input
              id="fp-min-price"
              type="number"
              placeholder="any"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="fp-max-price">Max €</label>
            <input
              id="fp-max-price"
              type="number"
              placeholder="any"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="fp-min-year">Min year</label>
            <input
              id="fp-min-year"
              type="number"
              placeholder="any"
              value={minYear}
              onChange={(e) => setMinYear(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="fp-max-km">Max km</label>
            <input
              id="fp-max-km"
              type="number"
              placeholder="any"
              value={maxKm}
              onChange={(e) => setMaxKm(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="fp-deal-sort">Rank by</label>
            <select
              id="fp-deal-sort"
              value={dealSort}
              onChange={(e) => setDealSort(e.target.value as "saved" | "discountPct")}
            >
              <option value="saved">€ below fair</option>
              <option value="discountPct">% below fair</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="fp-link">Follow chart</label>
            <input
              id="fp-link"
              type="checkbox"
              checked={linkDeals}
              onChange={(e) => setLinkDeals(e.target.checked)}
            />
          </div>
        </div>

        <div style={{ opacity: pending ? 0.5 : 1, transition: "opacity 0.15s" }}>
          {deals.length === 0 ? (
            <p className="muted">No qualifying deals for these filters.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Model</th>
                  <th className="num">Year</th>
                  <th className="num">Km</th>
                  <th className="num">Price</th>
                  <th className="num">Fair price</th>
                  <th className="num">Below fair</th>
                  <th>SV says</th>
                  <th>District</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((d, i) => (
                  <tr key={`${d.key}-${d.year}-${d.km}-${d.price}-${i}`}>
                    <td>
                      {d.url ? (
                        <a href={d.url} target="_blank" rel="noreferrer">
                          {d.title ?? "(untitled)"}
                        </a>
                      ) : (
                        (d.title ?? "(untitled)")
                      )}
                    </td>
                    <td>{d.key}</td>
                    <td className="num">{d.year}</td>
                    <td className="num">{formatNumber(d.km)}</td>
                    <td className="num">{formatPrice(d.price, "EUR")}</td>
                    <td className="num">{formatPrice(d.expected, "EUR")}</td>
                    <td className="num drop">
                      −{formatPrice(d.saved, "EUR")} ({d.discountPct.toFixed(0)}%)
                    </td>
                    <td>{d.svSays ?? "—"}</td>
                    <td>{d.district ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          Top 25 active listings priced furthest below their model&apos;s fair value. Discounts
          above 60% are excluded (usually damage or data errors) and identical re-posts are
          collapsed. Untick &quot;Follow chart&quot; to search across all models regardless of the
          chart selection.
        </p>
      </div>
    </div>
  );
}
