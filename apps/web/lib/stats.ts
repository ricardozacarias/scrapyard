// Pure statistics helpers, ported from the old Streamlit analysis tab.

export interface Regression {
  slope: number;
  intercept: number;
  r2: number;
  predict: (x: number) => number;
}

/** Ordinary least-squares fit of y = slope*x + intercept, plus R². */
export function linearRegression(xs: number[], ys: number[]): Regression | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;

  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i] as number;
    sy += ys[i] as number;
  }
  const mx = sx / n;
  const my = sy / n;

  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] as number) - mx;
    sxx += dx * dx;
    sxy += dx * ((ys[i] as number) - my);
  }
  if (sxx === 0) return null; // no variance in x

  const slope = sxy / sxx;
  const intercept = my - slope * mx;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = slope * (xs[i] as number) + intercept;
    ssRes += ((ys[i] as number) - pred) ** 2;
    ssTot += ((ys[i] as number) - my) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : NaN;

  return { slope, intercept, r2, predict: (x) => slope * x + intercept };
}

export type OutlierMethod = "zscore" | "mad";

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

/**
 * Flag points whose residual from the regression line is unusually large.
 * - "zscore": |residual| / std(residuals) > threshold (default 3.0)
 * - "mad": robust, |residual - median| / (1.4826*MAD) > threshold (default 3.5)
 */
export function detectOutliers(
  residuals: number[],
  method: OutlierMethod,
  threshold: number,
): boolean[] {
  const n = residuals.length;
  if (n === 0) return [];

  if (method === "zscore") {
    const mean = residuals.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(residuals.reduce((a, r) => a + (r - mean) ** 2, 0) / n);
    if (std === 0) return residuals.map(() => false);
    return residuals.map((r) => Math.abs((r - mean) / std) > threshold);
  }

  const med = median(residuals);
  const mad = median(residuals.map((r) => Math.abs(r - med)));
  const madStd = 1.4826 * mad;
  if (madStd === 0) return residuals.map(() => false);
  return residuals.map((r) => Math.abs(r - med) / madStd > threshold);
}

export const DEFAULT_THRESHOLDS: Record<OutlierMethod, number> = {
  zscore: 3.0,
  mad: 3.5,
};
