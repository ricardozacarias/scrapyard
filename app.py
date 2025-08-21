# app.py
# Minimal Streamlit admin for Standvirtual scraper + SQLite explorer

import sqlite3
from pathlib import Path

import pandas as pd
import streamlit as st
import altair as alt
import numpy as np
import os

from db import DB_PATH, SCHEMA_PATH, connect  # points to "scraper.db" and "schema.sql"
from db import backfill_cars_region_ids
from db import IS_PG
from standvirtual import run_scrape

if "DATABASE_URL" in st.secrets:
    os.environ["DATABASE_URL"] = st.secrets["DATABASE_URL"]

st.set_page_config(page_title="RickyScrape", layout="wide")

# --- ensure DB exists / schema is applied (read-only safe if already there)
def ensure_db():
    con = connect()
    if not IS_PG:
        with con:
            con.executescript(Path(SCHEMA_PATH).read_text(encoding="utf-8"))
    return con

# --- small helpers
@st.cache_data(show_spinner=False)
def list_tables():
    con = connect()
    if IS_PG:
        q = "SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename;"
    else:
        q = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
    df = pd.read_sql_query(q, con)
    con.close()
    return df["name"].tolist()


@st.cache_data(show_spinner=False)
def read_schema_generic(table: str):
    con = connect()
    if IS_PG:
        q = """
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema='public' AND table_name=%s
        ORDER BY ordinal_position;
        """
        df = pd.read_sql_query(q, con, params=(table,))
    else:
        df = pd.read_sql_query(f"PRAGMA table_info({table});", con)
    con.close()
    return df


@st.cache_data(show_spinner=False)
def read_table_generic(table: str, limit: int = 1000, order_by: str | None = None, order_dir: str = "DESC"):
    con = connect()
    q = f"SELECT * FROM {table}"
    if order_by:
        q += f" ORDER BY {order_by} {order_dir}"
    q += f" LIMIT {int(limit)}"
    df = pd.read_sql_query(q, con)
    con.close()
    return df


@st.cache_data(show_spinner=False)
def read_table(limit=1000, filters=None, order_by=None, order_dir="DESC"):
    con = connect()
    q = "SELECT * FROM cars"
    clauses = []
    params = []
    if filters:
        ph = "%s" if IS_PG else "?"
        for col, value in filters.items():
            if value:
                clauses.append(f"{col} LIKE {ph}")
                params.append(f"%{value}%")
    if clauses:
        q += " WHERE " + " AND ".join(clauses)
    if order_by:
        q += f" ORDER BY {order_by} {order_dir}"
    q += f" LIMIT {int(limit)}"
    df = pd.read_sql_query(q, con, params=params if params else None)
    con.close()
    return df


@st.cache_data(show_spinner=False)
def read_schema():
    con = connect()
    if IS_PG:
        df = pd.read_sql_query("""
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema='public' AND table_name='cars'
            ORDER BY ordinal_position;
        """, con)
    else:
        df = pd.read_sql_query("PRAGMA table_info(cars);", con)
    con.close()
    return df


def apply_categorical_filters(df: pd.DataFrame, key_prefix: str = "catf_") -> pd.DataFrame:
    """
    Renders multiselect dropdowns for all categorical columns and
    returns the dataframe filtered by the selected values.

    Categorical = object, category, or bool dtypes.
    """
    if df is None or df.empty:
        return df

    # Detect categorical columns (object/category/bool).
    cat_cols = list(df.select_dtypes(include=["object", "category", "bool"]).columns)

    if not cat_cols:
        return df  # nothing to filter

    st.markdown("#### Filters (categorical)")
    fdf = df.copy()

    # Use a compact two-column layout to avoid vertical bloat (optional)
    cols = st.columns(2) if len(cat_cols) > 1 else [st]

    for i, col in enumerate(cat_cols):
        options = sorted([v for v in fdf[col].dropna().unique()])
        # Default to all values selected
        default_vals = options
        # Put widgets in alternating columns for compactness
        with cols[i % len(cols)]:
            selected = st.multiselect(
                label=f"{col}",
                options=options,
                default=default_vals,
                key=f"{key_prefix}{col}",
                help="Filter the plot data by this category"
            )
        if selected and len(selected) < len(options):
            fdf = fdf[fdf[col].isin(selected)]

    return fdf

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
    st.subheader("Explore tables")
    ensure_db()

    # --- Table picker
    tables = list_tables()
    if not tables:
        st.info("No tables yet. Run a scrape first.")
    else:
        selected = st.selectbox("Table", options=tables, index=max(0, tables.index("cars")) if "cars" in tables else 0)
        st.caption(f"Showing: `{selected}`")

        # Clear caches when table changes (so schema/rows update)
        if "explore_last_table" not in st.session_state:
            st.session_state.explore_last_table = selected
        if st.session_state.explore_last_table != selected:
            read_table_generic.clear()
            read_schema_generic.clear()
            st.session_state.explore_last_table = selected

        # --- Schema
        with st.expander("Table schema"):
            schema_df = read_schema_generic(selected)
            st.dataframe(schema_df, use_container_width=True)

        # --- Toolbar
        toolbar_col1, toolbar_col2 = st.columns([1, 2])
        with toolbar_col1:
            if st.button("🔄 Refresh", help="Clear cache and reload this table"):
                read_table_generic.clear()
                read_schema_generic.clear()
                st.toast("Reloaded")
                st.rerun()
        with toolbar_col2:
            if selected == "cars":
                # only relevant for cars
                if st.button("🧭 Backfill region mapping", help="Map existing rows to districts"):
                    ensure_db()
                    from db import backfill_cars_region_ids  # lazy import to avoid circulars
                    n = backfill_cars_region_ids()
                    read_table_generic.clear()
                    st.success(f"Backfilled region_id for {n} rows")
                    st.rerun()

        # --- Load rows
        limit = st.slider("Max rows", 100, 5000, 1000, 100, key=f"lim_{selected}")
        # Load once (unfiltered), then filter in pandas (generic)
        df = read_table_generic(selected, limit=limit)

        # --- Generic filters (same pattern you already use in Analysis)
        # Categorical multiselects
        cat_filters = {}
        cat_cols = list(df.select_dtypes(include=["object", "category", "bool"]).columns)
        # Hide very long text fields from the filter UI
        hide_cats = {"url", "title"}
        cat_cols = [c for c in cat_cols if c not in hide_cats]

        if cat_cols:
            with st.expander("Filters (categorical)"):
                ccols = st.columns(2)
                for i, col in enumerate(sorted(cat_cols)):
                    opts = sorted([v for v in df[col].dropna().unique().tolist() if str(v).strip()])
                    selected_opts = ccols[i % 2].multiselect(
                        label=col,
                        options=opts,
                        default=opts,
                        key=f"cat_{selected}_{col}",
                    )
                    if selected_opts and len(selected_opts) < len(opts):
                        cat_filters[col] = set(selected_opts)

        # Numeric sliders
        num_filters = {}
        num_cols_all = list(df.select_dtypes(include="number").columns)
        if num_cols_all:
            with st.expander("Filters (numeric)"):
                cols = st.columns(2)
                for i, col in enumerate(num_cols_all):
                    series = df[col].dropna().astype(float)
                    if series.empty:
                        continue
                    vmin, vmax = float(series.min()), float(series.max())
                    is_intlike = (series % 1 == 0).all()
                    if is_intlike:
                        sel_min, sel_max = cols[i % 2].slider(
                            f"{col}", min_value=int(vmin), max_value=int(vmax),
                            value=(int(vmin), int(vmax)), step=1, key=f"num_{selected}_{col}"
                        )
                        num_filters[col] = (float(sel_min), float(sel_max))
                    else:
                        step = (vmax - vmin) / 100.0 if vmax > vmin else 1.0
                        sel_min, sel_max = cols[i % 2].slider(
                            f"{col}", min_value=vmin, max_value=vmax,
                            value=(vmin, vmax), step=step, key=f"num_{selected}_{col}"
                        )
                        num_filters[col] = (sel_min, sel_max)

        # Apply filters client-side
        dff = df.copy()
        for col, allowed in cat_filters.items():
            if col in dff.columns:
                dff = dff[dff[col].isin(allowed)]
        for col, (lo, hi) in num_filters.items():
            if col in dff.columns:
                dff = dff[dff[col].notna()]
                dff = dff[(dff[col].astype(float) >= float(lo)) & (dff[col].astype(float) <= float(hi))]

        # Order by (pick from actual columns of this table)
        order_by = st.selectbox("Order by", options=list(dff.columns), index=min(len(dff.columns)-1, 0) if not dff.columns.empty else 0, key=f"ob_{selected}")
        order_dir = st.radio("Order direction", ["DESC", "ASC"], horizontal=True, key=f"od_{selected}")
        if order_by:
            dff = dff.sort_values(order_by, ascending=(order_dir == "ASC"), kind="mergesort")  # stable sort

        st.dataframe(dff, use_container_width=True)

    
with tab_analysis:

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

    # ---------- Categorical dropdown filters (auto) ----------
    cat_filters = {}
    cat_cols = list(df.select_dtypes(include=["object", "category", "bool"]).columns)

    # Optional: hide columns that aren't useful to filter on
    hide_cats = {"listing_id", "url", "title", "scraped_at"}
    cat_cols = [c for c in cat_cols if c not in hide_cats]

    if cat_cols:
        st.markdown("### Categorical filters")
        ccols = st.columns(2)
        for i, col in enumerate(sorted(cat_cols)):
            opts = sorted([v for v in df[col].dropna().unique().tolist() if str(v).strip()])
            # default = all values selected
            selected = ccols[i % 2].multiselect(
                label=col,
                options=opts,
                default=opts,
                help="Filter the plot data by this category"
            )
            # Only record a filter if the user narrowed it down
            if selected and len(selected) < len(opts):
                cat_filters[col] = set(selected)

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

    # Apply categorical filters
    for col, allowed in cat_filters.items():
        if col in dff.columns:
            dff = dff[dff[col].isin(allowed)]

    # Apply numeric filters
    for col, (lo, hi) in num_filters.items():
        if col in dff.columns:
            dff = dff[dff[col].notna()]
            dff = dff[(dff[col].astype(float) >= float(lo)) & (dff[col].astype(float) <= float(hi))]

    # ---------- Plot (scatter + numpy linear regression line) ----------
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
            # Prepare data
            mask = dff[x].notna() & dff[y].notna()
            xs = dff.loc[mask, x].astype(float).values
            ys = dff.loc[mask, y].astype(float).values

            if xs.size >= 2 and np.std(xs) > 0:
                # scatter limits
                x_min, x_max = float(np.min(xs)), float(np.max(xs))
                y_min, y_max = float(np.min(ys)), float(np.max(ys))

                # --- numpy linear regression ---
                m, b = np.polyfit(xs, ys, 1)       # slope, intercept
                x_line = np.linspace(x_min, x_max, 100)
                y_line = m * x_line + b

                # Residuals
                y_pred = m * xs + b
                residuals = ys - y_pred

                # Outlier controls
                col_o1, col_o2 = st.columns([1, 2])
                method = col_o1.selectbox("Outlier method", ["Z-score", "MAD (robust)"], index=1)
                if method == "Z-score":
                    thr = col_o2.slider("Z-score threshold", 1.0, 5.0, 3.0, 0.1)
                    std = float(np.std(residuals))
                    z = residuals / std if std > 0 else np.zeros_like(residuals)
                    is_outlier = np.abs(z) > thr
                else:
                    thr = col_o2.slider("MAD threshold (≈σ units)", 1.0, 7.0, 3.5, 0.1)
                    med = float(np.median(residuals))
                    mad = float(np.median(np.abs(residuals - med)))
                    mad_std = 1.4826 * mad  # ≈ std
                    score = np.abs(residuals - med) / mad_std if mad_std > 0 else np.zeros_like(residuals)
                    is_outlier = score > thr

                # Build plotting DataFrame
                plot_df = dff.loc[mask].copy()
                plot_df["residual"] = residuals
                plot_df["outlier"] = is_outlier
                

                # Scatter: clickable points (open listing), gray by default, red for outliers
                scatter = (
                    alt.Chart(plot_df)
                    .mark_circle(size=60, opacity=0.7)
                    .encode(
                        x=alt.X(x, scale=alt.Scale(domain=[x_min, x_max])),
                        y=alt.Y(y, scale=alt.Scale(domain=[y_min, y_max])),
                        color=alt.Color(
                            "outlier:N",
                            scale=alt.Scale(domain=[False, True], range=["lightgray", "crimson"]),
                            legend=alt.Legend(title="Outlier"),
                        ),
                        href=alt.Href("url:N"),  # <- make points clickable
                        tooltip=[alt.Tooltip(c) for c in plot_df.columns],
                    )
                )

                # Regression line (red)
                line_df = pd.DataFrame({x: x_line, y: y_line})
                reg_line = (
                    alt.Chart(line_df)
                    .mark_line(color="red", size=2)
                    .encode(x=x, y=y)
                )

                chart = (scatter + reg_line).interactive()

                # R² for reference
                ss_res = float(np.sum((ys - y_pred) ** 2))
                ss_tot = float(np.sum((ys - np.mean(ys)) ** 2))
                r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else float("nan")

                st.altair_chart(chart, use_container_width=True)
                st.caption(
                    f"Rows plotted: {len(xs)} · y = {m:.4f}·x + {b:.2f} · R² = {r2:.3f} · Outliers: {int(is_outlier.sum())}"
                )
                st.markdown(
                    "<span style='color: #999; font-size: 0.85em;'>Tip: Ctrl + Click a point to open the car listing in a new tab.</span>",
                     unsafe_allow_html=True
                )
            else:
                st.info("Not enough variance/rows for regression with current filters.")



