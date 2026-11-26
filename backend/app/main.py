import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db import Base, SessionLocal, engine
from app.routers import assistant, tasks
from app.seed import seed

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # create_all is enough for a take-home; a real deployment would use Alembic migrations.
    Base.metadata.create_all(engine)
    if get_settings().seed_demo_data:
        with SessionLocal() as db:
            if seed(db):
                logging.info("Seeded demo family")
    yield


app = FastAPI(title="CareCircle Lite", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_settings().cors_origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(tasks.router)
app.include_router(assistant.router)


@app.get("/api/health")
def health():
    return {"ok": True}
