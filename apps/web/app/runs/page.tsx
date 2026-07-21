import Gauge from "@/components/Gauge";
import { getScrapeActivity, getScrapeRuns, getStorageUsage } from "@/lib/queries";

import TriggerScrape from "./TriggerScrape";

export const dynamic = "force-dynamic";

const MB = 1024 * 1024;

function fmtDateTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("pt-PT", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function fmtMB(bytes: number): string {
  return (bytes / MB).toLocaleString("pt-PT", { maximumFractionDigits: 1 });
}

function fmtMonthYear(iso: string): string {
  return new Intl.DateTimeFormat("pt-PT", { month: "long", year: "numeric" }).format(new Date(iso));
}

function duration(start: Date | string, end: Date | string | null): string {
  if (!end) return "—";
  const mins = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default async function RunsPage() {
  const [runs, activity, storage] = await Promise.all([
    getScrapeRuns(30),
    getScrapeActivity(14),
    getStorageUsage(),
  ]);

  const usedMB = storage.currentBytes / MB;
  const capMB = storage.capBytes / MB;
  const perDayMB = storage.growthBytesPerDay / MB;

  return (
    <main className="container">
      <h1>Scrape runs</h1>
      <p className="subtitle">
        History of the daily scraper cron (05:30 UTC). Recorded in the database — no GitHub needed.
      </p>

      <div className="panel">
        <h2>Trigger a scrape</h2>
        <p className="muted" style={{ marginTop: -6, marginBottom: 12, fontSize: 12 }}>
          Manually start a full-catalog scrape on GitHub Actions. Requires the admin secret, and
          refuses if a run is already queued or in progress.
        </p>
        <TriggerScrape />
      </div>

      <div className="panel">
        <h2>Database storage</h2>
        <p className="muted" style={{ marginTop: -6, marginBottom: 12, fontSize: 12 }}>
          Logical size (pg_database_size) vs the Neon free-tier cap of {fmtMB(storage.capBytes)} MB.
          Recorded at the end of every successful scrape.
        </p>
        <div className="storage-grid">
          <Gauge
            value={usedMB}
            max={capMB}
            display={fmtMB(storage.currentBytes)}
            unit="MB"
            label="storage used"
            tip="Total database size vs Neon's 0.5 GB free-plan storage cap. Grows over time because sold cars are kept and price history is append-only. Compute-hours and egress are separate free-tier limits not shown here (they need the Neon API)."
            numerals={["0", "100", "200", "300", "400", "500"]}
            zones={[
              { upTo: capMB * 0.6, color: "var(--gauge-low)" },
              { upTo: capMB * 0.85, color: "var(--gauge-mid)" },
              { upTo: capMB, color: "var(--gauge-high)" },
            ]}
          />
          <dl className="storage-stats">
            <div>
              <dt>Used</dt>
              <dd>
                {fmtMB(storage.currentBytes)} MB of {fmtMB(storage.capBytes)} MB (
                {storage.pct.toFixed(1)}%)
              </dd>
            </div>
            <div>
              <dt>Growth</dt>
              <dd>
                ≈ {perDayMB.toLocaleString("pt-PT", { maximumFractionDigits: 2 })} MB/day{" "}
                <span className="muted">({storage.growthSource})</span>
              </dd>
            </div>
            <div>
              <dt>Projected full</dt>
              <dd>
                {storage.projectedFullISO && storage.daysToFull !== null ? (
                  <>
                    {fmtMonthYear(storage.projectedFullISO)}{" "}
                    <span className="muted">(~{Math.round(storage.daysToFull)} days)</span>
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt>Largest tables</dt>
              <dd>
                {storage.tables
                  .slice(0, 3)
                  .map((t) => `${t.table} ${fmtMB(t.bytes)} MB`)
                  .join(" · ")}
              </dd>
            </div>
          </dl>
        </div>
        {storage.growthSource === "estimated" && (
          <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
            Growth is estimated from the last 14 days of row additions until two runs have recorded
            sizes a day apart, then it switches to the measured trend. Neon&apos;s billed storage can
            read slightly higher than this (it includes retained history) — the authoritative figure
            is the Neon console.
          </p>
        )}
      </div>

      <div className="panel">
        <h2>Recent runs</h2>
        <p className="muted" style={{ marginTop: -6, marginBottom: 12, fontSize: 12 }}>
          Scraped = listings seen this run · Upserted = rows written (new or price-updated) ·
          Snapshots = price changes recorded. Latest 30 runs.
        </p>
        {runs.length === 0 ? (
          <p className="muted">
            No runs recorded yet. The first entry appears after the next scrape (or a manual run) —
            until then, see the derived activity below.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Started</th>
                <th>Status</th>
                <th className="num">Duration</th>
                <th className="num">Scraped</th>
                <th className="num">Upserted</th>
                <th className="num">Snapshots</th>
                <th className="num">Sold/removed</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDateTime(r.startedAt)}</td>
                  <td>
                    <span
                      className={`run-status ${r.status === "success" ? "ok" : r.status === "failed" ? "fail" : "running"}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="num">
                    {r.status === "running" ? "running…" : duration(r.startedAt, r.finishedAt)}
                  </td>
                  <td className="num">{r.parsed.toLocaleString("pt-PT")}</td>
                  <td className="num">{r.upserted.toLocaleString("pt-PT")}</td>
                  <td className="num">{r.snapshots.toLocaleString("pt-PT")}</td>
                  <td className="num">{r.deactivated.toLocaleString("pt-PT")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {runs.some((r) => r.error) && (
          <div style={{ marginTop: 14 }}>
            {runs
              .filter((r) => r.error)
              .map((r) => (
                <p key={r.id} className="run-error">
                  <span className="muted">{fmtDateTime(r.startedAt)}</span> — {r.error}
                </p>
              ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Daily activity (last 14 days)</h2>
        <p className="muted" style={{ marginTop: -6, marginBottom: 12, fontSize: 12 }}>
          Derived from price snapshots &amp; new listings — shows scrape activity even before the run
          log fills up.
        </p>
        {activity.length === 0 ? (
          <p className="muted">No activity in the window.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th className="num">Price changes</th>
                <th className="num">New listings</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((a) => (
                <tr key={a.day}>
                  <td>{a.day}</td>
                  <td className="num">{a.snapshots.toLocaleString("pt-PT")}</td>
                  <td className="num">+{a.newListings.toLocaleString("pt-PT")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
