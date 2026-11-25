"""Parking locations and slots CRUD + live availability endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.app.models import (
    LocationCreateRequest,
    LocationUpdateRequest,
    SlotCreateRequest,
    SlotUpdateRequest,
)
from backend.app.security import get_current_admin
from backend.app.services.parking_service import enrich_locations, get_location_summary
from database.mongodb import get_database
from database.schemas import serialize_doc, serialize_list, to_object_id
from websocket.manager import ws_manager

router = APIRouter(prefix="/api", tags=["Parking Locations & Slots"])


@router.get("/locations")
async def list_locations(
    search: str | None = Query(default=None),
    city: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    max_rate: float | None = Query(default=None),
) -> dict[str, Any]:
    db = get_database()
    query: dict[str, Any] = {}
    if city:
        query["city"] = {"$regex": city.strip(), "$options": "i"}
    if status_filter:
        query["status"] = status_filter
    if max_rate is not None:
        query["base_hourly_rate"] = {"$lte": max_rate}
    if search:
        pattern = {"$regex": search.strip(), "$options": "i"}
        query["$or"] = [{"name": pattern}, {"address": pattern}, {"city": pattern}]

    docs = await db.parking_locations.find(query).sort("created_at", 1).to_list(length=100)
    enriched = await enrich_locations(db, docs)

    totals = {
        "total_locations": len(enriched),
        "total_slots": sum(l["total_slots"] for l in enriched),
        "available_slots": sum(l["available_slots"] for l in enriched),
        "occupied_slots": sum(l["occupied_slots"] for l in enriched),
        "reserved_slots": sum(l["reserved_slots"] for l in enriched),
    }
    return {"locations": enriched, "summary": totals}


@router.get("/locations/{location_id}")
async def get_location_detail(location_id: str) -> dict[str, Any]:
    db = get_database()
    try:
        loc_oid = to_object_id(location_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid location ID.") from exc

    loc = await db.parking_locations.find_one({"_id": loc_oid})
    if not loc:
        raise HTTPException(status_code=404, detail="Parking location not found.")

    enriched = await enrich_locations(db, [loc])
    slots = await db.parking_slots.find({"location_id": loc_oid}).sort("slot_code", 1).to_list(length=500)
    return {"location": enriched[0], "slots": serialize_list(slots)}


@router.get("/locations/{location_id}/slots")
async def list_location_slots(
    location_id: str,
    status_filter: str | None = Query(default=None, alias="status"),
    slot_type: str | None = Query(default=None),
    floor: str | None = Query(default=None),
) -> dict[str, Any]:
    db = get_database()
    try:
        loc_oid = to_object_id(location_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid location ID.") from exc

    query: dict[str, Any] = {"location_id": loc_oid}
    if status_filter:
        query["status"] = status_filter
    if slot_type:
        query["slot_type"] = slot_type
    if floor:
        query["floor"] = floor

    slots = await db.parking_slots.find(query).sort("slot_code", 1).to_list(length=500)
    summary = await get_location_summary(db, loc_oid)
    return {"slots": serialize_list(slots), "summary": summary}


@router.get("/slots")
async def list_all_slots(
    location_id: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
) -> dict[str, Any]:
    db = get_database()
    query: dict[str, Any] = {}
    if location_id:
        query["location_id"] = to_object_id(location_id)
    if status_filter:
        query["status"] = status_filter
    slots = await db.parking_slots.find(query).sort([("location_id", 1), ("slot_code", 1)]).to_list(length=1000)
    return {"slots": serialize_list(slots)}


# --- Admin CRUD for Locations & Slots ---
@router.post("/admin/locations", status_code=status.HTTP_201_CREATED)
async def create_location(
    payload: LocationCreateRequest,
    _admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    db = get_database()
    now = datetime.now(timezone.utc)
    doc = {
        "name": payload.name.strip(),
        "address": payload.address.strip(),
        "city": payload.city.strip(),
        "latitude": payload.latitude,
        "longitude": payload.longitude,
        "total_slots": payload.initial_slot_count,
        "base_hourly_rate": payload.base_hourly_rate,
        "dynamic_pricing_enabled": payload.dynamic_pricing_enabled,
        "operating_hours": payload.operating_hours.strip(),
        "amenities": payload.amenities,
        "status": payload.status,
        "created_at": now,
        "updated_at": now,
    }
    res = await db.parking_locations.insert_one(doc)
    loc_oid = res.inserted_id
    doc["_id"] = loc_oid

    # Auto-generate initial slots if requested
    if payload.initial_slot_count > 0:
        loc_tag = str(loc_oid)[-4:].upper()
        slot_docs = []
        for idx in range(1, payload.initial_slot_count + 1):
            floor = "B1" if idx <= payload.initial_slot_count // 2 else "G"
            zone = "A" if idx % 2 == 1 else "B"
            slot_type = "ev" if idx <= 2 else ("handicapped" if idx == 3 else "standard")
            slot_docs.append(
                {
                    "location_id": loc_oid,
                    "slot_code": f"{floor}-{zone}{idx:02d}",
                    "floor": floor,
                    "zone": zone,
                    "slot_type": slot_type,
                    "status": "available",
                    "current_booking_id": None,
                    "sensor_id": f"ESP32-{loc_tag}-S{idx:02d}",
                    "last_sensor_distance_cm": 210.0,
                    "last_updated": now,
                }
            )
        await db.parking_slots.insert_many(slot_docs)

    enriched = (await enrich_locations(db, [doc]))[0]
    await ws_manager.broadcast_location_update(enriched, action="created")
    return {"location": enriched}


@router.put("/admin/locations/{location_id}")
async def update_location(
    location_id: str,
    payload: LocationUpdateRequest,
    _admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    db = get_database()
    loc_oid = to_object_id(location_id)
    existing = await db.parking_locations.find_one({"_id": loc_oid})
    if not existing:
        raise HTTPException(status_code=404, detail="Location not found.")

    updates = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if not updates:
        return {"location": (await enrich_locations(db, [existing]))[0]}

    updates["updated_at"] = datetime.now(timezone.utc)
    await db.parking_locations.update_one({"_id": loc_oid}, {"$set": updates})
    updated = await db.parking_locations.find_one({"_id": loc_oid})
    assert updated is not None
    enriched = (await enrich_locations(db, [updated]))[0]
    await ws_manager.broadcast_location_update(enriched, action="updated")
    return {"location": enriched}


@router.delete("/admin/locations/{location_id}")
async def delete_location(
    location_id: str,
    _admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    db = get_database()
    loc_oid = to_object_id(location_id)
    existing = await db.parking_locations.find_one({"_id": loc_oid})
    if not existing:
        raise HTTPException(status_code=404, detail="Location not found.")

    active_bookings = await db.bookings.count_documents(
        {"location_id": loc_oid, "status": {"$in": ["confirmed", "active"]}}
    )
    if active_bookings > 0:
        raise HTTPException(
            status_code=409,
            detail="Cannot delete location with active or confirmed bookings. Cancel or complete them first.",
        )

    await db.parking_slots.delete_many({"location_id": loc_oid})
    await db.parking_locations.delete_one({"_id": loc_oid})
    await ws_manager.broadcast_location_update({"id": location_id}, action="deleted")
    return {"message": "Parking location and its slots deleted.", "id": location_id}


@router.post("/admin/slots", status_code=status.HTTP_201_CREATED)
async def create_slot(
    payload: SlotCreateRequest,
    _admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    db = get_database()
    loc_oid = to_object_id(payload.location_id)
    loc = await db.parking_locations.find_one({"_id": loc_oid})
    if not loc:
        raise HTTPException(status_code=404, detail="Parking location not found.")

    code = payload.slot_code.upper().strip()
    dup = await db.parking_slots.find_one({"location_id": loc_oid, "slot_code": code})
    if dup:
        raise HTTPException(status_code=409, detail=f"Slot {code} already exists in this location.")

    now = datetime.now(timezone.utc)
    sensor_id = payload.sensor_id or f"ESP32-{str(loc_oid)[-4:].upper()}-{code}"
    slot_doc = {
        "location_id": loc_oid,
        "slot_code": code,
        "floor": payload.floor.strip(),
        "zone": payload.zone.strip(),
        "slot_type": payload.slot_type,
        "status": payload.status,
        "current_booking_id": None,
        "sensor_id": sensor_id,
        "last_sensor_distance_cm": 35.0 if payload.status == "occupied" else 220.0,
        "last_updated": now,
    }
    res = await db.parking_slots.insert_one(slot_doc)
    slot_doc["_id"] = res.inserted_id

    total_slots = await db.parking_slots.count_documents({"location_id": loc_oid})
    await db.parking_locations.update_one({"_id": loc_oid}, {"$set": {"total_slots": total_slots, "updated_at": now}})

    serialized = serialize_doc(slot_doc)
    assert serialized is not None
    summary = await get_location_summary(db, loc_oid)
    await ws_manager.broadcast_slot_update(serialized, summary=summary)
    return {"slot": serialized, "summary": summary}


@router.put("/admin/slots/{slot_id}")
async def update_slot(
    slot_id: str,
    payload: SlotUpdateRequest,
    _admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    db = get_database()
    s_oid = to_object_id(slot_id)
    slot = await db.parking_slots.find_one({"_id": s_oid})
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found.")

    updates = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if "slot_code" in updates:
        updates["slot_code"] = updates["slot_code"].upper().strip()
    updates["last_updated"] = datetime.now(timezone.utc)

    await db.parking_slots.update_one({"_id": s_oid}, {"$set": updates})
    updated = await db.parking_slots.find_one({"_id": s_oid})
    assert updated is not None
    serialized = serialize_doc(updated)
    assert serialized is not None
    summary = await get_location_summary(db, updated["location_id"])
    await ws_manager.broadcast_slot_update(serialized, summary=summary)
    return {"slot": serialized, "summary": summary}


@router.delete("/admin/slots/{slot_id}")
async def delete_slot(
    slot_id: str,
    _admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    db = get_database()
    s_oid = to_object_id(slot_id)
    slot = await db.parking_slots.find_one({"_id": s_oid})
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found.")

    active = await db.bookings.count_documents({"slot_id": s_oid, "status": {"$in": ["confirmed", "active"]}})
    if active > 0:
        raise HTTPException(status_code=409, detail="Cannot delete slot with active or confirmed bookings.")

    loc_oid = slot["location_id"]
    await db.parking_slots.delete_one({"_id": s_oid})
    total_slots = await db.parking_slots.count_documents({"location_id": loc_oid})
    await db.parking_locations.update_one(
        {"_id": loc_oid}, {"$set": {"total_slots": total_slots, "updated_at": datetime.now(timezone.utc)}}
    )
    summary = await get_location_summary(db, loc_oid)
    await ws_manager.broadcast_all("slot_deleted", {"slot_id": slot_id, "location_summary": summary})
    return {"message": "Slot deleted.", "id": slot_id}

