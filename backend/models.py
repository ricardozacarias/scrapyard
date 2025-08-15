# backend/models.py
from __future__ import annotations
from datetime import datetime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Integer, Text, Boolean, Float, DateTime, ForeignKey, UniqueConstraint
from backend.db import Base

class RawFetch(Base):
    __tablename__ = "raw_fetches"
    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String, index=True)
    url: Mapped[str] = mapped_column(String)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    status_code: Mapped[int | None] = mapped_column(Integer)
    content_type: Mapped[str | None] = mapped_column(String)
    body: Mapped[str] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)

class HouseListing(Base):
    __tablename__ = "house_listings"
    __table_args__ = (UniqueConstraint("source", "external_id", name="uq_house_source_external"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String, index=True)
    url: Mapped[str] = mapped_column(String, unique=True)
    external_id: Mapped[str | None] = mapped_column(String, index=True)
    title: Mapped[str | None] = mapped_column(String)
    price_cents: Mapped[int | None] = mapped_column(Integer)
    district: Mapped[str | None] = mapped_column(String)
    city: Mapped[str | None] = mapped_column(String)
    surface_m2: Mapped[float | None] = mapped_column()
    bedrooms: Mapped[int | None] = mapped_column(Integer)
    first_seen: Mapped[datetime | None] = mapped_column(DateTime)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    raw_id: Mapped[int | None] = mapped_column(ForeignKey("raw_fetches.id"))

class CarListing(Base):
    __tablename__ = "car_listings"
    __table_args__ = (UniqueConstraint("source", "external_id", name="uq_car_source_external"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String, index=True)
    url: Mapped[str] = mapped_column(String, unique=True)
    external_id: Mapped[str | None] = mapped_column(String, index=True)
    title: Mapped[str | None] = mapped_column(String)
    price_cents: Mapped[int | None] = mapped_column(Integer)
    district: Mapped[str | None] = mapped_column(String)
    city: Mapped[str | None] = mapped_column(String)
    make: Mapped[str | None] = mapped_column(String)
    model: Mapped[str | None] = mapped_column(String)
    year: Mapped[int | None] = mapped_column(Integer)
    km: Mapped[int | None] = mapped_column(Integer)
    fuel: Mapped[str | None] = mapped_column(String)
    transmission: Mapped[str | None] = mapped_column(String)
    first_seen: Mapped[datetime | None] = mapped_column(DateTime)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    raw_id: Mapped[int | None] = mapped_column(ForeignKey("raw_fetches.id"))


class Listing(Base):
    __tablename__ = "listings"
    # primary key is a SHA1 string (stable_id) used by the scraper
    id: Mapped[str] = mapped_column(String(40), primary_key=True)

    # common fields the scraper returns
    site: Mapped[str | None] = mapped_column(String, index=True)
    external_id: Mapped[str | None] = mapped_column(String, index=True)
    url: Mapped[str | None] = mapped_column(String, unique=True)
    title: Mapped[str | None] = mapped_column(String)
    description: Mapped[str | None] = mapped_column(Text)

    price: Mapped[int | None] = mapped_column(Integer)          # cents
    currency: Mapped[str | None] = mapped_column(String(3))

    city: Mapped[str | None] = mapped_column(String)
    district: Mapped[str | None] = mapped_column(String)
    parish: Mapped[str | None] = mapped_column(String)
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)

    # property-only (nullable)
    surface_m2: Mapped[float | None] = mapped_column(Float)
    bedrooms: Mapped[int | None] = mapped_column(Integer)
    bathrooms: Mapped[int | None] = mapped_column(Integer)
    property_type: Mapped[str | None] = mapped_column(String)
    year: Mapped[int | None] = mapped_column(Integer)

    # car-only (nullable)
    car_make: Mapped[str | None] = mapped_column(String)
    car_model: Mapped[str | None] = mapped_column(String)
    car_year: Mapped[int | None] = mapped_column(Integer)
    km: Mapped[int | None] = mapped_column(Integer)
    fuel: Mapped[str | None] = mapped_column(String)
    transmission: Mapped[str | None] = mapped_column(String)

    # timestamps + flags
    created_at: Mapped["datetime | None"] = mapped_column(DateTime)
    first_seen: Mapped["datetime | None"] = mapped_column(DateTime, index=True)
    last_seen: Mapped["datetime | None"] = mapped_column(DateTime, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # raw payload snapshot (legacy)
    raw: Mapped[str | None] = mapped_column(Text)