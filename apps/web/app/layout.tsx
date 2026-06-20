import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "Standvirtual Insights",
  description: "Live car listings from standvirtual, with price history and analysis.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <span className="brand">🚗 Standvirtual Insights</span>
          <Link href="/">Dashboard</Link>
          <Link href="/listings">Listings</Link>
          <Link href="/analysis">Analysis</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
