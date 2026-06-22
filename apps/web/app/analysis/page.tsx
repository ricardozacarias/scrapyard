import Choropleth from "@/components/Choropleth";
import { formatPrice } from "@/lib/format";
import { getAnalysisRows, getBiggestPriceDrops, getMunicipalityStats } from "@/lib/queries";

import Scatter from "./scatter";
import SectionNav, { type Section } from "./section-nav";

export const dynamic = "force-dynamic";

const SECTIONS: Section[] = [
  { id: "geography", label: "Geography" },
  { id: "correlations", label: "Correlations" },
  { id: "movers", label: "Movers" },
];

export default async function AnalysisPage() {
  const [rows, drops, municipalityStats] = await Promise.all([
    getAnalysisRows({}, 5000),
    getBiggestPriceDrops(20),
    getMunicipalityStats(),
  ]);

  const points = rows.map((r) => ({
    make: r.make,
    model: r.model,
    price: r.price,
    mileageKm: r.mileageKm,
    modelYear: r.modelYear,
    enginePower: r.enginePower,
  }));

  // Plain-language takeaways derived from the data we already fetched.
  const withMedian = municipalityStats.filter((m) => m.medianPrice != null);
  const cheapest = withMedian.reduce<(typeof withMedian)[number] | null>(
    (a, b) => (a === null || b.medianPrice < a.medianPrice ? b : a),
    null,
  );
  const priciest = withMedian.reduce<(typeof withMedian)[number] | null>(
    (a, b) => (a === null || b.medianPrice > a.medianPrice ? b : a),
    null,
  );

  const geoTakeaway =
    cheapest && priciest
      ? `Median asking prices span ${formatPrice(cheapest.medianPrice)} in ${cheapest.name} up to ${formatPrice(priciest.medianPrice)} in ${priciest.name}, across ${municipalityStats.length} concelhos.`
      : `Median asking price by municipality across ${municipalityStats.length} concelhos.`;

  const moverTakeaway =
    drops.length > 0
      ? `The steepest recent cut is ${formatPrice(drops[0].drop, drops[0].currency ?? "EUR")} off a ${[drops[0].make, drops[0].model].filter(Boolean).join(" ") || "listing"} — ${drops.length} drops tracked from the price history.`
      : "Price cuts appear here once a listing's price changes between scrapes.";

  return (
    <main className="container">
      <h1>Analysis</h1>
      <p className="subtitle">
        Correlations and outliers across {rows.length.toLocaleString("pt-PT")} listings, plus the
        biggest recent price drops from the price history.
      </p>

      <div className="analysis-layout">
        <SectionNav sections={SECTIONS} />

        <div className="analysis-sections">
          <section id="geography" className="report-section">
            <header className="section-head">
              <span className="kicker">Geography</span>
              <h2>Where the market is priciest</h2>
              <p className="takeaway">{geoTakeaway}</p>
            </header>
            <div className="panel">
              <p className="muted" style={{ marginTop: 0, marginBottom: 14, fontSize: 12 }}>
                Hover a concelho for its median price and listing count.
              </p>
              <Choropleth
                data={municipalityStats}
                geoUrl="/geo/concelhos.geojson"
                nameProp="municipality"
              />
            </div>
          </section>

          <section id="correlations" className="report-section">
            <header className="section-head">
              <span className="kicker">Correlations</span>
              <h2>Price vs mileage &amp; age</h2>
              <p className="takeaway">
                Asking price plotted against mileage and model year. The line is the least-squares
                fit; red points are statistical outliers far from it. Switch axes and the outlier
                method below.
              </p>
            </header>
            <div className="panel">
              <Scatter data={points} />
            </div>
          </section>

          <section id="movers" className="report-section">
            <header className="section-head">
              <span className="kicker">Movers</span>
              <h2>Biggest recent price drops</h2>
              <p className="takeaway">{moverTakeaway}</p>
            </header>
            <div className="panel">
              {drops.length === 0 ? (
                <p className="muted">
                  No price changes recorded yet. Drops appear once a listing&apos;s price changes
                  between scrapes.
                </p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Make / model</th>
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
                        <td>{[d.make, d.model].filter(Boolean).join(" ") || "—"}</td>
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
          </section>
        </div>
      </div>
    </main>
  );
}
