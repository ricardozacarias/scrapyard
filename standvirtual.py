#!/usr/bin/env python3
# standvirtual.py — DOM-only scraper (no JSON-LD; no merging). Drop-in replacement.

from __future__ import annotations
import argparse
import random
import re
import sys
import time
from typing import Optional, List, Dict
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from db import save_cars  # writes to scraper.db and ensures schema on write

BASE = "https://www.standvirtual.com"

# --------- regex helpers ----------
ID_RE = re.compile(r"ID([^.\/]+)\.html", re.I)
INT_RE = re.compile(r"\d[\d .]*")
CM3_RE = re.compile(r"(\d[\d .]*)\s*cm3", re.I)
CV_RE  = re.compile(r"(\d[\d .]*)\s*cv\b", re.I)

# A tiny set of common multiword brand prefixes to improve brand extraction from title.
MULTIWORD_BRANDS = [
    "alfa romeo", "aston martin", "land rover", "mercedes-benz", "mercedes benz",
    "mini", "citroën", "citroen", "volkswagen", "vw", "seat", "cupra", "ds",
    "peugeot", "renault", "opel", "toyota", "honda", "kia", "hyundai", "skoda",
    "audi", "bmw", "fiat", "mazda", "mitsubishi", "nissan", "dacia", "volvo",
    "ford", "suzuki"
]

def _to_int(text: Optional[str]) -> Optional[int]:
    if not text:
        return None
    s = str(text).replace(" ", "").replace(".", "")
    try:
        return int(s)
    except ValueError:
        return None

def fetch_html(max_price: Optional[int] = None, page: int = 1) -> str:
    url = f"{BASE}/carros"
    params = {"page": page}
    if max_price is not None:
        params["search[filter_float_price:to]"] = max_price
    r = requests.get(
        url,
        params=params,
        headers={"User-Agent": "Mozilla/5.0 (compatible; StandvirtualScraper/1.0)"},
        timeout=30,
    )
    r.raise_for_status()
    return r.text

def _find_result_cards(soup: BeautifulSoup):
    """Prefer stable anchors. Fallback to URL pattern if needed."""
    container = soup.select_one('[data-testid="search-results"]')
    if not container:
        return []
    # Many pages include non-listing tiles; keep only those with a listing-like link.
    articles = container.find_all("article")
    cards = []
    for art in articles:
        a = art.find("a", href=True)
        if not a:
            continue
        href = a["href"]
        if "/carros/anuncio/" in href and "ID" in href and href.endswith(".html"):
            cards.append(art)
    return cards

def _extract_title(art) -> Optional[str]:
    h = art.find(["h2", "h3"])
    return h.get_text(strip=True) if h else None

def _extract_url_and_id(art):
    a = art.find("a", href=True)
    if not a:
        return None, None
    url = urljoin(BASE, a["href"])
    m = ID_RE.search(url or "")
    return url, (m.group(1) if m else None)

def _extract_specs_line(art):
    # Short line under title like "1998 cm3 • 130 cv"
    title_el = art.find(["h2", "h3"])
    p = title_el.parent.find_next("p") if title_el else None
    return p.get_text(" ", strip=True) if p else ""

def _extract_params(art) -> Dict[str, Optional[str]]:
    def param(name: str) -> Optional[str]:
        dd = art.select_one(f'dd[data-parameter="{name}"]')
        return dd.get_text(" ", strip=True) if dd else None
    return {
        "mileage": param("mileage"),                             # e.g. "180 000 km"
        "fuel_type": param("fuel_type"),                         # e.g. "Diesel"
        "gearbox": param("gearbox"),                             # e.g. "Manual"
        "first_registration_year": param("first_registration_year"),
    }

def _extract_location_and_seller(art):
    # On the provided HTML, location/seller live in the second <dl>
    dls = art.find_all("dl")
    city = region = seller_type = None
    if len(dls) >= 2:
        loc_p = dls[1].find("p")
        if loc_p:
            loc = loc_p.get_text(strip=True)
            m = re.match(r"^\s*([^()]+?)(?:\s*\(([^)]+)\))?\s*$", loc)
            if m:
                city = (m.group(1) or "").strip() or None
                region = (m.group(2) or "").strip() if m.group(2) else None
        ps = dls[1].find_all("p")
        if len(ps) >= 2:
            stxt = ps[1].get_text(" ", strip=True)
            seller_type = "Profissional" if "Profissional" in stxt else ("Particular" if "Particular" in stxt else None)
    return city, region, seller_type

def _extract_price_currency(art):
    price = currency = None
    for h3 in art.find_all("h3"):
        text = h3.get_text(strip=True)
        m = INT_RE.search(text)
        if m:
            price = _to_int(m.group(0))
            pcur = h3.find_next_sibling("p")
            if pcur:
                currency = pcur.get_text(strip=True)
            break
    if price is not None and not currency:
        currency = "EUR"
    return price, currency

def _extract_brand_from_title(title: Optional[str]) -> Optional[str]:
    if not title:
        return None
    low = title.lower()
    # check multiword brands first
    for b in MULTIWORD_BRANDS:
        if low.startswith(b + " "):
            # return the exact substring from the original title (preserve casing), as a STRING
            return title[:len(b)]
    # else take the first token
    return title.split()[0]


def parse_page(html: str) -> List[Dict]:
    soup = BeautifulSoup(html, "html.parser")
    cards = _find_result_cards(soup)
    out: List[Dict] = []

    for art in cards:
        url, listing_id = _extract_url_and_id(art)
        title = _extract_title(art)
        city, region, seller_type = _extract_location_and_seller(art)
        price, currency = _extract_price_currency(art)

        params = _extract_params(art)
        mileage_km = None
        if params["mileage"]:
            m = INT_RE.search(params["mileage"])
            mileage_km = _to_int(m.group(0)) if m else None

        fuel = params["fuel_type"].capitalize() if params["fuel_type"] else None
        model_year = _to_int(params["first_registration_year"]) if params["first_registration_year"] else None

        # Specs line (optional): "1998 cm3 • 130 cv" — currently not stored in DB, but parseable if needed
        specs = _extract_specs_line(art)
        # cm3 = _to_int(CM3_RE.search(specs).group(1)) if CM3_RE.search(specs) else None
        # cv  = _to_int(CV_RE.search(specs).group(1)) if CV_RE.search(specs) else None

        brand = _extract_brand_from_title(title)

        rec = {
            "listing_id": listing_id,
            "title": title,
            "url": url,
            "city": city,
            "region": region,
            "seller_type": seller_type,
            "price": price,
            "currency": currency,
            "brand": brand,
            "fuel": fuel,
            "model_year": model_year,
            "mileage_km": mileage_km,
        }
        out.append(rec)

    return out

def _normalize_and_dedupe(records: List[Dict]) -> List[Dict]:
    # de-dupe by listing_id (fallback to URL) + normalize numeric fields
    seen = set()
    cleaned = []
    for r in records:
        key = r.get("listing_id") or r.get("url")
        if not key or key in seen:
            continue
        seen.add(key)

        def to_int(x):
            try:
                return int(str(x).replace(".", "").replace(" ", ""))
            except Exception:
                return None

        r["price"] = to_int(r.get("price"))
        r["model_year"] = to_int(r.get("model_year"))
        r["mileage_km"] = to_int(r.get("mileage_km"))
        cleaned.append(r)
    return cleaned

def run_scrape(max_price: int = 15000, pages: int = 2, polite_delay=(1, 4), on_progress=None):
    """Fetch N pages, parse DOM, normalize, upsert to DB, return a small summary dict."""
    if on_progress is None:
        on_progress = lambda i, total: None  # no-op

    all_recs: List[Dict] = []
    pages_fetched = 0
    total_pages = int(pages)

    for p in range(1, total_pages + 1):
        html = fetch_html(max_price=max_price, page=p)
        recs = parse_page(html)

        on_progress(p, total_pages)  # move UI even if empty
        if not recs:
            break

        all_recs.extend(recs)
        pages_fetched += 1

        time.sleep(random.uniform(*polite_delay))

    cleaned = _normalize_and_dedupe(all_recs)
    upserted = save_cars(cleaned)
    return {
        "pages_fetched": pages_fetched,
        "raw_records": len(all_recs),
        "cleaned_records": len(cleaned),
        "upserted": upserted,
    }

def main():
    MAX_PRICE = 10000
    PAGES = 2
    summary = run_scrape(max_price=MAX_PRICE, pages=PAGES)
    print(
        f"Fetched {summary['pages_fetched']} pages, "
        f"{summary['raw_records']} raw -> {summary['cleaned_records']} cleaned; "
        f"upserted {summary['upserted']} into scraper.db"
    )

if __name__ == "__main__":
    main()
