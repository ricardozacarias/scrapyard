import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "scrapyard",
  description: "Live car listings from standvirtual, with price history and analysis.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <span className="brand">
            scrap<span className="hl">yard</span>
          </span>
          <Link href="/">Dashboard</Link>
          <Link href="/listings">Listings</Link>
          <Link href="/analysis">Analysis</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
