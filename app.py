# app.py
# Minimal Streamlit admin for Standvirtual scraper + SQLite explorer

import sqlite3
from pathlib import Path

import pandas as pd
import streamlit as st

from db import DB_PATH, SCHEMA_PATH  # points to "scraper.db" and "schema.sql"
from standvirtual import run_scrape

st.set_page_config(page_title="Standvirtual Scraper Admin", layout="wide")

# --- ensure DB exists / schema is applied (read-only safe if already there)
def ensure_db():
    con = sqlite3.connect(DB_PATH)
    with con:
        con.executescript(Path(SCHEMA_PATH).read_text(encoding="utf-8"))
    return con

# --- small helpers
@st.cache_data(show_spinner=False)
def read_table(limit=1000, filters=None, order_by=None, order_dir="DESC"):
    con = sqlite3.connect(DB_PATH)
    q = "SELECT * FROM cars"
    clauses = []
    params = []
    if filters:
        for col, value in filters.items():
            if value:
                clauses.append(f"{col} LIKE ?")
                params.append(f"%{value}%")
    if clauses:
        q += " WHERE " + " AND ".join(clauses)
    if order_by:
        q += f" ORDER BY {order_by} {order_dir}"
    q += f" LIMIT {int(limit)}"
    df = pd.read_sql_query(q, con, params=params)
    con.close()
    return df

@st.cache_data(show_spinner=False)
def read_schema():
    con = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query("PRAGMA table_info(cars);", con)
    con.close()
    return df

# --- UI
st.title("Standvirtual Scraper Admin")

tab_scrape, tab_explore = st.tabs(["🧲 Scrape", "🗂 Explore DB"])

with tab_scrape:
    st.subheader("Trigger scrape")
    col1, col2 = st.columns(2)
    with col1:
        max_price = st.number_input("Max price", min_value=0, value=15000, step=500)
    with col2:
        pages = st.number_input("Pages", min_value=1, value=2, step=1)

    run_btn = st.button("Run scraper", type="primary")

    if run_btn:
        ensure_db()
        with st.spinner("Scraping…"):
            summary = run_scrape(
                max_price=int(max_price),
                pages=int(pages)
            )
        st.success("Done.")
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Pages fetched", summary["pages_fetched"])
        c2.metric("Raw records", summary["raw_records"])
        c3.metric("Cleaned", summary["cleaned_records"])
        c4.metric("Upserted", summary["upserted"])

        st.caption("Latest rows (by scraped_at)")
        latest = read_table(limit=50, order_by="scraped_at", order_dir="DESC")
        st.dataframe(latest, use_container_width=True)


with tab_explore:
    st.subheader("Cars table")
    ensure_db()

    # schema
    with st.expander("Table schema"):
        schema_df = read_schema()
        st.dataframe(schema_df, use_container_width=True)

    # filters
    with st.expander("Filters"):
        f_col1, f_col2, f_col3, f_col4 = st.columns(4)
        brand = f_col1.text_input("brand contains")
        city = f_col2.text_input("city contains")
        fuel = f_col3.text_input("fuel contains")
        seller_type = f_col4.text_input("seller_type contains")
        limit = st.slider("Max rows", 100, 5000, 1000, 100)
        order_by = st.selectbox("Order by", ["scraped_at", "price", "model_year", "mileage_km", "brand", "city"])
        order_dir = st.radio("Order direction", ["DESC", "ASC"], horizontal=True)

    # --- refresh toolbar (place this just above the table)
    toolbar_col1, _ = st.columns([1, 9])
    with toolbar_col1:
        if st.button("🔄 Refresh table", help="Clear cache and reload from database"):
            read_table.clear()   # clears the @st.cache_data for read_table
            st.toast("Table refreshed")
            st.experimental_rerun()

    df = read_table(
        limit=limit,
        filters={"brand": brand, "city": city, "fuel": fuel, "seller_type": seller_type},
        order_by=order_by,
        order_dir=order_dir,
    )
    st.dataframe(df, use_container_width=True)
