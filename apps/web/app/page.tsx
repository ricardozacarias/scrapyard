import Link from "next/link";

import Gauge from "@/components/Gauge";
import YearHistogram from "@/components/YearHistogram";
import { brandMark } from "@/lib/brands";
import { formatDayMonth, formatNumber, formatPrice } from "@/lib/format";
import { getBiggestPriceDrops, getInventoryByYear, getSummary, getTopModels } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Compact initials for brands without a clean monochrome glyph. */
function initials(label: string): string {
  const words = label.split(/[\s-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return label.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase();
}

export default async function DashboardPage() {
  const [summary, movers, topModels, byYear] = await Promise.all([
    getSummary(),
    getBiggestPriceDrops(8),
    getTopModels(15),
    getInventoryByYear(),
  ]);
  const maxModel = Math.max(1, ...topModels.map((m) => m.count));
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

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
          <div className="label">
            Sold yesterday
            <span className="info-dot" tabIndex={0} role="button" aria-label="How is sold yesterday estimated?">
              ?
              <span className="info-tip" role="tooltip">
                Estimated. We can&apos;t see actual sales — only when an ad leaves the marketplace. This counts
                cars last seen yesterday that are gone from the latest scrape. The most recent day is provisional
                until the disappearance is confirmed by later scrapes.
              </span>
            </span>
          </div>
          <div className="metric">{summary.soldYesterday.toLocaleString("pt-PT")}</div>
          <div className="tile-sub">{formatDayMonth(yesterday)}</div>
        </div>
        <div className="tile accent">
          <div className="label">New today</div>
          <div className="metric">+{summary.newToday.toLocaleString("pt-PT")}</div>
          <div className="tile-sub">{formatDayMonth(today)}</div>
        </div>
        <div className="tile">
          <div className="label">
            Priced below market
            <span className="info-dot" tabIndex={0} role="button" aria-label="What does priced below market mean?">
              ?
              <span className="info-tip" role="tooltip">
                Share of listings standvirtual&apos;s own price rating flags as a good deal (below its estimated
                market value), as a percentage of listings that carry a rating.
              </span>
            </span>
          </div>
          <div className="metric">{summary.belowMarketPct}%</div>
          <div className="tile-sub">{summary.belowMarket.toLocaleString("pt-PT")} good deals</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Most common models · Top 15</h2>
          <p className="muted" style={{ marginTop: -6, marginBottom: 12, fontSize: 12 }}>
            Number of active listings per make &amp; model.
          </p>
          {topModels.length === 0 ? (
            <p className="muted">No data yet. Run the scraper to populate the database.</p>
          ) : (
            <div className="barlist">
              {topModels.map((m) => {
                const mark = brandMark(m.make);
                return (
                  <div className="barrow" key={`${m.make} ${m.model}`}>
                    {mark && mark.mono ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="brand-logo-mono" src={mark.logo} alt="" aria-hidden="true" />
                    ) : (
                      <span className="brand-chip" aria-hidden="true">
                        {initials(m.make)}
                      </span>
                    )}
                    <span className="bar-label wide">
                      {m.make} {m.model}
                    </span>
                    <span className="bar">
                      <span className="bar-fill" style={{ width: `${(m.count / maxModel) * 100}%` }} />
                    </span>
                    <span className="bar-value">{formatNumber(m.count)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="panel">
          <h2>Inventory by model year</h2>
          <p className="muted" style={{ marginTop: -6, marginBottom: 12, fontSize: 12 }}>
            Listings by registration year — the age profile of available stock.
          </p>
          <YearHistogram data={byYear} />
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
