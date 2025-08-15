from __future__ import annotations
from datetime import datetime
from sqlalchemy.orm import Session
from backend.models import RawFetch  # from the models you created earlier

def insert_raw_fetch(
    db: Session,
    *,
    source: str,
    url: str,
    body: str,
    status_code: int | None = None,
    content_type: str | None = "text/html",
    error: str | None = None,
) -> int:
    row = RawFetch(
        source=source,
        url=url,
        fetched_at=datetime.utcnow(),
        status_code=status_code,
        content_type=content_type,
        body=body,
        error=error,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row.id
