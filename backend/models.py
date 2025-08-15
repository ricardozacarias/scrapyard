from sqlalchemy import Column, String, Integer, Float, DateTime, Text, Boolean
from sqlalchemy.sql import func
from .db import Base

class Listing(Base):
    __tablename__ = "listings"

    id = Column(String, primary_key=True)         # sha1(site:external_id)
    site = Column(String, nullable=False)
    external_id = Column(String, nullable=False, index=True)
    url = Column(String, nullable=False)
    title = Column(String)
    description = Column(Text)

    price = Column(Integer)                       # EUR cents
    currency = Column(String, default="EUR")

    city = Column(String)
    district = Column(String, index=True)
    parish = Column(String)
    latitude = Column(Float)
    longitude = Column(Float)

    surface_m2 = Column(Float)
    bedrooms = Column(Integer)
    bathrooms = Column(Integer)
    property_type = Column(String)
    year = Column(Integer)

    car_make = Column(String)
    car_model = Column(String)
    car_year = Column(Integer)
    km = Column(Integer)
    fuel = Column(String)
    transmission = Column(String)

    created_at = Column(DateTime, server_default=func.now())
    first_seen = Column(DateTime, server_default=func.now())
    last_seen = Column(DateTime, server_default=func.now(), onupdate=func.now())
    is_active = Column(Boolean, default=True)
    raw = Column(Text)

    def to_dict(self):
        return {c.name: getattr(self, c.name) for c in self.__table__.columns}
