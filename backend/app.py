from fastapi import FastAPI, Depends, Query
from typing import Optional
from sqlalchemy.orm import Session
from .db import Base, engine, get_session
from .models import Listing

app = FastAPI(title="My Scraping App (Local)")

@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/listings")
def list_listings(
    kind: Optional[str] = Query(None, description="property or car"),
    district: Optional[str] = None,
    limit: int = 100,
    db: Session = Depends(get_session),
):
    q = db.query(Listing)
    if kind == "property":
        q = q.filter(Listing.property_type.isnot(None))
    elif kind == "car":
        q = q.filter(Listing.car_make.isnot(None))
    if district:
        q = q.filter(Listing.district == district)
    q = q.order_by(Listing.first_seen.desc()).limit(limit)
    rows = q.all()
    return [r.to_dict() for r in rows]
