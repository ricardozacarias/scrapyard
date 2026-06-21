import Choropleth from "@/components/Choropleth";
import { formatPrice } from "@/lib/format";
import { getAnalysisRows, getBiggestPriceDrops, getMunicipalityStats } from "@/lib/queries";

import Scatter from "./scatter";

export const dynamic = "force-dynamic";

export default async function AnalysisPage() {
  const [rows, drops, municipalityStats] = await Promise.all([
    getAnalysisRows({}, 5000),
    getBiggestPriceDrops(20),
    getMunicipalityStats(),
  ]);

  const points = rows.map((r) => ({
    brand: r.brand,
    price: r.price,
    mileageKm: r.mileageKm,
    modelYear: r.modelYear,
  }));

  return (
    <main className="container">
      <h1>Analysis</h1>
      <p className="subtitle">
        Correlations and outliers across {rows.length.toLocaleString("pt-PT")} listings, plus the
        biggest recent price drops from the price history.
      </p>

      <div className="panel">
        <h2>Price heatmap of Portugal · median € by municipality</h2>
        <p className="muted" style={{ marginTop: -6, marginBottom: 14, fontSize: 12 }}>
          {municipalityStats.length} concelhos. Hover one for its median price and listing count.
        </p>
        <Choropleth data={municipalityStats} geoUrl="/geo/concelhos.geojson" nameProp="municipality" />
      </div>

      <div className="panel">
        <h2>Scatter + regression + outlier detection</h2>
        <Scatter data={points} />
      </div>

      <div className="panel">
        <h2>Biggest recent price drops</h2>
        {drops.length === 0 ? (
          <p className="muted">
            No price changes recorded yet. Drops appear once a listing&apos;s price changes between
            scrapes.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Brand</th>
                <th className="num">Was</th>
                <th className="num">Now</th>
                <th className="num">Drop</th>
                <th className="num">Changed</th>
              </tr>
            </thead>
            <tbody>
              {drops.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.url ? (
                      <a href={d.url} target="_blank" rel="noreferrer">
                        {d.title ?? "(untitled)"}
                      </a>
                    ) : (
                      (d.title ?? "(untitled)")
                    )}
                  </td>
                  <td>{d.brand ?? "—"}</td>
                  <td className="num">{formatPrice(d.previousPrice, d.currency ?? "EUR")}</td>
                  <td className="num">{formatPrice(d.currentPrice, d.currency ?? "EUR")}</td>
                  <td className="num drop">−{formatPrice(d.drop, d.currency ?? "EUR")}</td>
                  <td className="num">{new Date(d.changedAt).toLocaleDateString("pt-PT")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
