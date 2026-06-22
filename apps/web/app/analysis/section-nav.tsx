"use client";

import { useEffect, useState } from "react";

export interface Section {
  id: string;
  label: string;
}

/**
 * Sticky in-page nav for the analysis report. Highlights the section nearest
 * the top of the viewport via IntersectionObserver (scroll-spy).
 */
export default function SectionNav({ sections }: { sections: Section[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -65% 0px", threshold: 0 },
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav className="section-nav" aria-label="Sections on this page">
      <span className="eyebrow">On this page</span>
      {sections.map((s) => (
        <a key={s.id} href={`#${s.id}`} className={s.id === active ? "active" : ""}>
          {s.label}
        </a>
      ))}
    </nav>
  );
}
