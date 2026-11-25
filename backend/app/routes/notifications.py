"""Real-time notification retrieval and read-state endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query

from backend.app.security import get_current_user
from database.mongodb import get_database
from database.schemas import serialize_list, to_object_id

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])


@router.get("")
async def list_notifications(
    limit: int = Query(default=30, ge=1, le=100),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    db = get_database()
    is_admin = current_user.get("role") in ("admin", "superadmin")
    if is_admin:
        query: dict[str, Any] = {}
    else:
        user_oid = to_object_id(current_user["id"])
        query = {"$or": [{"user_id": user_oid}, {"user_id": None}]}

    docs = await db.notifications.find(query).sort("created_at", -1).to_list(length=limit)
    unread_count = await db.notifications.count_documents({**query, "is_read": False})
    return {"notifications": serialize_list(docs), "unread_count": unread_count}


@router.post("/{notification_id}/read")
async def mark_notification_read(
    notification_id: str,
    _current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, str]:
    db = get_database()
    await db.notifications.update_one({"_id": to_object_id(notification_id)}, {"$set": {"is_read": True}})
    return {"status": "ok"}


@router.post("/read-all")
async def mark_all_notifications_read(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, str]:
    db = get_database()
    is_admin = current_user.get("role") in ("admin", "superadmin")
    query: dict[str, Any] = {} if is_admin else {"$or": [{"user_id": to_object_id(current_user["id"])}, {"user_id": None}]}
    await db.notifications.update_many(query, {"$set": {"is_read": True}})
    return {"status": "ok"}

