# scripts/init_new_schema.py
import os
import sys

# --- Ensure project root is on sys.path ---
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from backend.db import Base, engine
import backend.models  # registers models on Base

Base.metadata.create_all(bind=engine)
print("Created: raw_fetches, house_listings, car_listings")
