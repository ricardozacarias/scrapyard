"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The login page is shown standalone (no nav chrome).
export default function Nav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <nav className="nav">
      <span className="brand">
        scrap<span className="hl">yard</span>
      </span>
      <Link href="/">Dashboard</Link>
      <Link href="/listings">Listings</Link>
      <Link href="/analysis">Analysis</Link>
      <Link href="/value">Value my car</Link>
      <Link href="/runs">Runs</Link>
    </nav>
  );
}
