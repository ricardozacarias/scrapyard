from .db import Base, engine, SessionLocal
from .models import Listing
from datetime import datetime
import hashlib, json

def stable_id(site: str, external_id: str) -> str:
    return hashlib.sha1(f"{site}:{external_id}".encode()).hexdigest()

def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        demo = [
            dict(
                id=stable_id("idealista", "demo-apartment-001"),
                site="idealista",
                external_id="demo-apartment-001",
                url="https://example.com/property/1",
                title="T2 Apartment with Balcony - Lisboa",
                description="Bright T2 near metro, elevator, parking.",
                price=32500000,   # 325,000 EUR (cents)
                city="Lisboa",
                district="Lisboa",
                parish="Arroios",
                surface_m2=78.0,
                bedrooms=2,
                bathrooms=1,
                property_type="apartment",
                first_seen=datetime.utcnow(),
                last_seen=datetime.utcnow(),
                raw=json.dumps({"photos": 12}),
            ),
            dict(
                id=stable_id("standvirtual", "demo-car-001"),
                site="standvirtual",
                external_id="demo-car-001",
                url="https://example.com/car/1",
                title="Volkswagen Golf 1.6 TDI",
                description="2017, 98k km, full service history.",
                price=1495000,    # 14,950 EUR (cents)
                city="Lisboa",
                district="Lisboa",
                car_make="Volkswagen",
                car_model="Golf",
                car_year=2017,
                km=98000,
                fuel="Diesel",
                transmission="Manual",
                first_seen=datetime.utcnow(),
                last_seen=datetime.utcnow(),
                raw=json.dumps({"owners": 1}),
            ),
        ]
        for d in demo:
            if not db.get(Listing, d["id"]):
                db.add(Listing(**d))
        db.commit()
        print("Seeded demo listings ✔")
    finally:
        db.close()

if __name__ == "__main__":
    main()
