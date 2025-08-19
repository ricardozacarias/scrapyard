#!/usr/bin/env python3
import argparse, json, re
from urllib.parse import urljoin
import requests
from bs4 import BeautifulSoup
import time
import random
import sys

from db import save_cars  # uses scraper.db and ensures schema on write

BASE = "https://www.standvirtual.com"

def fetch_html(max_price=None, page=1):
    url = f"{BASE}/carros"
    params = {"page": page}
    if max_price is not None:
        params["search[filter_float_price:to]"] = max_price
    r = requests.get(url, params=params, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
    r.raise_for_status()
    return r.text


def parse_page(html):
    soup = BeautifulSoup(html, "html.parser")

    # 1) JSON-LD offers -> map by car name (title)
    offers_map = {}
    script = soup.find("script", {"id": "listing-json-ld", "type": "application/ld+json"})
    if script and script.string:
        try:
            data = json.loads(script.string)
            items = (data.get("mainEntity", {}) or {}).get("itemListElement", []) or []
            for it in items:
                item = it.get("itemOffered", {}) or {}
                name = item.get("name")
                price_spec = (it.get("priceSpecification") or {})
                offers_map[name] = {
                    "price": price_spec.get("price"),
                    "currency": price_spec.get("priceCurrency"),
                    "brand": item.get("brand"),
                    "fuel": item.get("fuelType"),
                    "model_year": item.get("modelDate"),
                    "mileage_km": ((item.get("mileageFromOdometer") or {}).get("value")),
                }
        except json.JSONDecodeError:
            pass

    # 2) Visible cards
    out = []
    results = soup.find("div", attrs={"data-testid": "search-results"})
    if not results:
        return out

    for art in results.select("article.ooa-zet1mn.e1t2ydkr0"):
        # URL: first link to /carros/anuncio/...
        url = None
        a = art.find("a", href=True)
        if a and "/carros/anuncio/" in a["href"]:
            url = urljoin(BASE, a["href"])

        listing_id = None
        if url:
            m = re.search(r'ID([^.]+)\.html', url)
            if m:
                listing_id = m.group(1)

        # Title: first h2 text (car make+model)
        h2 = art.find("h2")
        title = h2.get_text(strip=True) if h2 else None

        # Two <p class="ooa-15v0vci"> (location + seller type)
        tags = [p.get_text(strip=True) for p in art.select("p.ooa-15v0vci")][:2]
        loc = tags[0] if len(tags) > 0 else None
        seller = tags[1] if len(tags) > 1 else None

        city, region = None, None
        if loc:
            m = re.match(r'\s*(.+?)\s*(?:\(([^)]+)\))?\s*$', loc)
            if m:
                city = m.group(1).strip()
                region = m.group(2).strip() if m.group(2) else None

        seller_clean = None
        if seller:
            first = seller.split('•', 1)[0].strip()  # take left side of the bullet
            if "Profissional" in first:
                seller_clean = "Profissional"
            elif "Particular" in first:
                seller_clean = "Particular"
            else:
                seller_clean = first  # fallback

        rec = {
            "listing_id": listing_id,
            "title": title,
            "url": url,
            "city": city,
            "region": region,
            "seller_type": seller_clean,
        }

        # Merge structured bits if title matches JSON-LD itemOffered.name
        if title in offers_map:
            rec.update(offers_map[title])
        else:
            if title:
                print(f"[WARN] No JSON-LD match for title: {title}", file=sys.stderr)

        out.append(rec)

    return out

def _normalize_and_dedupe(records):
    # de-dupe by listing_id (fallback to URL)
    seen = set()
    cleaned = []
    for r in records:
        key = r.get("listing_id") or r.get("url")
        if not key or key in seen:
            continue
        seen.add(key)

        # normalize numerics
        def to_int(x):
            try:
                return int(str(x).replace(".", "").replace(" ", ""))
            except:
                return None

        r["price"] = to_int(r.get("price"))
        r["model_year"] = to_int(r.get("model_year"))
        r["mileage_km"] = to_int(r.get("mileage_km"))
        cleaned.append(r)
    return cleaned

def run_scrape(max_price=15000, pages=2, polite_delay=(1, 4)):
    """Fetch N pages, normalize, upsert to DB, return a small summary dict."""
    all_recs = []
    pages_fetched = 0
    for p in range(1, pages + 1):
        html = fetch_html(max_price=max_price, page=p)
        recs = parse_page(html)
        if not recs:
            break
        all_recs.extend(recs)
        pages_fetched += 1
        time.sleep(random.uniform(*polite_delay))  # politeness
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
    print(f"Fetched {summary['pages_fetched']} pages, "
          f"{summary['raw_records']} raw -> {summary['cleaned_records']} cleaned; "
          f"upserted {summary['upserted']} into scraper.db")


if __name__ == "__main__":
    main()
