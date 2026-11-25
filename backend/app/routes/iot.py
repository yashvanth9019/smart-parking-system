"""IoT sensor ingestion, simulator controls, and sensor telemetry logs."""

from __future__ import annotations

import random
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.app.models import SensorUpdateRequest
from backend.app.security import get_current_admin, verify_iot_or_admin
from backend.app.services.parking_service import process_sensor_event
from database.mongodb import get_database
from database.schemas import serialize_list, to_object_id

router = APIRouter(prefix="/api/iot", tags=["IoT Sensors & Simulation"])


@router.post("/sensor-data")
async def ingest_sensor_data(
    payload: SensorUpdateRequest,
    _caller: dict[str, Any] = Depends(verify_iot_or_admin),
) -> dict[str, Any]:
    """Ingest ultrasonic sensor reading (from ESP32 hardware or simulator) and broadcast live via WebSocket."""
    db = get_database()
    try:
        result = await process_sensor_event(
            db,
            distance_cm=payload.distance_cm,
            sensor_id=payload.sensor_id,
            slot_id=payload.slot_id,
            vehicle_detected=payload.vehicle_detected,
            source=payload.source,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return result


@router.post("/simulate/toggle/{slot_id}")
async def simulate_slot_toggle(
    slot_id: str,
    _admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    """Admin helper to simulate a vehicle arriving or departing a specific slot."""
    db = get_database()
    slot = await db.parking_slots.find_one({"_id": to_object_id(slot_id)})
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found.")

    currently_occupied = slot.get("status") == "occupied"
    distance_cm = round(random.uniform(180.0, 250.0), 1) if currently_occupied else round(random.uniform(20.0, 55.0), 1)
    return await process_sensor_event(
        db,
        distance_cm=distance_cm,
        slot_id=slot_id,
        vehicle_detected=not currently_occupied,
        source="simulator",
    )


@router.post("/simulate/burst")
async def simulate_traffic_burst(
    count: int = Query(default=3, ge=1, le=12),
    location_id: str | None = Query(default=None),
    _admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    """Simulate a batch of random IoT ultrasonic sensor events across non-maintenance slots."""
    db = get_database()
    query: dict[str, Any] = {"status": {"$in": ["available", "occupied"]}}
    if location_id:
        query["location_id"] = to_object_id(location_id)

    slots = await db.parking_slots.find(query).to_list(length=200)
    if not slots:
        raise HTTPException(status_code=404, detail="No eligible slots available for simulation.")

    chosen = random.sample(slots, k=min(count, len(slots)))
    events = []
    for slot in chosen:
        occupied_now = slot.get("status") == "occupied"
        dist = round(random.uniform(175.0, 245.0), 1) if occupied_now else round(random.uniform(20.0, 58.0), 1)
        res = await process_sensor_event(
            db,
            distance_cm=dist,
            slot_id=str(slot["_id"]),
            vehicle_detected=not occupied_now,
            source="simulator",
        )
        events.append(
            {
                "slot_code": res["slot"]["slot_code"],
                "location_name": res["slot"].get("location_name"),
                "previous_status": res["previous_status"],
                "new_status": res["new_status"],
                "distance_cm": dist,
            }
        )
    return {"simulated_events": events, "count": len(events)}


@router.get("/logs")
async def get_sensor_logs(
    location_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    _admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    db = get_database()
    query: dict[str, Any] = {}
    if location_id:
        query["location_id"] = to_object_id(location_id)

    logs = await db.sensor_logs.find(query).sort("recorded_at", -1).to_list(length=limit)
    loc_ids = list({l["location_id"] for l in logs})
    slot_ids = list({l["slot_id"] for l in logs})
    locs = {d["_id"]: d["name"] async for d in db.parking_locations.find({"_id": {"$in": loc_ids}})}
    slots = {d["_id"]: d["slot_code"] async for d in db.parking_slots.find({"_id": {"$in": slot_ids}})}

    serialized = serialize_list(logs)
    for item, raw in zip(serialized, logs):
        item["location_name"] = locs.get(raw["location_id"], "Unknown")
        item["slot_code"] = slots.get(raw["slot_id"], "N/A")
    return {"logs": serialized}

