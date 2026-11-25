"""WebSocket connection manager for real-time parking slot, notification, and admin activity updates."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger("smartpark.websocket")


class ConnectionManager:
    """Tracks active WebSocket clients by role/user/location and broadcasts events safely."""

    def __init__(self) -> None:
        # client_id -> {"ws": WebSocket, "role": str, "user_id": str | None, "location_id": str | None}
        self._connections: dict[int, dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    @property
    def active_count(self) -> int:
        return len(self._connections)

    async def connect(
        self,
        websocket: WebSocket,
        role: str = "guest",
        user_id: str | None = None,
        location_id: str | None = None,
    ) -> int:
        await websocket.accept()
        conn_id = id(websocket)
        async with self._lock:
            self._connections[conn_id] = {
                "ws": websocket,
                "role": role,
                "user_id": user_id,
                "location_id": location_id,
                "connected_at": datetime.now(timezone.utc).isoformat(),
            }
        logger.info("WS connected: id=%s role=%s user=%s total=%s", conn_id, role, user_id, len(self._connections))
        await self.send_personal(
            websocket,
            {
                "event": "connected",
                "data": {
                    "message": "Connected to SmartPark RTD real-time stream",
                    "role": role,
                    "active_connections": len(self._connections),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            },
        )
        return conn_id

    async def disconnect(self, websocket: WebSocket) -> None:
        conn_id = id(websocket)
        async with self._lock:
            self._connections.pop(conn_id, None)
        logger.info("WS disconnected: id=%s total=%s", conn_id, len(self._connections))

    async def update_subscription(self, websocket: WebSocket, location_id: str | None = None) -> None:
        conn_id = id(websocket)
        async with self._lock:
            if conn_id in self._connections:
                self._connections[conn_id]["location_id"] = location_id

    async def send_personal(self, websocket: WebSocket, payload: dict[str, Any]) -> None:
        try:
            await websocket.send_json(payload)
        except Exception:
            await self.disconnect(websocket)

    async def broadcast_all(self, event: str, data: dict[str, Any]) -> None:
        """Broadcast an event to every connected client."""
        message = {
            "event": event,
            "data": data,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        async with self._lock:
            targets = list(self._connections.items())

        stale: list[int] = []
        for conn_id, info in targets:
            try:
                await info["ws"].send_json(message)
            except Exception:
                stale.append(conn_id)

        if stale:
            async with self._lock:
                for conn_id in stale:
                    self._connections.pop(conn_id, None)

    async def broadcast_slot_update(self, slot_data: dict[str, Any], summary: dict[str, Any] | None = None) -> None:
        """Broadcast live slot status change to all dashboards and location subscribers."""
        await self.broadcast_all(
            "slot_updated",
            {
                "slot": slot_data,
                "location_summary": summary,
            },
        )

    async def broadcast_location_update(self, location_data: dict[str, Any], action: str = "updated") -> None:
        """Broadcast parking location additions/updates/deletions."""
        await self.broadcast_all(
            "location_updated",
            {
                "action": action,
                "location": location_data,
            },
        )

    async def broadcast_admin_activity(self, activity: dict[str, Any]) -> None:
        """Send live sensor/booking/gate activity to admin clients."""
        message = {
            "event": "admin_activity",
            "data": activity,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        async with self._lock:
            targets = [
                (cid, info["ws"])
                for cid, info in self._connections.items()
                if info.get("role") in ("admin", "superadmin")
            ]

        stale: list[int] = []
        for cid, ws in targets:
            try:
                await ws.send_json(message)
            except Exception:
                stale.append(cid)

        if stale:
            async with self._lock:
                for cid in stale:
                    self._connections.pop(cid, None)

    async def send_notification(self, notification: dict[str, Any], user_id: str | None = None) -> None:
        """Send notification to a specific user (or broadcast if user_id is None)."""
        message = {
            "event": "notification",
            "data": notification,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        async with self._lock:
            if user_id is None:
                targets = [(cid, info["ws"]) for cid, info in self._connections.items()]
            else:
                targets = [
                    (cid, info["ws"])
                    for cid, info in self._connections.items()
                    if info.get("user_id") == user_id or info.get("role") in ("admin", "superadmin")
                ]

        stale: list[int] = []
        for cid, ws in targets:
            try:
                await ws.send_json(message)
            except Exception:
                stale.append(cid)

        if stale:
            async with self._lock:
                for cid in stale:
                    self._connections.pop(cid, None)


ws_manager = ConnectionManager()

