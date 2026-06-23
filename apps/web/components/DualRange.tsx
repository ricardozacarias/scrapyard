"use client";

/**
 * Two-thumb range slider on a single track. Built from two overlaid native
 * range inputs (pointer-events confined to the thumbs) plus a highlighted fill
 * between them — no dependency. The thumb at a crowded end is given priority so
 * the pair never gets stuck overlapping.
 */
export default function DualRange({
  min,
  max,
  step = 1,
  value,
  onChange,
}: {
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  const [lo, hi] = value;
  const span = max > min ? max - min : 1;
  const pct = (v: number) => ((Math.min(Math.max(v, min), max) - min) / span) * 100;

  return (
    <div className="dualrange">
      <div className="dualrange-rail" />
      <div
        className="dualrange-fill"
        style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={lo}
        // when both thumbs sit at the top, keep the lower one grabbable
        style={{ zIndex: lo >= max ? 5 : 4 }}
        onChange={(e) => onChange([Math.min(Number(e.target.value), hi), hi])}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={hi}
        // when both thumbs sit at the bottom, keep the upper one grabbable
        style={{ zIndex: hi <= min ? 5 : 3 }}
        onChange={(e) => onChange([lo, Math.max(Number(e.target.value), lo)])}
      />
    </div>
  );
}
