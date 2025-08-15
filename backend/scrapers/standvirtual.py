# backend/scrapers/standvirtual.py
# Purpose: Scrape a small set of car listing cards from Standvirtual using Playwright.
# Headless-friendly with resilient waits, real UA, and debug dumps on failure.

from __future__ import annotations

from typing import List, Dict, Any, Optional, Tuple
import re
import hashlib
import datetime as dt
from urllib.parse import urlencode
from pathlib import Path

from playwright.async_api import async_playwright, TimeoutError as PWTimeoutError

# ---------------------------
# Helpers: IDs & URL builder
# ---------------------------

def stable_id(site: str, external_id: str) -> str:
    return hashlib.sha1(f"{site}:{external_id}".encode()).hexdigest()

def build_search_url(price_max: Optional[int] = None) -> str:
    base = "https://www.standvirtual.com/carros/portugal/"
    params = {}
    if price_max is not None:
        params["search[filter_float_price:to]"] = str(price_max)
    return f"{base}?{urlencode(params)}" if params else base

# ---------------------------
# Helpers: parsing card text
# ---------------------------

YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")
KM_RE = re.compile(r"(\d[\d\s\.]*)(?=\s*km\b)", re.IGNORECASE)

def infer_make_model(title: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    if not title:
        return None, None
    parts = title.split()
    if len(parts) < 2:
        return None, None
    make = parts[0]
    model = " ".join(parts[1:])
    return make.strip(" ,/|-") or None, model.strip(" ,/|-") or None

async def await_safe_count(locator) -> int:
    try:
        return await locator.count()
    except Exception:
        return 0

async def parse_meta_from_card(card) -> dict:
    result = {"car_year": None, "km": None, "fuel": None, "transmission": None}
    try:
        texts: List[str] = []

        lis = card.locator("ul li")
        li_count = await await_safe_count(lis)
        if li_count:
            try:
                texts.extend(await lis.all_text_contents())
            except Exception:
                pass

        smalls = card.locator("small, span, div")
        small_count = await await_safe_count(smalls)
        for i in range(min(8, small_count)):
            try:
                t = await smalls.nth(i).text_content()
                if t and 0 < len(t) < 80:
                    texts.append(t.strip())
            except Exception:
                continue

        blob = " • ".join([t for t in texts if t])

        m = YEAR_RE.search(blob)
        if m:
            result["car_year"] = int(m.group(0))

        normalized = blob.replace("\u202f", " ").replace("\u00a0", " ")
        km_match = KM_RE.search(normalized)
        if km_match:
            digits = re.sub(r"[^\d]", "", km_match.group(1))
            if digits:
                result["km"] = int(digits)

        low = blob.lower()
        if "gasolina" in low:
            result["fuel"] = "Gasolina"
        elif "diesel" in low or "gásóleo" in low or "gasoleo" in low:
            result["fuel"] = "Diesel"
        elif "híbrido" in low or "hibrido" in low:
            result["fuel"] = "Híbrido"
        elif "elétrico" in low or "eletrico" in low:
            result["fuel"] = "Elétrico"

        if "manual" in low:
            result["transmission"] = "Manual"
        elif "automático" in low or "automatico" in low:
            result["transmission"] = "Automático"

    except Exception:
        pass

    return result

# ---------------------------
# Main entry: run()
# ---------------------------

async def run(
    limit: int = 15,
    price_max: Optional[int] = 20000,
    headless: bool = True,
    timeout_ms: int = 30000,
) -> List[Dict[str, Any]]:
    """
    Return up to `limit` listing dicts matching models.Listing fields.
    Headless by default; uses scroll+poll instead of brittle 'visible' waits.
    Dumps debug HTML/screenshot to data/debug on failure.
    """
    search_url = build_search_url(price_max)

    # Prepare debug dir
    repo_root = Path(__file__).resolve().parents[1]  # backend/
    debug_dir = repo_root.parent / "data" / "debug"
    debug_dir.mkdir(parents=True, exist_ok=True)

    # A modern Chrome UA string (Windows)
    ua = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=headless,
            args=["--disable-blink-features=AutomationControlled"],  # reduce headless detection
        )
        ctx = await browser.new_context(
            user_agent=ua,
            locale="pt-PT",
            timezone_id="Europe/Lisbon",
            viewport={"width": 1366, "height": 900},
        )
        page = await ctx.new_page()

        # Navigate
        await page.goto(search_url, wait_until="domcontentloaded", timeout=timeout_ms)

        # Try to accept cookies without blocking if missing
        try:
            for text in ("Aceitar", "Aceito", "Accept", "Concordo", "Eu aceito"):
                btn = page.get_by_role("button", name=text, exact=False)
                if await btn.count() > 0:
                    await btn.first.click(timeout=1200)
                    break
        except PWTimeoutError:
            pass
        except Exception:
            pass

        # Scroll + poll for cards (avoid 'visible' requirement)
        rows: List[Dict[str, Any]] = []
        now = dt.datetime.utcnow()
        selector_cards = "article, li, div[data-testid*='ad'], div[class*='offer']"

        # Try up to N scrolls, checking after each
        found_any = False
        end_time = dt.datetime.utcnow() + dt.timedelta(milliseconds=timeout_ms)
        while dt.datetime.utcnow() < end_time:
            # count cards
            candidate_cards = page.locator(selector_cards)
            card_count = await await_safe_count(candidate_cards)
            if card_count > 0:
                found_any = True
                # proceed to parse
                break
            # gentle scroll to trigger lazy load
            for _ in range(2):
                await page.mouse.wheel(0, 1200)
                await page.wait_for_timeout(500)

        if not found_any:
            # Dump HTML + screenshot for diagnosis
            ts = dt.datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            html_path = debug_dir / f"standvirtual_timeout_{ts}.html"
            png_path = debug_dir / f"standvirtual_timeout_{ts}.png"
            try:
                await page.screenshot(path=str(png_path), full_page=True)
            except Exception:
                pass
            try:
                html = await page.content()
                html_path.write_text(html, encoding="utf-8")
            except Exception:
                pass
            await browser.close()
            return []  # upstream will show "Saved 0 rows" or your UI will display error

        # Parse up to `limit` cards
        candidate_cards = page.locator(selector_cards)
        card_count = await await_safe_count(candidate_cards)

        for i in range(card_count):
            if len(rows) >= limit:
                break

            card = candidate_cards.nth(i)
            link = card.locator("a[href*='/carro/'], a[href*='/oferta/'], a[href*='/carros/']").first
            if await link.count() == 0:
                continue

            try:
                href = await link.get_attribute("href")
                if not href:
                    continue
                url = href if href.startswith("http") else f"https://www.standvirtual.com{href}"
                tail = url.rstrip("/").split("/")[-1]
                external_id = tail.split(".")[0] if tail else url

                # Title
                title = None
                for sel in ("h2", "h3", "[data-testid='ad-title']"):
                    el = card.locator(sel).first
                    if await el.count():
                        t = await el.text_content()
                        if t and t.strip():
                            title = t.strip()
                            break

                # Price
                price_text = None
                for sel in ("[data-testid='ad-price']", "span:has-text('€')", "div:has-text('€')"):
                    el = card.locator(sel).first
                    if await el.count():
                        txt = await el.text_content()
                        if txt and "€" in txt:
                            price_text = txt.strip()
                            break
                digits = "".join(ch for ch in (price_text or "") if ch.isdigit())
                price_cents = int(digits) * 100 if digits else None

                # City
                city = None
                for sel in ("[data-testid='location']",
                            "span[class*='location']",
                            "p[class*='location']",
                            "span:has-text('Portugal')"):
                    el = card.locator(sel).first
                    if await el.count():
                        txt = await el.text_content()
                        if txt and txt.strip():
                            city = txt.strip()
                            break

                # Enrich
                car_make, car_model = infer_make_model(title)
                meta_vals = await parse_meta_from_card(card)

                rows.append({
                    "id": stable_id("standvirtual", external_id),
                    "site": "standvirtual",
                    "external_id": external_id,
                    "url": url,
                    "title": title,
                    "description": None,
                    "price": price_cents,
                    "currency": "EUR",
                    "city": city,
                    "district": None,
                    "parish": None,
                    "latitude": None,
                    "longitude": None,
                    "surface_m2": None,
                    "bedrooms": None,
                    "bathrooms": None,
                    "property_type": None,
                    "year": None,
                    "car_make": car_make,
                    "car_model": car_model,
                    "car_year": meta_vals.get("car_year"),
                    "km": meta_vals.get("km"),
                    "fuel": meta_vals.get("fuel"),
                    "transmission": meta_vals.get("transmission"),
                    "created_at": now,
                    "first_seen": now,
                    "last_seen": now,
                    "is_active": True,
                    "raw": None,
                })
            except Exception:
                continue

        await browser.close()
        return rows


# --- new helper: fetch search page RAW html without parsing ---
async def fetch_search_html(
    price_max: Optional[int] = 20000,
    headless: bool = True,
    timeout_ms: int = 30000,
) -> tuple[str, str]:
    """
    Returns (url, html) for the search page. Separate from run() so we can
    store a RAW snapshot before parsing listings.
    """
    search_url = build_search_url(price_max)
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=headless,
            args=["--disable-blink-features=AutomationControlled"],
        )
        ctx = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="pt-PT",
            timezone_id="Europe/Lisbon",
            viewport={"width": 1366, "height": 900},
        )
        page = await ctx.new_page()
        await page.goto(search_url, wait_until="domcontentloaded", timeout=timeout_ms)
        html = await page.content()
        await browser.close()
        return search_url, html
