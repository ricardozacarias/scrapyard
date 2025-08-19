# app.py
# Minimal Streamlit admin for Standvirtual scraper + SQLite explorer

import sqlite3
from pathlib import Path

import pandas as pd
import streamlit as st
import altair as alt

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

tab_scrape, tab_explore, tab_analysis = st.tabs(["🧲 Scrape", "🗂 Explore DB", "📊 Analysis"])

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

        # progress UI
        prog = st.progress(0)
        status = st.empty()

        def _on_progress(i, total):
            pct = int(i * 100 / max(total, 1))
            prog.progress(pct)
            status.write(f"Scraping page {i}/{total}…")

        # run scraper with progress callback
        summary = run_scrape(
            max_price=int(max_price),
            pages=int(pages),
            on_progress=_on_progress,  # <-- progress callback
        )

        # finalize progress UI
        prog.progress(100)
        status.success("Scrape complete.")

        # metrics + preview
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
            st.rerun() 

    df = read_table(
        limit=limit,
        filters={"brand": brand, "city": city, "fuel": fuel, "seller_type": seller_type},
        order_by=order_by,
        order_dir=order_dir,
    )
    st.dataframe(df, use_container_width=True)
    
with tab_analysis:
    import altair as alt
    import pandas as pd

    st.subheader("Scatter analysis")
    ensure_db()

    # basic controls
    max_rows = st.slider("Max rows", 200, 10000, 2000, 200)

    # small reload button
    a_col1, _ = st.columns([1, 9])
    with a_col1:
        if st.button("🔄 Reload data", key="analysis_reload", help="Clear cache and reload from database"):
            read_table.clear()
            st.toast("Data reloaded")
            st.rerun()

    # load data
    df = read_table(limit=max_rows, order_by=None)

    # ---------- Brand filter ----------
    f1, _ = st.columns([1, 3])
    brands = []
    if "brand" in df.columns:
        brands = sorted([b for b in df["brand"].dropna().unique().tolist() if str(b).strip()])
    brand_choice = f1.selectbox("Brand", options=(["All brands"] + brands) if brands else ["All brands"])

    # ---------- Dynamic numeric range sliders ----------
    num_filters = {}
    num_cols_all = list(df.select_dtypes(include="number").columns)

    if num_cols_all:
        st.markdown("### Filters")
        cols = st.columns(2)  # lay sliders in two columns
        for i, col in enumerate(num_cols_all):
            series = df[col].dropna().astype(float)
            if series.empty:
                continue
            vmin, vmax = float(series.min()), float(series.max())

            # If column is integer-like, use int slider; else float slider
            is_intlike = (series % 1 == 0).all()

            if is_intlike:
                sel_min, sel_max = cols[i % 2].slider(
                    f"{col}",
                    min_value=int(vmin),
                    max_value=int(vmax),
                    value=(int(vmin), int(vmax)),
                    step=1,
                )
                num_filters[col] = (float(sel_min), float(sel_max))
            else:
                step = (vmax - vmin) / 100.0 if vmax > vmin else 1.0
                sel_min, sel_max = cols[i % 2].slider(
                    f"{col}",
                    min_value=vmin,
                    max_value=vmax,
                    value=(vmin, vmax),
                    step=step,
                )
                num_filters[col] = (sel_min, sel_max)

    # ---------- Apply filters ----------
    dff = df.copy()

    if brand_choice != "All brands" and "brand" in dff.columns:
        dff = dff[dff["brand"] == brand_choice]

    for col, (lo, hi) in num_filters.items():
        if col in dff.columns:
            dff = dff[dff[col].notna()]
            dff = dff[(dff[col].astype(float) >= float(lo)) & (dff[col].astype(float) <= float(hi))]

    # ---------- Plot ----------
    chart = None
    num_cols = list(dff.select_dtypes(include="number").columns)

    if len(num_cols) < 2:
        st.info("Not enough numeric columns to plot. Try scraping data first.")
    else:
        c1, c2 = st.columns(2)
        default_x = num_cols.index("price") if "price" in num_cols else 0
        default_y = (
            num_cols.index("mileage_km")
            if "mileage_km" in num_cols
            else (1 if len(num_cols) > 1 else 0)
        )
        x = c1.selectbox("X axis", options=num_cols, index=default_x)
        y = c2.selectbox("Y axis", options=num_cols, index=default_y)

        if not dff.empty:
            x_min, x_max = dff[x].min(), dff[x].max()
            y_min, y_max = dff[y].min(), dff[y].max()

            chart = (
                alt.Chart(dff)
                .mark_circle(size=60, opacity=0.6)
                .encode(
                    x=alt.X(x, scale=alt.Scale(domain=[x_min, x_max])),
                    y=alt.Y(y, scale=alt.Scale(domain=[y_min, y_max])),
                    tooltip=list(dff.columns),
                )
                .interactive()
            )

    if chart is not None:
        st.altair_chart(chart, use_container_width=True)
        st.caption(f"Rows plotted: {len(dff)}")
    else:
        st.info("No data to plot with the current filters.")


