# frontend/app.py
# Purpose: Local dashboard to browse listings and trigger the Standvirtual scraper from the UI.
# What it does:
#   - Reads listings from ./data/app.db and shows them in a table with quick stats
#   - Lets you run the Standvirtual scraper (limit & price_max controls) from the UI
#   - Saves scraped rows into SQLite using the same upsert logic as the CLI

from __future__ import annotations
import os
import sys
import sqlite3
import asyncio
import pandas as pd
import streamlit as st

# --- Ensure project root is on sys.path so `backend` can be imported ---
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

# --- Windows-only: ensure Proactor event loop so Playwright can spawn subprocesses ---
if sys.platform.startswith("win"):
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    except Exception:
        # Safe to ignore; older Python versions may already default to Proactor
        pass

# Now import backend bits
from backend.db import Base, engine, SessionLocal
from backend.run_scraper import upsert_many, run_site

DB_PATH = os.path.join(PROJECT_ROOT, "data", "app.db")

st.set_page_config(page_title="My Scraping App", layout="wide")
st.title("My Scraping App (Local)")
st.caption("Browse your locally-scraped listings. Seed the DB, then implement real scrapers.")

# ---------- Scraper controls (left sidebar) ----------
with st.sidebar:
    st.header("Scraper Controls")
    scrape_limit = st.number_input("Max listings to fetch", min_value=5, max_value=100, value=15, step=5)
    scrape_price_max = st.number_input("Price max (€)", min_value=1000, max_value=200000, value=20000, step=1000)
    run_btn = st.button("🚗 Run Standvirtual Scraper", type="primary", use_container_width=True)
    st.caption("Runs Playwright. If a window appears, set headless=True in the scraper file (see note below).")

# ---------- Data filters (main area) ----------
kind = st.segmented_control("Type", options=["all", "property", "car"], default="all")
district = st.text_input("District filter (e.g., Lisboa)", value="")
limit = st.slider("Max results", 10, 1000, 200, step=10)

def load_data(kind, district, limit):
    con = sqlite3.connect(DB_PATH)
    q = "SELECT * FROM listings"
    conds = []
    if kind == "property":
        conds.append("property_type IS NOT NULL")
    elif kind == "car":
        conds.append("car_make IS NOT NULL")
    if district:
        conds.append("district = ?")
    if conds:
        q += " WHERE " + " AND ".join(conds)
    q += " ORDER BY first_seen DESC LIMIT ?"
    params = []
    if district:
        params.append(district)
    params.append(limit)
    df = pd.read_sql_query(q, con, params=params)
    con.close()
    return df

# ---------- Scrape trigger ----------
if run_btn:
    try:
        with st.spinner("Running Standvirtual scraper…"):
            Base.metadata.create_all(bind=engine)  # Ensure tables exist

            # Run scraper via the same backend path the CLI uses
            rows = asyncio.run(
                run_site("standvirtual", limit=int(scrape_limit), price_max=int(scrape_price_max))
            )

            # Persist
            db = SessionLocal()
            try:
                saved = upsert_many(db, rows)
            finally:
                db.close()

        st.success(f"Saved {saved} rows from standvirtual.")
        st.toast(f"Scrape complete: {saved} rows saved.", icon="✅")
        st.rerun()
    except Exception as e:
        st.error(f"Scrape failed: {e!r}")

# ---------- View ----------
df = load_data(kind if kind != "all" else None, district.strip() or None, limit)

left, right = st.columns([3, 2])
with left:
    st.subheader("Listings")
    st.dataframe(df, use_container_width=True, height=520)
with right:
    st.subheader("Quick Stats")
    if len(df) == 0:
        st.info("No rows yet. Click the scraper button or run the seed script once.")
    else:
        props = df[df["property_type"].notna()] if "property_type" in df.columns else pd.DataFrame()
        cars = df[df["car_make"].notna()] if "car_make" in df.columns else pd.DataFrame()
        st.metric("Rows", len(df))
        st.metric("Properties", len(props))
        st.metric("Cars", len(cars))
        if not props.empty and "surface_m2" in props.columns and "price" in props.columns:
            try:
                ppm2 = (props["price"] / 100) / props["surface_m2"]
                st.write("Median € / m²:", int(ppm2.replace([float("inf"), -float("inf")], pd.NA).dropna().median()))
            except Exception:
                pass
        if not cars.empty and "km" in cars.columns:
            try:
                st.write("Median KM (cars):", int(cars["km"].dropna().median()))
            except Exception:
                pass


# ---------- Admin: Database Explorer ----------
st.divider()
st.subheader("Admin: Database Explorer")

def _list_tables(db_path: str) -> list[str]:
    if not os.path.exists(db_path):
        return []
    con = sqlite3.connect(db_path)
    try:
        rows = con.execute("""
            SELECT name
            FROM sqlite_schema
            WHERE type='table' AND name NOT LIKE 'sqlite_%'
            ORDER BY name
        """).fetchall()
        return [r[0] for r in rows]
    finally:
        con.close()

def _get_table_schema(db_path: str, table: str):
    con = sqlite3.connect(db_path)
    try:
        cols = con.execute(f"PRAGMA table_info('{table}')").fetchall()  # cid, name, type, notnull, dflt_value, pk
        fks  = con.execute(f"PRAGMA foreign_key_list('{table}')").fetchall()
        ddl_row = con.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
            (table,)
        ).fetchone()
        idx = con.execute(
            "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql NOT NULL ORDER BY name",
            (table,)
        ).fetchall()
        ddl = ddl_row[0] if ddl_row else ""
        return cols, fks, ddl, idx
    finally:
        con.close()

tables = _list_tables(DB_PATH)

if not tables:
    st.info("No user tables found yet. Run a scrape or your seed/init script to create tables.")
else:
    leftA, rightA = st.columns([1, 3])
    with leftA:
        table = st.selectbox("Choose a table", tables, index=0)
        preview_n = st.slider("Preview rows", 5, 200, 50, step=5)

    with rightA:
        # live preview
        try:
            con = sqlite3.connect(DB_PATH)
            df_preview = pd.read_sql_query(f"SELECT * FROM {table} LIMIT ?", con, params=(preview_n,))
        except Exception as e:
            df_preview = pd.DataFrame({"error": [repr(e)]})
        finally:
            try: con.close()
            except: pass
        st.write(f"Preview: `{table}`")
        st.dataframe(df_preview, use_container_width=True, height=320)

    # schema + DDL
    cols, fks, ddl, idx = _get_table_schema(DB_PATH, table)

    cdf = pd.DataFrame(cols, columns=["cid", "name", "type", "notnull", "dflt_value", "pk"])
    st.markdown("**Columns**")
    st.dataframe(cdf.drop(columns=["cid"]), use_container_width=True, height=220)

    if fks:
        fkdf = pd.DataFrame(fks, columns=[
            "id","seq","table","from","to","on_update","on_delete","match"
        ])
        st.markdown("**Foreign Keys**")
        st.dataframe(fkdf[["table","from","to","on_update","on_delete","match"]], use_container_width=True, height=160)
    else:
        st.caption("No foreign keys defined.")

    if idx:
        with st.expander("Indexes"):
            idf = pd.DataFrame(idx, columns=["name","sql"])
            st.dataframe(idf, use_container_width=True, height=180)
    else:
        st.caption("No indexes (besides implicit PK).")

    with st.expander("CREATE TABLE DDL"):
        st.code(ddl or "-- (no DDL found)", language="sql")


st.button("🔄 Refresh data", on_click=lambda: st.rerun())
