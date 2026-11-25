"""Admin revenue analytics (daily/weekly/monthly) and ML prediction endpoints."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.app.security import get_current_admin
from database.mongodb import get_database
from database.schemas import serialize_list, to_object_id
from machine_learning.predictor import (
    analyze_peak_hours,
    predict_24h_occupancy,
    predict_revenue_forecast,
    retrain_models,
)

router = APIRouter(prefix="/api", tags=["Analytics & Machine Learning"])


@router.get("/admin/analytics")
async def get_admin_analytics(
    period: str = Query(default="daily", pattern="^(daily|weekly|monthly)$"),
    _admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    """Return KPIs, revenue reports, booking distribution, and daily/weekly/monthly trend series."""
    db = get_database()
    now = datetime.now(timezone.utc)

    total_users = await db.users.count_documents({})
    total_locations = await db.parking_locations.count_documents({})
    total_slots = await db.parking_slots.count_documents({})
    available_slots = await db.parking_slots.count_documents({"status": "available"})
    occupied_slots = await db.parking_slots.count_documents({"status": "occupied"})
    reserved_slots = await db.parking_slots.count_documents({"status": "reserved"})

    active_bookings = await db.bookings.count_documents({"status": {"$in": ["active", "confirmed"]}})
    total_bookings = await db.bookings.count_documents({})

    # Paid revenue totals
    rev_agg = await db.payments.aggregate(
        [
            {"$match": {"status": "paid"}},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}, "count": {"$sum": 1}}},
        ]
    ).to_list(length=1)
    total_revenue = round(float(rev_agg[0]["total"]), 2) if rev_agg else 0.0

    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_agg = await db.payments.aggregate(
        [
            {"$match": {"status": "paid", "created_at": {"$gte": today_start}}},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
        ]
    ).to_list(length=1)
    today_revenue = round(float(today_agg[0]["total"]), 2) if today_agg else 0.0

    # Time series grouping
    if period == "daily":
        lookback = now - timedelta(days=14)
        date_fmt = "%Y-%m-%d"
    elif period == "weekly":
        lookback = now - timedelta(weeks=8)
        date_fmt = "%Y-W%U"
    else:
        lookback = now - timedelta(days=180)
        date_fmt = "%Y-%m"

    payments = await db.payments.find({"status": "paid", "created_at": {"$gte": lookback}}).to_list(length=5000)
    buckets: dict[str, dict[str, Any]] = {}
    for pay in payments:
        dt = pay["created_at"]
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        label = dt.strftime(date_fmt)
        if label not in buckets:
            buckets[label] = {"label": label, "revenue": 0.0, "bookings": 0}
        buckets[label]["revenue"] = round(buckets[label]["revenue"] + float(pay["amount"]), 2)
        buckets[label]["bookings"] += 1

    trend_series = [buckets[k] for k in sorted(buckets.keys())]

    # Revenue by location
    loc_docs = {d["_id"]: d["name"] async for d in db.parking_locations.find({})}
    loc_bookings = await db.bookings.aggregate(
        [
            {"$match": {"status": {"$ne": "cancelled"}}},
            {
                "$group": {
                    "_id": "$location_id",
                    "revenue": {"$sum": "$total_amount"},
                    "bookings": {"$sum": 1},
                }
            },
        ]
    ).to_list(length=50)
    revenue_by_location = [
        {
            "location_id": str(row["_id"]),
            "location_name": loc_docs.get(row["_id"], "Unknown"),
            "revenue": round(float(row["revenue"]), 2),
            "bookings": int(row["bookings"]),
        }
        for row in loc_bookings
    ]

    # Recent activity feed (latest bookings + sensor logs)
    recent_logs = await db.sensor_logs.find({}).sort("recorded_at", -1).to_list(length=12)
    slot_names = {d["_id"]: d["slot_code"] async for d in db.parking_slots.find({})}
    activity_feed = [
        {
            "id": str(l["_id"]),
            "type": l.get("source", "sensor"),
            "slot_code": slot_names.get(l["slot_id"], "Slot"),
            "location_name": loc_docs.get(l["location_id"], "Hub"),
            "previous_status": l.get("previous_status"),
            "new_status": l.get("new_status"),
            "distance_cm": l.get("distance_cm"),
            "recorded_at": (l["recorded_at"].replace(tzinfo=timezone.utc) if l["recorded_at"].tzinfo is None else l["recorded_at"]).isoformat(),
        }
        for l in recent_logs
    ]

    return {
        "kpis": {
            "total_users": total_users,
            "total_locations": total_locations,
            "total_slots": total_slots,
            "available_slots": available_slots,
            "occupied_slots": occupied_slots,
            "reserved_slots": reserved_slots,
            "occupancy_pct": round(((occupied_slots + reserved_slots) / total_slots) * 100.0, 1) if total_slots else 0.0,
            "active_bookings": active_bookings,
            "total_bookings": total_bookings,
            "total_revenue": total_revenue,
            "today_revenue": today_revenue,
        },
        "period": period,
        "trend_series": trend_series,
        "revenue_by_location": revenue_by_location,
        "activity_feed": activity_feed,
    }


@router.get("/ml/occupancy-forecast")
async def ml_occupancy_forecast(location_id: str | None = Query(default=None)) -> dict[str, Any]:
    db = get_database()
    locs = await db.parking_locations.find({}).sort("created_at", 1).to_list(length=50)
    if not locs:
        raise HTTPException(status_code=404, detail="No parking locations available.")

    target_idx = 0
    target_loc = locs[0]
    if location_id:
        loc_oid = to_object_id(location_id)
        for idx, doc in enumerate(locs):
            if doc["_id"] == loc_oid:
                target_idx = idx
                target_loc = doc
                break

    slot_count = await db.parking_slots.count_documents({"location_id": target_loc["_id"]})
    result = predict_24h_occupancy(
        location_id=str(target_loc["_id"]),
        location_idx=target_idx,
        total_slots=max(slot_count, int(target_loc.get("total_slots", 12) or 12)),
        base_hourly_rate=float(target_loc["base_hourly_rate"]),
    )
    result["location_name"] = target_loc["name"]
    return result


@router.get("/ml/peak-hours")
async def ml_peak_hours(location_id: str | None = Query(default=None)) -> dict[str, Any]:
    db = get_database()
    locs = await db.parking_locations.find({}).sort("created_at", 1).to_list(length=50)
    target_idx = 0
    total_slots = 16
    loc_name = "All Locations"
    if locs:
        target_loc = locs[0]
        if location_id:
            loc_oid = to_object_id(location_id)
            for idx, doc in enumerate(locs):
                if doc["_id"] == loc_oid:
                    target_idx = idx
                    target_loc = doc
                    break
        total_slots = await db.parking_slots.count_documents({"location_id": target_loc["_id"]}) or 16
        loc_name = target_loc["name"]

    result = analyze_peak_hours(location_idx=target_idx, total_slots=total_slots)
    result["location_name"] = loc_name
    return result


@router.get("/ml/revenue-forecast")
async def ml_revenue_forecast(
    days: int = Query(default=7, ge=1, le=30),
    _admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, Any]:
    db = get_database()
    locs = await db.parking_locations.find({"status": "active"}).sort("created_at", 1).to_list(length=50)
    serialized_locs = serialize_list(locs)
    for item, raw in zip(serialized_locs, locs):
        item["total_slots"] = await db.parking_slots.count_documents({"location_id": raw["_id"]}) or item.get("total_slots", 12)
    return predict_revenue_forecast(serialized_locs, days=days)


@router.post("/ml/retrain")
async def ml_retrain(_admin: dict[str, Any] = Depends(get_current_admin)) -> dict[str, Any]:
    bundle = retrain_models()
    return {"message": "ML models retrained successfully.", "metrics": bundle["metrics"]}

