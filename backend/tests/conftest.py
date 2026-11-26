"""API tests run against a real Postgres (the concurrency guarantee is a Postgres
guarantee, so mocking it would prove nothing). Pure-logic tests need no database.

TEST_DATABASE_URL defaults to a `carecircle_test` database next to the dev one;
it is created if missing and its tables are reset for every test.
"""

import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://carecircle:carecircle@localhost:5432/carecircle_test",
)
# Must be set before app.db creates its engine.
os.environ["DATABASE_URL"] = TEST_DB_URL
os.environ["SEED_DEMO_DATA"] = "false"
os.environ["ASSISTANT_PROVIDER"] = "template"


def _ensure_database() -> bool:
    url = make_url(TEST_DB_URL)
    try:
        admin = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
        with admin.connect() as conn:
            exists = conn.scalar(text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": url.database})
            if not exists:
                conn.execute(text(f'CREATE DATABASE "{url.database}"'))
        admin.dispose()
        return True
    except Exception:
        return False


DB_AVAILABLE = _ensure_database()


@pytest.fixture
def client():
    if not DB_AVAILABLE:
        pytest.skip(f"Postgres not reachable at {TEST_DB_URL}")

    from fastapi.testclient import TestClient

    from app.db import Base, SessionLocal, engine
    from app.main import app
    from app.models import CareRecipient, FamilyMember

    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        mum = CareRecipient(name="Kamala", display_name="Mum", timezone="Asia/Kolkata")
        db.add(mum)
        db.flush()
        db.add_all([
            FamilyMember(recipient_id=mum.id, name="Ravi"),
            FamilyMember(recipient_id=mum.id, name="Priya"),
        ])
        db.commit()

    with TestClient(app) as c:
        yield c
