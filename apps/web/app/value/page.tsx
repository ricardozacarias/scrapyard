import { getValuationModels } from "@/lib/fair-price";
import { formatNumber } from "@/lib/format";

import ValuationTool from "./valuation-tool";

export const dynamic = "force-dynamic";

export default async function ValuePage() {
  const models = await getValuationModels();
  const covered = models.reduce((a, m) => a + m.n, 0);

  return (
    <main className="container">
      <h1>What&apos;s my car worth?</h1>
      <p className="subtitle">
        A market estimate from {models.length} per-model price regressions fitted on{" "}
        {formatNumber(covered)} recent listings — active and recently sold — pick your car, get
        today&apos;s fair asking price.
      </p>
      <ValuationTool models={models} />
      <p className="muted" style={{ marginTop: 14 }}>
        The estimate is the median asking price the market would put on your car&apos;s make,
        model, year, mileage, fuel and power today — not a guaranteed sale price. The range covers
        roughly the middle two-thirds of comparable listings. Condition, trim and options are not
        observed, which is why it&apos;s a range and not a number.
      </p>
    </main>
  );
}
