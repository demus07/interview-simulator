import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config import settings
from app.db.database import close_connections

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Log config at startup so DB host is visible in docker-compose logs
    try:
        host_part = settings.database_url.split("@")[1].split("/")[0]
    except Exception:
        host_part = "<parse error>"
    logger.info("DATABASE host: %s", host_part)
    logger.info("REDIS_URL:     %s", settings.redis_url)
    # Pools connect lazily on first request — no eager connect here
    yield
    await close_connections()


app = FastAPI(
    title="Interview Simulator API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/v1")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/debug/config")
async def debug_config() -> dict:
    """Shows which database host and redis URL the app resolved — never shows credentials."""
    try:
        db_host = settings.database_url.split("@")[1].split("/")[0]
    except Exception:
        db_host = "parse error"
    return {
        "database_host": db_host,
        "redis_url": settings.redis_url,
        "interviewer_model": settings.interviewer_model,
        "evaluator_model": settings.evaluator_model,
    }
