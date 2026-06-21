// Speedometer-style gauge. Pure SVG, server-rendered. A 180° dial with
// green→orange→red zone bands and a needle at `value`. Colors come from the
// theme tokens (CSS custom props resolve inside inline SVG).

interface Zone {
  /** Upper bound of this band; bands are drawn in order from `min`. */
  upTo: number;
  /** Any CSS color, e.g. "var(--green)". */
  color: string;
}

interface GaugeProps {
  value: number;
  max: number;
  min?: number;
  /** Big text shown in the dial (already formatted, e.g. "18 400 €"). */
  display: string;
  /** Small caption under the value. */
  label: string;
  minLabel?: string;
  maxLabel?: string;
  zones: Zone[];
}

const CX = 110;
const CY = 112;
const R = 88;
const NEEDLE = 74;
const STROKE = 12;

function polar(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
}

function angleFor(v: number, min: number, max: number): number {
  const t = Math.min(1, Math.max(0, (v - min) / (max - min)));
  return 180 - t * 180; // 180° (left) → 0° (right), sweeping over the top
}

function arcPath(r: number, startDeg: number, endDeg: number): string {
  const [x1, y1] = polar(r, startDeg);
  const [x2, y2] = polar(r, endDeg);
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export default function Gauge({
  value,
  max,
  min = 0,
  display,
  label,
  minLabel,
  maxLabel,
  zones,
}: GaugeProps) {
  const [nx, ny] = polar(NEEDLE, angleFor(value, min, max));

  let lower = min;
  const bands = zones.map((z) => {
    const band = {
      from: angleFor(lower, min, max),
      to: angleFor(z.upTo, min, max),
      color: z.color,
    };
    lower = z.upTo;
    return band;
  });

  const ticks = Array.from({ length: 6 }, (_, i) => {
    const deg = angleFor((i * max) / 5, min, max);
    const [ox, oy] = polar(R + 2, deg);
    const [ix, iy] = polar(R - 6, deg);
    return { ox, oy, ix, iy };
  });

  return (
    <svg className="gauge" viewBox="0 0 220 132" role="img" aria-label={`${label}: ${display}`}>
      <path
        d={arcPath(R, 180, 0)}
        fill="none"
        stroke="var(--border)"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
      {bands.map((b, i) => (
        <path
          key={i}
          d={arcPath(R, b.from, b.to)}
          fill="none"
          stroke={b.color}
          strokeWidth={STROKE}
        />
      ))}
      {ticks.map((t, i) => (
        <line key={i} x1={t.ox} y1={t.oy} x2={t.ix} y2={t.iy} stroke="var(--muted)" strokeWidth={1.5} />
      ))}
      <line
        x1={CX}
        y1={CY}
        x2={nx.toFixed(2)}
        y2={ny.toFixed(2)}
        stroke="var(--text)"
        strokeWidth={3}
        strokeLinecap="round"
      />
      <circle cx={CX} cy={CY} r={6} fill="var(--text)" />
      <text x={CX} y={84} textAnchor="middle" className="gauge-value">
        {display}
      </text>
      <text x={CX} y={102} textAnchor="middle" className="gauge-label">
        {label}
      </text>
      {minLabel && (
        <text x={20} y={128} textAnchor="middle" className="gauge-tick">
          {minLabel}
        </text>
      )}
      {maxLabel && (
        <text x={200} y={128} textAnchor="middle" className="gauge-tick">
          {maxLabel}
        </text>
      )}
    </svg>
  );
}
