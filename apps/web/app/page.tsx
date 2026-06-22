import Link from "next/link";

import Gauge from "@/components/Gauge";
import { brandMark } from "@/lib/brands";
import { formatNumber, formatPrice } from "@/lib/format";
import { getBiggestPriceDrops, getSummary } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Compact initials for brands without a clean monochrome glyph. */
function initials(label: string): string {
  const words = label.split(/[\s-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return label.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase();
}

export default async function DashboardPage() {
  const [summary, movers] = await Promise.all([getSummary(), getBiggestPriceDrops(8)]);
  const maxBrand = Math.max(1, ...summary.byMake.map((b) => b.count));
  const maxRegion = Math.max(1, ...summary.byRegion.map((r) => r.count));

  return (
    <main className="container">
      <h1>Dashboard</h1>
      <p className="subtitle">Live snapshot of the standvirtual car listings database.</p>

      <div className="gauges">
        <div className="gauge-card">
          <Gauge
            value={summary.medianPrice}
            max={50000}
            display={formatNumber(summary.medianPrice)}
            unit="€"
            label="median asking price"
            tip="Median asking price across all currently listed cars — half are priced above this, half below."
            numerals={["0", "10k", "20k", "30k", "40k", "50k"]}
            zones={[
              { upTo: 15000, color: "var(--gauge-low)" },
              { upTo: 30000, color: "var(--gauge-mid)" },
              { upTo: 50000, color: "var(--gauge-high)" },
            ]}
          />
        </div>
        <div className="gauge-card">
          <Gauge
            value={summary.marketHeat}
            max={2}
            display={`${Math.round(summary.marketHeat * 100)}`}
            unit="%"
            label="market heat · 24h vs avg"
            tip="New listings in the last 24h versus the daily average. 100% is a normal day; higher means an unusually busy market."
            numerals={["0", "40%", "80%", "120%", "160%", "200%"]}
            zones={[
              { upTo: 0.8, color: "var(--gauge-low)" },
              { upTo: 1.3, color: "var(--gauge-mid)" },
              { upTo: 2, color: "var(--gauge-high)" },
            ]}
          />
        </div>
        <div className="gauge-card">
          <Gauge
            value={summary.medianMileage}
            max={300000}
            display={formatNumber(summary.medianMileage)}
            unit="km"
            label="median mileage"
            tip="Median odometer reading across listings — half the cars have driven more than this, half less."
            numerals={["0", "60k", "120k", "180k", "240k", "300k"]}
            zones={[
              { upTo: 100000, color: "var(--gauge-low)" },
              { upTo: 200000, color: "var(--gauge-mid)" },
              { upTo: 300000, color: "var(--gauge-high)" },
            ]}
          />
        </div>
      </div>

      <div className="tiles">
        <div className="tile">
          <div className="label">Total listings</div>
          <div className="metric">{summary.total.toLocaleString("pt-PT")}</div>
        </div>
        <div className="tile">
          <div className="label">Active</div>
          <div className="metric">{summary.active.toLocaleString("pt-PT")}</div>
        </div>
        <div className="tile accent">
          <div className="label">New today</div>
          <div className="metric">+{summary.newToday.toLocaleString("pt-PT")}</div>
        </div>
        <div className="tile">
          <div className="label">Drops 24h</div>
          <div className="metric drop">▼ {summary.drops24h.toLocaleString("pt-PT")}</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>By make · median &amp; volume</h2>
          {summary.byMake.length === 0 ? (
            <p className="muted">No data yet. Run the scraper to populate the database.</p>
          ) : (
            <div className="barlist">
              {summary.byMake.map((b) => {
                const mark = brandMark(b.label);
                return (
                <div className="barrow" key={b.label}>
                  {mark && mark.mono ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="brand-logo-mono" src={mark.logo} alt="" aria-hidden="true" />
                  ) : (
                    <span className="brand-chip" aria-hidden="true">
                      {initials(b.label)}
                    </span>
                  )}
                  <span className="bar-label">{b.label}</span>
                  <span className="bar">
                    <span className="bar-fill" style={{ width: `${(b.count / maxBrand) * 100}%` }} />
                  </span>
                  <span className="bar-value">{formatPrice(b.medianPrice)}</span>
                </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="panel">
          <h2>By district · median &amp; volume</h2>
          <p className="muted" style={{ marginTop: -6, marginBottom: 12, fontSize: 12 }}>
            See the full municipality-level <Link href="/analysis">heatmap of Portugal</Link>.
          </p>
          {summary.byRegion.length === 0 ? (
            <p className="muted">No region-mapped listings yet.</p>
          ) : (
            <div className="barlist">
              {summary.byRegion.map((r) => (
                <div className="barrow" key={r.label}>
                  <span className="bar-label wide">{r.label}</span>
                  <span className="bar">
                    <span
                      className="bar-fill alt"
                      style={{ width: `${(r.count / maxRegion) * 100}%` }}
                    />
                  </span>
                  <span className="bar-value">{formatPrice(r.medianPrice)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <h2>Market movers · biggest price drops</h2>
        {movers.length === 0 ? (
          <p className="muted">
            No price drops recorded yet. Drops appear once a listing&apos;s price changes between
            scrapes.
          </p>
        ) : (
          <div className="movers">
            {movers.map((d) => {
              const pct = d.previousPrice > 0 ? Math.round((d.drop / d.previousPrice) * 100) : 0;
              return (
                <div className="mover-row" key={d.id}>
                  <span className="mover-title">
                    {d.url ? (
                      <a href={d.url} target="_blank" rel="noreferrer">
                        {d.title ?? "(untitled)"}
                      </a>
                    ) : (
                      (d.title ?? "(untitled)")
                    )}
                  </span>
                  <span className="mover-was">{formatPrice(d.previousPrice, d.currency ?? "EUR")}</span>
                  <span className="mover-now">{formatPrice(d.currentPrice, d.currency ?? "EUR")}</span>
                  <span className={`pct ${pct >= 15 ? "hot" : "warm"}`}>−{pct}%</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="subtitle" style={{ marginTop: 24 }}>
        Explore the full table on the <Link href="/listings">Listings</Link> page or dig into
        correlations and outliers on the <Link href="/analysis">Analysis</Link> page.
      </p>
    </main>
  );
}
