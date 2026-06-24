import { getScrapeActivity, getScrapeRuns } from "@/lib/queries";

export const dynamic = "force-dynamic";

function fmtDateTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("pt-PT", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function duration(start: Date | string, end: Date | string | null): string {
  if (!end) return "—";
  const mins = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default async function RunsPage() {
  const [runs, activity] = await Promise.all([getScrapeRuns(30), getScrapeActivity(14)]);

  return (
    <main className="container">
      <h1>Scrape runs</h1>
      <p className="subtitle">
        History of the daily scraper cron (05:30 UTC). Recorded in the database — no GitHub needed.
      </p>

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
