from __future__ import annotations

import logging

import asyncpg
import redis.asyncio as aioredis

from app.config import settings

logger = logging.getLogger(__name__)

_pg_pool: asyncpg.Pool | None = None
_redis_client: aioredis.Redis | None = None


async def get_pg_pool() -> asyncpg.Pool:
    global _pg_pool
    if _pg_pool is None:
        # Log the host portion only (never log credentials)
        try:
            host_part = settings.database_url.split("@")[1].split("/")[0]
        except Exception:
            host_part = "<parse error>"
        logger.info("Connecting to PostgreSQL at %s", host_part)
        _pg_pool = await asyncpg.create_pool(
            dsn=settings.database_url,
            min_size=2,
            max_size=10,
            # Disable SSL — local Docker PostgreSQL is plaintext
            ssl=False,
        )
    return _pg_pool


async def get_redis() -> aioredis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
    return _redis_client


async def close_connections() -> None:
    global _pg_pool, _redis_client
    if _pg_pool:
        await _pg_pool.close()
        _pg_pool = None
    if _redis_client:
        await _redis_client.aclose()
        _redis_client = None
