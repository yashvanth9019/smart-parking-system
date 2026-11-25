"""Core parking business logic: dynamic pricing, smart slot allocation, double-booking guard, notifications, and expiry monitor."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from backend.app.config import get_settings
from database.mongodb import get_database
from database.schemas import serialize_doc, serialize_list, to_object_id
from websocket.manager import ws_manager

logger = logging.getLogger("smartpark.service")

OCCUPANCY_THRESHOLD_CM = 100.0  # Ultrasonic < 100cm indicates a parked vehicle


def ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


async def get_location_summary(db: AsyncIOMotorDatabase, location_id: ObjectId) -> dict[str, Any]:
    """Compute real-time slot counts and occupancy ratio for a location."""
    pipeline = [
        {"$match": {"location_id": location_id}},
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
    ]
    counts = {"available": 0, "occupied": 0, "reserved": 0, "maintenance": 0}
    async for row in db.parking_slots.aggregate(pipeline):
        status_key = row["_id"]
        if status_key in counts:
            counts[status_key] = int(row["count"])

    total = sum(counts.values())
    busy = counts["occupied"] + counts["reserved"]
    occupancy_pct = round((busy / total) * 100.0, 1) if total > 0 else 0.0
    return {
        "location_id": str(location_id),
        "total_slots": total,
        "available": counts["available"],
        "occupied": counts["occupied"],
        "reserved": counts["reserved"],
        "maintenance": counts["maintenance"],
        "occupancy_pct": occupancy_pct,
    }


async def enrich_locations(db: AsyncIOMotorDatabase, locations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Attach live slot counts and current dynamic rate to serialized locations."""
    enriched: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc)
    for loc_doc in locations:
        loc_oid = loc_doc["_id"]
        summary = await get_location_summary(db, loc_oid)
        pricing = compute_dynamic_pricing(
            base_rate=float(loc_doc["base_hourly_rate"]),
            dynamic_enabled=bool(loc_doc.get("dynamic_pricing_enabled", True)),
            occupancy_pct=summary["occupancy_pct"],
            start_time=now,
            duration_hours=1.0,
        )
        serialized = serialize_doc(loc_doc)
        assert serialized is not None
        serialized.update(
            {
                "total_slots": summary["total_slots"],
                "available_slots": summary["available"],
                "occupied_slots": summary["occupied"],
                "reserved_slots": summary["reserved"],
                "maintenance_slots": summary["maintenance"],
                "occupancy_pct": summary["occupancy_pct"],
                "current_hourly_rate": pricing["effective_hourly_rate"],
                "current_multiplier": pricing["multiplier"],
                "pricing_tier": pricing["tier"],
            }
        )
        enriched.append(serialized)
    return enriched


def compute_dynamic_pricing(
    base_rate: float,
    dynamic_enabled: bool,
    occupancy_pct: float,
    start_time: datetime,
    duration_hours: float,
) -> dict[str, Any]:
    """Calculate dynamic parking pricing based on peak hours + real-time lot occupancy."""
    st = ensure_utc(start_time)
    hour = st.hour
    multiplier = 1.0
    reasons: list[str] = []

    if dynamic_enabled:
        if occupancy_pct >= 80.0:
            multiplier += 0.35
            reasons.append("High lot occupancy (>80%)")
        elif occupancy_pct >= 60.0:
            multiplier += 0.20
            reasons.append("Moderate-high demand (>60%)")
        elif occupancy_pct <= 25.0:
            multiplier -= 0.10
            reasons.append("Off-peak availability discount")

        if hour in (8, 9, 10, 17, 18, 19, 20):
            multiplier += 0.15
            reasons.append("Peak traffic window")
        elif hour >= 23 or hour <= 5:
            multiplier -= 0.10
            reasons.append("Night-owl rate")

    multiplier = round(max(0.75, min(multiplier, 1.75)), 2)
    effective_hourly = round(base_rate * multiplier, 2)
    extra_time_hourly_rate = round(effective_hourly * 1.5, 2)
    grace_period_minutes = 10
    base_amount = round(base_rate * duration_hours, 2)
    total_amount = round(base_amount * multiplier, 2)
    tier = "Surge" if multiplier >= 1.3 else ("Peak" if multiplier > 1.05 else ("Discount" if multiplier < 1.0 else "Standard"))

    return {
        "base_hourly_rate": round(base_rate, 2),
        "effective_hourly_rate": effective_hourly,
        "duration_hours": round(duration_hours, 2),
        "base_amount": base_amount,
        "multiplier": multiplier,
        "total_amount": total_amount,
        "tier": tier,
        "reasons": reasons or ["Standard base tariff"],
        "grace_period_minutes": grace_period_minutes,
        "extra_time_hourly_rate": extra_time_hourly_rate,
        "extra_time_policy": f"{grace_period_minutes}-min grace period; overtime billed at INR {extra_time_hourly_rate}/hr (1.5x)",
    }


async def check_slot_overlap(
    db: AsyncIOMotorDatabase,
    slot_id: ObjectId,
    start_time: datetime,
    end_time: datetime,
) -> bool:
    """Return True if the slot already has an overlapping confirmed/active booking."""
    st = ensure_utc(start_time)
    et = ensure_utc(end_time)
    conflict = await db.bookings.find_one(
        {
            "slot_id": slot_id,
            "status": {"$in": ["confirmed", "active"]},
            "start_time": {"$lt": et},
            "end_time": {"$gt": st},
        }
    )
    return conflict is not None


async def smart_allocate_slot(
    db: AsyncIOMotorDatabase,
    location_id: ObjectId,
    start_time: datetime,
    end_time: datetime,
    preferred_type: str | None = None,
    vehicle_type: str = "car",
) -> dict[str, Any] | None:
    """Select the optimal available slot using floor proximity, vehicle match, and zero booking overlap."""
    slots = await db.parking_slots.find(
        {"location_id": location_id, "status": {"$ne": "maintenance"}}
    ).to_list(length=500)

    if not slots:
        return None

    now = datetime.now(timezone.utc)
    immediate_window = ensure_utc(start_time) <= now + timedelta(minutes=30)

    desired_type = preferred_type or ("ev" if vehicle_type == "ev" else "standard")
    floor_rank = {"G": 0, "L1": 1, "B1": 2, "B2": 3}

    candidates: list[tuple[int, dict[str, Any]]] = []
    for slot in slots:
        # If booking starts right away, avoid slots currently physically occupied
        if immediate_window and slot.get("status") != "available":
            continue
        has_conflict = await check_slot_overlap(db, slot["_id"], start_time, end_time)
        if has_conflict:
            continue

        score = 0
        if slot.get("slot_type") == desired_type:
            score -= 20
        elif slot.get("slot_type") == "standard":
            score -= 5
        score += floor_rank.get(slot.get("floor", "G"), 5) * 3
        if slot.get("status") == "available":
            score -= 10
        candidates.append((score, slot))

    if not candidates:
        return None

    candidates.sort(key=lambda item: (item[0], item[1].get("slot_code", "")))
    return candidates[0][1]


async def create_and_broadcast_notification(
    db: AsyncIOMotorDatabase,
    notif_type: str,
    title: str,
    message: str,
    user_id: ObjectId | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Persist a notification in MongoDB and push it immediately via WebSocket."""
    doc = {
        "user_id": user_id,
        "type": notif_type,
        "title": title,
        "message": message,
        "is_read": False,
        "metadata": metadata or {},
        "created_at": datetime.now(timezone.utc),
    }
    res = await db.notifications.insert_one(doc)
    doc["_id"] = res.inserted_id
    serialized = serialize_doc(doc)
    assert serialized is not None
    await ws_manager.send_notification(serialized, user_id=str(user_id) if user_id else None)
    return serialized


async def process_sensor_event(
    db: AsyncIOMotorDatabase,
    distance_cm: float,
    sensor_id: str | None = None,
    slot_id: str | None = None,
    vehicle_detected: bool | None = None,
    source: str = "iot_esp32",
) -> dict[str, Any]:
    """Process an incoming ultrasonic sensor reading, update MongoDB, log it, and broadcast via WebSocket."""
    query: dict[str, Any] = {}
    if slot_id:
        query["_id"] = to_object_id(slot_id)
    elif sensor_id:
        query["sensor_id"] = sensor_id

    slot = await db.parking_slots.find_one(query)
    if not slot:
        raise ValueError("Parking slot not found for the given sensor/slot identifier.")

    detected = vehicle_detected if vehicle_detected is not None else (distance_cm < OCCUPANCY_THRESHOLD_CM)
    prev_status = slot.get("status", "available")
    now = datetime.now(timezone.utc)

    # Respect maintenance unless manually overridden; if reserved and vehicle arrives, keep/transition to occupied
    if prev_status == "maintenance" and source != "manual":
        new_status = "maintenance"
    else:
        new_status = "occupied" if detected else "available"

    update_fields: dict[str, Any] = {
        "status": new_status,
        "last_sensor_distance_cm": round(distance_cm, 2),
        "last_updated": now,
    }
    if new_status == "available":
        update_fields["current_booking_id"] = None

    await db.parking_slots.update_one({"_id": slot["_id"]}, {"$set": update_fields})
    updated_slot = await db.parking_slots.find_one({"_id": slot["_id"]})
    assert updated_slot is not None

    log_doc = {
        "sensor_id": updated_slot.get("sensor_id") or f"SENSOR-{updated_slot['slot_code']}",
        "location_id": updated_slot["location_id"],
        "slot_id": updated_slot["_id"],
        "distance_cm": round(distance_cm, 2),
        "vehicle_detected": detected,
        "previous_status": prev_status,
        "new_status": new_status,
        "source": source,
        "recorded_at": now,
    }
    await db.sensor_logs.insert_one(log_doc)

    loc = await db.parking_locations.find_one({"_id": updated_slot["location_id"]})
    summary = await get_location_summary(db, updated_slot["location_id"])
    serialized_slot = serialize_doc(updated_slot)
    assert serialized_slot is not None
    serialized_slot["location_name"] = loc["name"] if loc else "Unknown Location"

    await ws_manager.broadcast_slot_update(serialized_slot, summary=summary)
    await ws_manager.broadcast_admin_activity(
        {
            "type": "sensor_event",
            "slot_code": updated_slot["slot_code"],
            "location_name": loc["name"] if loc else "Unknown",
            "previous_status": prev_status,
            "new_status": new_status,
            "distance_cm": round(distance_cm, 2),
            "source": source,
            "recorded_at": now.isoformat(),
        }
    )

    # Notify users when a slot frees up
    if prev_status in ("occupied", "reserved") and new_status == "available":
        await create_and_broadcast_notification(
            db,
            notif_type="slot_available",
            title="Parking Slot Freed",
            message=f"Slot {updated_slot['slot_code']} at {loc['name'] if loc else 'Parking Hub'} is now available.",
            user_id=None,
            metadata={"location_id": str(updated_slot["location_id"]), "slot_code": updated_slot["slot_code"]},
        )

    return {
        "slot": serialized_slot,
        "location_summary": summary,
        "previous_status": prev_status,
        "new_status": new_status,
    }


async def expiry_monitor_loop() -> None:
    """Background task checking active/confirmed bookings for near-expiry alerts and auto-expiration."""
    settings = get_settings()
    interval = max(10, settings.EXPIRY_CHECK_INTERVAL_SECONDS)
    warn_minutes = settings.EXPIRY_WARNING_MINUTES

    while True:
        try:
            await asyncio.sleep(interval)
            db = get_database()
            now = datetime.now(timezone.utc)
            warn_cutoff = now + timedelta(minutes=warn_minutes)

            # 1. Send warning notification for active bookings ending within warn_minutes
            nearing = await db.bookings.find(
                {
                    "status": "active",
                    "expiry_alert_sent": {"$ne": True},
                    "end_time": {"$gt": now, "$lte": warn_cutoff},
                }
            ).to_list(length=50)

            for booking in nearing:
                mins_left = max(1, int((ensure_utc(booking["end_time"]) - now).total_seconds() // 60))
                await db.bookings.update_one({"_id": booking["_id"]}, {"$set": {"expiry_alert_sent": True}})
                await create_and_broadcast_notification(
                    db,
                    notif_type="expiry_alert",
                    title="Parking Time Expiring Soon",
                    message=f"Booking {booking['booking_code']} expires in ~{mins_left} min. Please exit or extend.",
                    user_id=booking["user_id"],
                    metadata={"booking_code": booking["booking_code"], "minutes_left": mins_left},
                )

            # 2. Mark overdue un-entered confirmed reservations as expired (>30 min past end_time)
            overdue_confirmed = await db.bookings.find(
                {
                    "status": "confirmed",
                    "end_time": {"$lt": now - timedelta(minutes=10)},
                }
            ).to_list(length=50)

            for booking in overdue_confirmed:
                await db.bookings.update_one(
                    {"_id": booking["_id"]},
                    {"$set": {"status": "expired", "updated_at": now}},
                )
                slot = await db.parking_slots.find_one({"_id": booking["slot_id"]})
                if slot and slot.get("status") == "reserved":
                    await db.parking_slots.update_one(
                        {"_id": slot["_id"]},
                        {"$set": {"status": "available", "current_booking_id": None, "last_updated": now}},
                    )
                    updated_slot = await db.parking_slots.find_one({"_id": slot["_id"]})
                    summary = await get_location_summary(db, slot["location_id"])
                    if updated_slot:
                        await ws_manager.broadcast_slot_update(serialize_doc(updated_slot) or {}, summary=summary)

        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning("Expiry monitor error: %s", exc)

