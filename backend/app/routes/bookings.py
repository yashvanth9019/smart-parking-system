"""Booking lifecycle, dynamic pricing quotes, smart allocation, cancellation, and QR gate verification."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.app.models import BookingCreateRequest, BookingQuoteRequest, QRScanRequest
from backend.app.security import (
    generate_qr_payload_and_image,
    get_current_admin,
    get_current_user,
    verify_qr_signature,
)
from backend.app.services.parking_service import (
    check_slot_overlap,
    compute_dynamic_pricing,
    create_and_broadcast_notification,
    ensure_utc,
    get_location_summary,
    smart_allocate_slot,
)
from database.mongodb import get_database
from database.schemas import serialize_doc, to_object_id
from websocket.manager import ws_manager

router = APIRouter(prefix="/api/bookings", tags=["Bookings & QR Gate"])


def _calculate_overtime(
    booking: dict[str, Any],
    exit_time: datetime,
    base_hourly_rate: float = 50.0,
) -> tuple[int, float, float]:
    end_dt = ensure_utc(booking["end_time"])
    grace_minutes = int(booking.get("grace_period_minutes", 10))
    extra_rate = float(booking.get("extra_time_hourly_rate") or round(base_hourly_rate * 1.5, 2))
    over_seconds = (ensure_utc(exit_time) - end_dt).total_seconds()
    if over_seconds <= grace_minutes * 60:
        return 0, 0.0, extra_rate
    overtime_minutes = max(1, int((over_seconds + 59) // 60))
    extra_charges = round((overtime_minutes / 60.0) * extra_rate, 2)
    return overtime_minutes, extra_charges, extra_rate


async def _enrich_bookings(db: Any, bookings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not bookings:
        return []
    loc_ids = list({b["location_id"] for b in bookings})
    slot_ids = list({b["slot_id"] for b in bookings})
    user_ids = list({b["user_id"] for b in bookings})

    locs = {d["_id"]: d async for d in db.parking_locations.find({"_id": {"$in": loc_ids}})}
    slots = {d["_id"]: d async for d in db.parking_slots.find({"_id": {"$in": slot_ids}})}
    users = {d["_id"]: d async for d in db.users.find({"_id": {"$in": user_ids}})}

    now = datetime.now(timezone.utc)
    out: list[dict[str, Any]] = []
    for b in bookings:
        item = serialize_doc(b)
        assert item is not None
        loc = locs.get(b["location_id"])
        slot = slots.get(b["slot_id"])
        user = users.get(b["user_id"])
        base_rate = float(loc["base_hourly_rate"]) if loc else 50.0

        item["location_name"] = loc["name"] if loc else "Unknown Location"
        item["location_address"] = loc["address"] if loc else ""
        item["slot_code"] = slot["slot_code"] if slot else "N/A"
        item["slot_floor"] = slot["floor"] if slot else ""
        item["slot_type"] = slot["slot_type"] if slot else "standard"
        item["user_name"] = user["name"] if user else "Guest"
        item["user_email"] = user["email"] if user else ""

        if b.get("status") == "active":
            ot_mins, ot_fee, ot_rate = _calculate_overtime(b, now, base_rate)
            item["overtime_minutes"] = ot_mins
            item["extra_charges"] = ot_fee
            item["extra_time_hourly_rate"] = ot_rate
            item["grace_period_minutes"] = int(b.get("grace_period_minutes", 10))
            item["final_amount"] = round(float(b.get("total_amount", 0.0)) + ot_fee, 2)
        else:
            ot_rate = float(b.get("extra_time_hourly_rate") or round(base_rate * 1.5, 2))
            ot_fee = float(b.get("extra_charges", 0.0))
            item["overtime_minutes"] = int(b.get("overtime_minutes", 0))
            item["extra_charges"] = ot_fee
            item["extra_time_hourly_rate"] = ot_rate
            item["grace_period_minutes"] = int(b.get("grace_period_minutes", 10))
            item["final_amount"] = float(b.get("final_amount", round(float(b.get("total_amount", 0.0)) + ot_fee, 2)))

        out.append(item)
    return out


@router.post("/quote")
async def get_booking_quote(payload: BookingQuoteRequest) -> dict[str, Any]:
    db = get_database()
    loc_oid = to_object_id(payload.location_id)
    loc = await db.parking_locations.find_one({"_id": loc_oid})
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found.")

    summary = await get_location_summary(db, loc_oid)
    st = ensure_utc(payload.start_time)
    et = ensure_utc(payload.end_time)
    duration_hours = (et - st).total_seconds() / 3600.0
    pricing = compute_dynamic_pricing(
        base_rate=float(loc["base_hourly_rate"]),
        dynamic_enabled=bool(loc.get("dynamic_pricing_enabled", True)),
        occupancy_pct=summary["occupancy_pct"],
        start_time=st,
        duration_hours=duration_hours,
    )
    recommended = await smart_allocate_slot(
        db,
        location_id=loc_oid,
        start_time=st,
        end_time=et,
        preferred_type=payload.slot_type,
    )
    return {
        "pricing": pricing,
        "recommended_slot": serialize_doc(recommended) if recommended else None,
        "location_summary": summary,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_booking(
    payload: BookingCreateRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    if not payload.payment_confirmed:
        raise HTTPException(status_code=402, detail="Payment authorization is required to confirm booking.")

    db = get_database()
    loc_oid = to_object_id(payload.location_id)
    loc = await db.parking_locations.find_one({"_id": loc_oid})
    if not loc or loc.get("status") != "active":
        raise HTTPException(status_code=404, detail="Active parking location not found.")

    st = ensure_utc(payload.start_time)
    et = ensure_utc(payload.end_time)
    now = datetime.now(timezone.utc)
    if et <= now:
        raise HTTPException(status_code=400, detail="Booking end time must be in the future.")

    # Resolve target slot (manual pick or Smart Slot Allocation)
    if payload.auto_allocate or not payload.slot_id:
        slot = await smart_allocate_slot(
            db,
            location_id=loc_oid,
            start_time=st,
            end_time=et,
            preferred_type=payload.preferred_slot_type,
            vehicle_type=current_user.get("vehicle_type", "car"),
        )
        if not slot:
            raise HTTPException(
                status_code=409,
                detail="No conflict-free slots are available at this location for the chosen time window.",
            )
    else:
        slot_oid = to_object_id(payload.slot_id)
        slot = await db.parking_slots.find_one({"_id": slot_oid, "location_id": loc_oid})
        if not slot:
            raise HTTPException(status_code=404, detail="Selected parking slot not found at this location.")
        if slot.get("status") == "maintenance":
            raise HTTPException(status_code=409, detail="Selected slot is under maintenance.")
        # Prevent booking an immediately occupied slot if booking starts within 30 minutes
        if st <= now + timedelta(minutes=30) and slot.get("status") in ("occupied", "reserved"):
            raise HTTPException(
                status_code=409,
                detail=f"Slot {slot['slot_code']} is currently {slot['status']}. Please pick an available slot.",
            )
        if await check_slot_overlap(db, slot["_id"], st, et):
            raise HTTPException(
                status_code=409,
                detail=f"Slot {slot['slot_code']} is already booked during the selected time window.",
            )

    summary = await get_location_summary(db, loc_oid)
    duration_hours = (et - st).total_seconds() / 3600.0
    pricing = compute_dynamic_pricing(
        base_rate=float(loc["base_hourly_rate"]),
        dynamic_enabled=bool(loc.get("dynamic_pricing_enabled", True)),
        occupancy_pct=summary["occupancy_pct"],
        start_time=st,
        duration_hours=duration_hours,
    )

    booking_code = f"SPK-{now.strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
    vehicle_num = payload.vehicle_number.upper().strip()
    qr_token, qr_b64 = generate_qr_payload_and_image(booking_code, slot["slot_code"], vehicle_num)

    user_oid = to_object_id(current_user["id"])
    booking_doc = {
        "booking_code": booking_code,
        "user_id": user_oid,
        "location_id": loc_oid,
        "slot_id": slot["_id"],
        "vehicle_number": vehicle_num,
        "start_time": st,
        "end_time": et,
        "actual_entry_time": None,
        "actual_exit_time": None,
        "duration_hours": pricing["duration_hours"],
        "base_amount": pricing["base_amount"],
        "dynamic_multiplier": pricing["multiplier"],
        "total_amount": pricing["total_amount"],
        "grace_period_minutes": pricing["grace_period_minutes"],
        "extra_time_hourly_rate": pricing["extra_time_hourly_rate"],
        "overtime_minutes": 0,
        "extra_charges": 0.0,
        "final_amount": pricing["total_amount"],
        "status": "confirmed",
        "expiry_alert_sent": False,
        "qr_token": qr_token,
        "qr_image_base64": qr_b64,
        "created_at": now,
        "updated_at": now,
    }
    res = await db.bookings.insert_one(booking_doc)
    booking_doc["_id"] = res.inserted_id

    payment_doc = {
        "payment_code": f"PAY-{now.strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}",
        "booking_id": res.inserted_id,
        "user_id": user_oid,
        "amount": pricing["total_amount"],
        "currency": "INR",
        "payment_method": payload.payment_method,
        "status": "paid",
        "transaction_ref": f"TXN-{uuid.uuid4().hex[:10].upper()}",
        "paid_at": now,
        "created_at": now,
    }
    await db.payments.insert_one(payment_doc)

    # Mark slot as reserved immediately if start_time is within 2 hours
    if st <= now + timedelta(hours=2):
        await db.parking_slots.update_one(
            {"_id": slot["_id"]},
            {"$set": {"status": "reserved", "current_booking_id": res.inserted_id, "last_updated": now}},
        )

    updated_slot = await db.parking_slots.find_one({"_id": slot["_id"]})
    new_summary = await get_location_summary(db, loc_oid)
    if updated_slot:
        s_ser = serialize_doc(updated_slot) or {}
        s_ser["location_name"] = loc["name"]
        await ws_manager.broadcast_slot_update(s_ser, summary=new_summary)

    await ws_manager.broadcast_admin_activity(
        {
            "type": "booking_created",
            "booking_code": booking_code,
            "slot_code": slot["slot_code"],
            "location_name": loc["name"],
            "amount": pricing["total_amount"],
            "vehicle_number": vehicle_num,
            "recorded_at": now.isoformat(),
        }
    )

    await create_and_broadcast_notification(
        db,
        notif_type="booking_confirmed",
        title="Booking Confirmed",
        message=f"Slot {slot['slot_code']} reserved at {loc['name']} ({booking_code}). Total: INR {pricing['total_amount']}.",
        user_id=user_oid,
        metadata={"booking_code": booking_code, "slot_code": slot["slot_code"], "location_name": loc["name"]},
    )

    enriched = (await _enrich_bookings(db, [booking_doc]))[0]
    return {"booking": enriched, "payment": serialize_doc(payment_doc)}


@router.get("/my")
async def list_my_bookings(
    status_filter: str | None = Query(default=None, alias="status"),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    db = get_database()
    query: dict[str, Any] = {"user_id": to_object_id(current_user["id"])}
    if status_filter:
        query["status"] = status_filter
    docs = await db.bookings.find(query).sort("created_at", -1).to_list(length=100)
    return {"bookings": await _enrich_bookings(db, docs)}


@router.get("/all")
async def list_all_bookings(
    status_filter: str | None = Query(default=None, alias="status"),
    location_id: str | None = Query(default=None),
    search: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    _admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    db = get_database()
    query: dict[str, Any] = {}
    if status_filter:
        query["status"] = status_filter
    if location_id:
        query["location_id"] = to_object_id(location_id)
    if search and search.strip():
        pattern = {"$regex": search.strip(), "$options": "i"}
        query["$or"] = [{"booking_code": pattern}, {"vehicle_number": pattern}]
    docs = await db.bookings.find(query).sort("created_at", -1).to_list(length=limit)
    return {"bookings": await _enrich_bookings(db, docs)}


@router.post("/{booking_id}/cancel")
async def cancel_booking(
    booking_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    db = get_database()
    b_oid = to_object_id(booking_id)
    booking = await db.bookings.find_one({"_id": b_oid})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found.")

    is_admin = current_user.get("role") in ("admin", "superadmin")
    if not is_admin and str(booking["user_id"]) != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized to cancel this booking.")

    if booking["status"] in ("completed", "cancelled", "expired"):
        raise HTTPException(status_code=400, detail=f"Booking is already {booking['status']}.")

    now = datetime.now(timezone.utc)
    await db.bookings.update_one(
        {"_id": b_oid},
        {"$set": {"status": "cancelled", "updated_at": now}},
    )
    await db.payments.update_one(
        {"booking_id": b_oid, "status": "paid"},
        {"$set": {"status": "refunded", "refunded_at": now}},
    )

    slot = await db.parking_slots.find_one({"_id": booking["slot_id"]})
    loc = await db.parking_locations.find_one({"_id": booking["location_id"]})
    if slot and slot.get("current_booking_id") == b_oid or (slot and slot.get("status") == "reserved"):
        await db.parking_slots.update_one(
            {"_id": slot["_id"]},
            {"$set": {"status": "available", "current_booking_id": None, "last_updated": now}},
        )
        updated_slot = await db.parking_slots.find_one({"_id": slot["_id"]})
        summary = await get_location_summary(db, booking["location_id"])
        if updated_slot:
            s_ser = serialize_doc(updated_slot) or {}
            s_ser["location_name"] = loc["name"] if loc else ""
            await ws_manager.broadcast_slot_update(s_ser, summary=summary)

    await create_and_broadcast_notification(
        db,
        notif_type="booking_cancelled",
        title="Booking Cancelled & Refunded",
        message=f"Booking {booking['booking_code']} has been cancelled. Payment refund initiated.",
        user_id=booking["user_id"],
        metadata={"booking_code": booking["booking_code"]},
    )
    if slot:
        await create_and_broadcast_notification(
            db,
            notif_type="slot_available",
            title="Slot Available After Cancellation",
            message=f"Slot {slot['slot_code']} at {loc['name'] if loc else 'Parking Hub'} just opened up!",
            user_id=None,
            metadata={"location_id": str(booking["location_id"]), "slot_code": slot["slot_code"]},
        )

    updated_booking = await db.bookings.find_one({"_id": b_oid})
    assert updated_booking is not None
    return {"booking": (await _enrich_bookings(db, [updated_booking]))[0]}


@router.post("/qr-verify")
async def verify_qr_entry_exit(
    payload: QRScanRequest,
    _admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    """Verify QR code or booking code at entry/exit gate, update slot & booking, and broadcast via WebSocket."""
    db = get_database()
    booking_code = payload.booking_code

    if payload.qr_payload:
        try:
            qr_data = json.loads(payload.qr_payload)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail="Invalid QR payload format.") from exc
        b_code = qr_data.get("booking_code", "")
        s_code = qr_data.get("slot_code", "")
        veh = qr_data.get("vehicle", "")
        sig = qr_data.get("sig", "")
        if not verify_qr_signature(b_code, s_code, veh, sig):
            raise HTTPException(status_code=403, detail="QR signature verification failed (tampered or invalid QR).")
        booking_code = b_code

    if not booking_code:
        raise HTTPException(status_code=400, detail="Provide a QR payload, booking code, or vehicle number.")

    lookup = booking_code.strip().upper()
    booking = await db.bookings.find_one({"booking_code": lookup})
    if not booking:
        # Allow lookup by vehicle/car number (prefer active/confirmed first, then latest completed)
        booking = await db.bookings.find_one(
            {"vehicle_number": lookup, "status": {"$in": ["active", "confirmed"]}},
            sort=[("created_at", -1)],
        )
        if not booking:
            booking = await db.bookings.find_one({"vehicle_number": lookup}, sort=[("created_at", -1)])

    if not booking:
        raise HTTPException(status_code=404, detail=f"No booking found for '{lookup}'.")

    if booking["status"] == "completed":
        exit_dt = booking.get("actual_exit_time") or booking.get("updated_at")
        exit_str = ensure_utc(exit_dt).strftime("%Y-%m-%d %H:%M UTC") if exit_dt else "earlier"
        raise HTTPException(
            status_code=400,
            detail=f"Already Checked Out: Vehicle {booking['vehicle_number']} ({booking['booking_code']}) already checked out at {exit_str}.",
        )

    if booking["status"] in ("cancelled", "expired"):
        raise HTTPException(status_code=400, detail=f"Cannot process gate action: booking is {booking['status']}.")

    action = payload.action
    if action == "auto":
        action = "entry" if booking["status"] == "confirmed" else "exit"

    now = datetime.now(timezone.utc)
    slot = await db.parking_slots.find_one({"_id": booking["slot_id"]})
    loc = await db.parking_locations.find_one({"_id": booking["location_id"]})
    if not slot:
        raise HTTPException(status_code=404, detail="Associated parking slot missing.")

    if action == "entry":
        if booking["status"] != "confirmed":
            raise HTTPException(
                status_code=400,
                detail=f"Already Checked In: Vehicle {booking['vehicle_number']} ({booking['booking_code']}) is already parked in slot {slot['slot_code']}.",
            )
        await db.bookings.update_one(
            {"_id": booking["_id"]},
            {"$set": {"status": "active", "actual_entry_time": now, "updated_at": now}},
        )
        new_slot_status = "occupied"
        distance_cm = 38.0
        msg = f"Vehicle {booking['vehicle_number']} entered slot {slot['slot_code']}."
    else:
        if booking["status"] not in ("active", "confirmed"):
            raise HTTPException(status_code=400, detail="Booking is not active for exit.")
        base_rate = float(loc["base_hourly_rate"]) if loc else 50.0
        ot_mins, ot_fee, _ = _calculate_overtime(booking, now, base_rate)
        final_amt = round(float(booking["total_amount"]) + ot_fee, 2)
        await db.bookings.update_one(
            {"_id": booking["_id"]},
            {
                "$set": {
                    "status": "completed",
                    "actual_exit_time": now,
                    "overtime_minutes": ot_mins,
                    "extra_charges": ot_fee,
                    "final_amount": final_amt,
                    "updated_at": now,
                }
            },
        )
        if ot_fee > 0:
            await db.payments.insert_one(
                {
                    "payment_code": f"PAY-OT-{now.strftime('%Y%m%d')}-{uuid.uuid4().hex[:5].upper()}",
                    "booking_id": booking["_id"],
                    "user_id": booking["user_id"],
                    "amount": ot_fee,
                    "currency": "INR",
                    "payment_method": "upi",
                    "status": "paid",
                    "transaction_ref": f"OT-{uuid.uuid4().hex[:8].upper()}",
                    "paid_at": now,
                    "created_at": now,
                }
            )
        new_slot_status = "available"
        distance_cm = 215.0
        msg = (
            f"Vehicle {booking['vehicle_number']} checked out of slot {slot['slot_code']}. "
            f"Overtime: {ot_mins} min (Extra charge: INR {ot_fee})."
            if ot_fee > 0
            else f"Vehicle {booking['vehicle_number']} checked out of slot {slot['slot_code']}."
        )

    prev_slot_status = slot["status"]
    await db.parking_slots.update_one(
        {"_id": slot["_id"]},
        {
            "$set": {
                "status": new_slot_status,
                "current_booking_id": booking["_id"] if new_slot_status == "occupied" else None,
                "last_sensor_distance_cm": distance_cm,
                "last_updated": now,
            }
        },
    )

    await db.sensor_logs.insert_one(
        {
            "sensor_id": slot.get("sensor_id") or f"GATE-{slot['slot_code']}",
            "location_id": booking["location_id"],
            "slot_id": slot["_id"],
            "distance_cm": distance_cm,
            "vehicle_detected": new_slot_status == "occupied",
            "previous_status": prev_slot_status,
            "new_status": new_slot_status,
            "source": "qr_gate",
            "recorded_at": now,
        }
    )

    updated_slot = await db.parking_slots.find_one({"_id": slot["_id"]})
    summary = await get_location_summary(db, booking["location_id"])
    if updated_slot:
        s_ser = serialize_doc(updated_slot) or {}
        s_ser["location_name"] = loc["name"] if loc else ""
        await ws_manager.broadcast_slot_update(s_ser, summary=summary)

    await ws_manager.broadcast_admin_activity(
        {
            "type": f"qr_{action}",
            "booking_code": booking["booking_code"],
            "slot_code": slot["slot_code"],
            "location_name": loc["name"] if loc else "",
            "vehicle_number": booking["vehicle_number"],
            "recorded_at": now.isoformat(),
        }
    )

    await create_and_broadcast_notification(
        db,
        notif_type="entry_exit",
        title=f"QR Gate {action.title()} Verified",
        message=msg,
        user_id=booking["user_id"],
        metadata={"booking_code": booking["booking_code"], "action": action},
    )

    updated_booking = await db.bookings.find_one({"_id": booking["_id"]})
    assert updated_booking is not None
    return {
        "action": action,
        "message": msg,
        "booking": (await _enrich_bookings(db, [updated_booking]))[0],
        "slot": serialize_doc(updated_slot),
    }

