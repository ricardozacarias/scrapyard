// Column histogram of listing count per model year. Pure SVG, server-rendered.
// Bars use the accent color; a light y-grid and sparse year labels keep it
// readable. Theme tokens resolve as CSS custom props inside the inline SVG.

interface YearDatum {
  year: number;
  count: number;
}

const W = 520;
const H = 220;
const L = 36; // left pad for y-axis labels
const R = 8;
const T = 12;
const B = 26; // bottom pad for year labels

function compact(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
}

export default function YearHistogram({ data }: { data: YearDatum[] }) {
  if (data.length === 0) {
    return <p className="muted">No model-year data yet.</p>;
  }

  const plotW = W - L - R;
  const plotH = H - T - B;
  const baseY = T + plotH;
  const max = Math.max(...data.map((d) => d.count));
  const step = plotW / data.length;
  const barW = step * 0.72;
  const lastYear = data[data.length - 1]!.year;

  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const v = (max * i) / 4;
    return { v, y: baseY - (v / max) * plotH };
  });

  return (
    <svg
      className="histogram"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Listing count by model year"
    >
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={L} y1={t.y} x2={W - R} y2={t.y} stroke="var(--border)" strokeWidth={1} />
          <text x={L - 5} y={t.y + 3} textAnchor="end" className="hist-axis">
            {compact(t.v)}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const h = (d.count / max) * plotH;
        const x = L + i * step + (step - barW) / 2;
        return (
          <rect
            key={d.year}
            x={x.toFixed(1)}
            y={(baseY - h).toFixed(1)}
            width={barW.toFixed(1)}
            height={h.toFixed(1)}
            rx={1.5}
            fill="var(--accent)"
          >
            <title>{`${d.year}: ${d.count.toLocaleString("pt-PT")} listings`}</title>
          </rect>
        );
      })}
      {data.map((d, i) => {
        const showLabel = d.year % 5 === 0 || d.year === lastYear;
        if (!showLabel) return null;
        const x = L + i * step + step / 2;
        return (
          <text key={`y${d.year}`} x={x.toFixed(1)} y={H - 8} textAnchor="middle" className="hist-axis">
            {`'${String(d.year).slice(2)}`}
          </text>
        );
      })}
    </svg>
  );
}
