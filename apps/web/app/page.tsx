import Link from "next/link";

import { formatPrice } from "@/lib/format";
import { getSummary } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const summary = await getSummary();

  return (
    <main className="container">
      <h1>Dashboard</h1>
      <p className="subtitle">Live snapshot of the standvirtual car listings database.</p>

      <div className="cards">
        <div className="card">
          <div className="label">Total listings</div>
          <div className="metric">{summary.total.toLocaleString("pt-PT")}</div>
        </div>
        <div className="card">
          <div className="label">Active</div>
          <div className="metric">{summary.active.toLocaleString("pt-PT")}</div>
        </div>
        <div className="card">
          <div className="label">With price history</div>
          <div className="metric">{summary.withPriceHistory.toLocaleString("pt-PT")}</div>
        </div>
      </div>

      <div className="panel">
        <h2>Median price by brand (top 12)</h2>
        {summary.byBrand.length === 0 ? (
          <p className="muted">No data yet. Run the scraper to populate the database.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Brand</th>
                <th className="num">Listings</th>
                <th className="num">Median price</th>
              </tr>
            </thead>
            <tbody>
              {summary.byBrand.map((b) => (
                <tr key={b.label}>
                  <td>{b.label}</td>
                  <td className="num">{b.count.toLocaleString("pt-PT")}</td>
                  <td className="num">{formatPrice(b.medianPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>Median price by district</h2>
        {summary.byRegion.length === 0 ? (
          <p className="muted">No region-mapped listings yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>District</th>
                <th className="num">Listings</th>
                <th className="num">Median price</th>
              </tr>
            </thead>
            <tbody>
              {summary.byRegion.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td className="num">{r.count.toLocaleString("pt-PT")}</td>
                  <td className="num">{formatPrice(r.medianPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="subtitle" style={{ marginTop: 24 }}>
        Explore the full table on the <Link href="/listings">Listings</Link> page or dig into
        correlations and outliers on the <Link href="/analysis">Analysis</Link> page.
      </p>
    </main>
  );
}
