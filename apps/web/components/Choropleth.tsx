"use client";

import * as Plot from "@observablehq/plot";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatNumber, formatPrice } from "@/lib/format";

export interface RegionStat {
  name: string;
  count: number;
  medianPrice: number;
}

interface GeoFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
}
interface GeoJson {
  type: "FeatureCollection";
  features: GeoFeature[];
}

/** Lowercase, strip accents, collapse non-alphanumerics — to match GeoJSON names to DB names. */
function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s-])([a-zà-ú])/g, (_m, a, b) => a + b.toUpperCase());
}

export default function Choropleth({
  data,
  geoUrl,
  nameProp,
  metricLabel = "Median price",
}: {
  data: RegionStat[];
  geoUrl: string;
  nameProp: string;
  metricLabel?: string;
}) {
  const [geo, setGeo] = useState<GeoJson | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);

  useEffect(() => {
    let on = true;
    fetch(geoUrl)
      .then((r) => r.json())
      .then((j) => {
        if (on) setGeo(j as GeoJson);
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [geoUrl]);

  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    // Portugal is ~2:1 tall, so keep the width small to keep the map height sane.
    const update = () => setWidth(Math.min(el.clientWidth || 360, 340));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const byName = useMemo(() => new Map(data.map((d) => [norm(d.name), d])), [data]);

  useEffect(() => {
    if (!geo || !plotRef.current) return;
    for (const f of geo.features) {
      const stat = byName.get(norm(String(f.properties[nameProp] ?? "")));
      f.properties._median = stat ? stat.medianPrice : null;
      f.properties._count = stat ? stat.count : 0;
      f.properties._label = titleCase(String(f.properties[nameProp] ?? ""));
    }

    // Clamp the color domain to the 5th–95th percentile so a single low-volume
    // concelho with a freak median (one supercar) can't compress everyone else
    // into one colour. Outliers clamp to the ramp ends.
    const meds = data
      .map((d) => d.medianPrice)
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    const q = (f: number) =>
      meds.length ? meds[Math.min(meds.length - 1, Math.max(0, Math.round(f * (meds.length - 1))))]! : 0;
    let domain: [number, number] | undefined =
      meds.length >= 4 ? [q(0.05), q(0.95)] : undefined;
    if (domain && domain[0] === domain[1]) domain = undefined;

    const container = plotRef.current;
    container.replaceChildren();
    // projection domain fits to Portugal and derives the height from the fitted
    // aspect. (Requires d3-geo winding — clockwise exterior rings — which the
    // GeoJSON is pre-processed to; RFC7946/CCW would fill the whole sphere.)
    const plot = Plot.plot({
      width,
      projection: { type: "mercator", domain: geo },
      style: { background: "transparent", color: "#f0f0f0", fontFamily: "ui-monospace, monospace" },
      color: {
        type: "linear",
        domain,
        clamp: true,
        range: ["#3fb950", "#ffd400", "#ff6a13", "#ff3340"],
        unknown: "#2c2c28",
        label: `${metricLabel} (€)`,
        legend: true,
      },
      marks: [
        Plot.geo(geo, {
          fill: (d: GeoFeature) => d.properties._median as number | null,
          stroke: "#141414",
          strokeWidth: 0.6,
          channels: {
            Region: (d: GeoFeature) => d.properties._label as string,
            Median: (d: GeoFeature) =>
              d.properties._median != null ? formatPrice(d.properties._median as number) : "no data",
            Listings: (d: GeoFeature) => formatNumber(d.properties._count as number),
          },
          tip: true,
        }),
      ],
    });
    container.append(plot);
    return () => plot.remove();
  }, [geo, byName, width, nameProp, metricLabel]);

  return (
    <div ref={wrapRef} style={{ display: "flex", justifyContent: "center" }}>
      <div ref={plotRef} />
      {!geo && <p className="muted">Loading map…</p>}
    </div>
  );
}
