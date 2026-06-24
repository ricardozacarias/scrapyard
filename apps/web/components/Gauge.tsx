// Tachometer-style gauge. Pure SVG dial, server-rendered, with an HTML caption
// below it. A 180° dial with a dark recessed face, a green→amber→red zone band
// *interrupted* into segments by face-colored notches, faint major ticks with
// numerals, and a tapered needle at `value`. Colors come from the theme tokens
// (CSS custom props resolve inside inline SVG). The numeric readout sits below
// the hub so the needle never sweeps across it; the title + optional info
// tooltip live in the HTML caption underneath.

interface Zone {
  /** Upper bound of this band; bands are drawn in order from `min`. */
  upTo: number;
  /** Any CSS color, e.g. "var(--gauge-low)". */
  color: string;
}

interface GaugeProps {
  value: number;
  max: number;
  min?: number;
  /** Big number shown below the hub, already formatted (e.g. "18 400"). */
  display: string;
  /** Small unit suffix rendered next to the number (e.g. "€", "km", "%"). */
  unit?: string;
  /** Caption under the dial. */
  label: string;
  /** Optional explanation shown in a tooltip behind a "?" icon. */
  tip?: string;
  /** Labels for the major ticks, left→right. Up to 6 (extras ignored). */
  numerals?: string[];
  zones: Zone[];
}

const CX = 120;
const CY = 126;
const R = 80;
const NEEDLE = 60;
const STROKE = 11;
const SEGMENTS = 10; // band is cut into this many pieces by face-colored notches

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
  unit,
  label,
  tip,
  numerals,
  zones,
}: GaugeProps) {
  const needleAngle = angleFor(value, min, max);
  const [nx, ny] = polar(NEEDLE, needleAngle);
  // tapered blade: tip + two base points flanking the hub
  const [bx1, by1] = polar(5, needleAngle + 90);
  const [bx2, by2] = polar(5, needleAngle - 90);

  let lower = min;
  const bands = zones.map((z, i) => {
    const band = {
      from: angleFor(lower, min, max),
      to: angleFor(z.upTo, min, max),
      color: z.color,
      round: i === 0 || i === zones.length - 1,
    };
    lower = z.upTo;
    return band;
  });

  // interior notches that segment the band (skip the two rounded ends)
  const notches = Array.from({ length: SEGMENTS - 1 }, (_, i) => {
    const deg = 180 - ((i + 1) / SEGMENTS) * 180;
    const [ox, oy] = polar(R + 8, deg);
    const [ix, iy] = polar(R - 8, deg);
    return { ox, oy, ix, iy };
  });

  // faint tick + numeral at each major position
  const majors = Array.from({ length: 6 }, (_, i) => {
    const deg = 180 - (i / 5) * 180;
    const [ox, oy] = polar(R - 9, deg);
    const [ix, iy] = polar(R - 13, deg);
    const [tx, ty] = polar(R - 20, deg);
    return { ox, oy, ix, iy, tx, ty, numeral: numerals?.[i] };
  });

  return (
    <div className="gauge-wrap">
      <svg className="gauge" viewBox="0 0 240 168" role="img" aria-label={`${label}: ${display} ${unit ?? ""}`}>
        {/* recessed dark face */}
        <path d={`${arcPath(R + 15, 180, 0)} Z`} fill="var(--gauge-face)" />
        {/* base track (blends with the face; shows only under the rounded band ends) */}
        <path
          d={arcPath(R, 180, 0)}
          fill="none"
          stroke="var(--gauge-face)"
          strokeWidth={STROKE + 2}
          strokeLinecap="round"
        />
        {bands.map((b, i) => (
          <path
            key={i}
            d={arcPath(R, b.from, b.to)}
            fill="none"
            stroke={b.color}
            strokeWidth={STROKE}
            strokeLinecap={b.round ? "round" : "butt"}
          />
        ))}
        {notches.map((n, i) => (
          <line
            key={i}
            x1={n.ox.toFixed(2)}
            y1={n.oy.toFixed(2)}
            x2={n.ix.toFixed(2)}
            y2={n.iy.toFixed(2)}
            stroke="var(--gauge-face)"
            strokeWidth={2.4}
          />
        ))}
        {majors.map((m, i) => (
          <line
            key={i}
            x1={m.ox.toFixed(2)}
            y1={m.oy.toFixed(2)}
            x2={m.ix.toFixed(2)}
            y2={m.iy.toFixed(2)}
            stroke="var(--text)"
            strokeWidth={1.2}
            opacity={0.85}
          />
        ))}
        {majors.map((m, i) =>
          m.numeral ? (
            <text key={`n${i}`} x={m.tx.toFixed(2)} y={(m.ty + 3).toFixed(2)} textAnchor="middle" className="gauge-num">
              {m.numeral}
            </text>
          ) : null,
        )}
        {/* tapered needle + hub */}
        <polygon
          points={`${nx.toFixed(2)},${ny.toFixed(2)} ${bx1.toFixed(2)},${by1.toFixed(2)} ${bx2.toFixed(2)},${by2.toFixed(2)}`}
          fill="var(--text)"
        />
        <circle cx={CX} cy={CY} r={8} fill="var(--panel-2)" stroke="var(--muted)" strokeWidth={1.5} />
        <circle cx={CX} cy={CY} r={3} fill="var(--accent)" />
        {/* readout — below the hub, clear of the needle sweep */}
        <text x={CX} y={CY + 32} textAnchor="middle">
          <tspan className="gauge-value">{display}</tspan>
          {unit && (
            <tspan dx={4} className="gauge-unit">
              {unit}
            </tspan>
          )}
        </text>
      </svg>
      <div className="gauge-caption">
        <span className="gauge-title">{label}</span>
        {tip && (
          <span className="info-dot" tabIndex={0} role="button" aria-label={`What is ${label}?`}>
            ?<span className="info-tip" role="tooltip">{tip}</span>
          </span>
        )}
      </div>
    </div>
  );
}
