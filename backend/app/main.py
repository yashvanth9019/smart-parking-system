"""SmartPark RTD FastAPI application entrypoint with WebSocket server and lifecycle hooks."""

from __future__ import annotations

import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.app.config import get_settings  # noqa: E402
from backend.app.routes import analytics, auth, bookings, iot, locations, notifications  # noqa: E402
from backend.app.security import decode_access_token  # noqa: E402
from backend.app.services.parking_service import expiry_monitor_loop  # noqa: E402
from database.mongodb import close_mongo_connection, connect_to_mongo  # noqa: E402
from database.seed import seed_database  # noqa: E402
from machine_learning.predictor import ensure_models_loaded  # noqa: E402
from websocket.manager import ws_manager  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("smartpark.main")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db = await connect_to_mongo()
    seed_res = await seed_database(db, force=False)
    logger.info("Initial seed check: %s", seed_res)
    ensure_models_loaded()
    expiry_task = asyncio.create_task(expiry_monitor_loop())
    try:
        yield
    finally:
        expiry_task.cancel()
        try:
            await expiry_task
        except asyncio.CancelledError:
            pass
        await close_mongo_connection()


settings = get_settings()

app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    description="Real-Time Smart Parking Management System with FastAPI, MongoDB, WebSockets, IoT Simulation, and ML Predictions.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list or ["*"],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(locations.router)
app.include_router(bookings.router)
app.include_router(iot.router)
app.include_router(analytics.router)
app.include_router(notifications.router)


@app.get("/health", tags=["System"])
async def health_check() -> dict[str, Any]:
    return {
        "status": "healthy",
        "app": settings.APP_NAME,
        "ws_connections": ws_manager.active_count,
    }


@app.websocket("/ws/parking")
async def parking_websocket(
    websocket: WebSocket,
    token: str | None = Query(default=None),
    location_id: str | None = Query(default=None),
) -> None:
    """Real-time WebSocket stream for slot status updates, notifications, and admin activity."""
    role = "guest"
    user_id = None
    if token:
        try:
            payload = decode_access_token(token)
            role = payload.get("role", "user")
            user_id = payload.get("sub")
        except Exception:
            role = "guest"
            user_id = None

    await ws_manager.connect(websocket, role=role, user_id=user_id, location_id=location_id)
    try:
        while True:
            msg = await websocket.receive_json()
            if isinstance(msg, dict):
                action = msg.get("action")
                if action == "ping":
                    await ws_manager.send_personal(websocket, {"event": "pong"})
                elif action == "subscribe":
                    await ws_manager.update_subscription(websocket, location_id=msg.get("location_id"))
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)
    except Exception:
        await ws_manager.disconnect(websocket)

