"""Database seeder for SmartPark RTD with sample users, admins, locations, slots, bookings, payments, notifications, and sensor logs."""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import hmac
import io
import json
import os
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import bcrypt
import qrcode
from motor.motor_asyncio import AsyncIOMotorDatabase

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from database.mongodb import close_mongo_connection, connect_to_mongo  # noqa: E402
from database.schemas import COLLECTIONS  # noqa: E402


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _make_qr_token(booking_code: str, slot_code: str, vehicle_number: str) -> str:
    secret = os.getenv("QR_HMAC_SECRET", "smart-parking-qr-verification-secret-2026")
    payload = f"{booking_code}|{slot_code}|{vehicle_number}"
    sig = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()[:16]
    return json.dumps({"booking_code": booking_code, "slot_code": slot_code, "vehicle": vehicle_number, "sig": sig})


def _make_qr_base64(qr_data: str) -> str:
    qr = qrcode.QRCode(version=1, box_size=6, border=2)
    qr.add_data(qr_data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


async def seed_database(db: AsyncIOMotorDatabase, force: bool = False) -> dict[str, int]:
    """Populate realistic sample data across all 8 MongoDB collections."""
    existing_locations = await db.parking_locations.count_documents({})
    if existing_locations > 0 and not force:
        return {"skipped": 1}

    if force:
        for col in COLLECTIONS:
            await db[col].delete_many({})

    now = datetime.now(timezone.utc)

    # 1. Admins
    admins_data = [
        {
            "name": "System Administrator",
            "email": "admin@smartpark.io",
            "password_hash": _hash_password("Admin@123"),
            "role": "superadmin",
            "permissions": ["all"],
            "is_active": True,
            "created_at": now - timedelta(days=30),
            "updated_at": now - timedelta(days=30),
        },
        {
            "name": "Parking Operations Lead",
            "email": "ops@smartpark.io",
            "password_hash": _hash_password("Ops@123"),
            "role": "admin",
            "permissions": ["locations", "slots", "bookings", "analytics", "iot"],
            "is_active": True,
            "created_at": now - timedelta(days=20),
            "updated_at": now - timedelta(days=20),
        },
    ]
    await db.admins.insert_many(admins_data)

    # 2. Users
    users_data = [
        {
            "name": "Rahul Sharma",
            "email": "rahul@example.com",
            "phone": "+91-9876543210",
            "password_hash": _hash_password("User@123"),
            "vehicle_number": "KA01MJ4582",
            "vehicle_type": "car",
            "role": "user",
            "is_active": True,
            "created_at": now - timedelta(days=25),
            "updated_at": now - timedelta(days=2),
        },
        {
            "name": "Priya Nair",
            "email": "priya@example.com",
            "phone": "+91-9876501234",
            "password_hash": _hash_password("User@123"),
            "vehicle_number": "KA05EV9021",
            "vehicle_type": "ev",
            "role": "user",
            "is_active": True,
            "created_at": now - timedelta(days=18),
            "updated_at": now - timedelta(days=1),
        },
        {
            "name": "Arjun Mehta",
            "email": "arjun@example.com",
            "phone": "+91-9845011223",
            "password_hash": _hash_password("User@123"),
            "vehicle_number": "KA03NB7741",
            "vehicle_type": "suv",
            "role": "user",
            "is_active": True,
            "created_at": now - timedelta(days=15),
            "updated_at": now - timedelta(days=3),
        },
        {
            "name": "Sneha Kulkarni",
            "email": "sneha@example.com",
            "phone": "+91-9900112233",
            "password_hash": _hash_password("User@123"),
            "vehicle_number": "KA02HK3310",
            "vehicle_type": "car",
            "role": "user",
            "is_active": True,
            "created_at": now - timedelta(days=12),
            "updated_at": now - timedelta(days=4),
        },
    ]
    user_res = await db.users.insert_many(users_data)
    user_ids = list(user_res.inserted_ids)

    # 3. Parking Locations (Bengaluru OpenStreetMap coordinates)
    locations_data = [
        {
            "name": "MG Road Central Smart Hub",
            "address": "42 Mahatma Gandhi Road, Shivaji Nagar",
            "city": "Bengaluru",
            "latitude": 12.9756,
            "longitude": 77.6066,
            "total_slots": 16,
            "base_hourly_rate": 60.0,
            "dynamic_pricing_enabled": True,
            "operating_hours": "24/7 Open",
            "amenities": ["EV Fast Charging", "CCTV 24x7", "Valet", "Covered"],
            "status": "active",
            "created_at": now - timedelta(days=30),
            "updated_at": now,
        },
        {
            "name": "Koramangala Tech Plaza",
            "address": "80 Feet Road, 4th Block Koramangala",
            "city": "Bengaluru",
            "latitude": 12.9352,
            "longitude": 77.6245,
            "total_slots": 12,
            "base_hourly_rate": 50.0,
            "dynamic_pricing_enabled": True,
            "operating_hours": "06:00 AM - 11:30 PM",
            "amenities": ["EV Charging", "CCTV 24x7", "Wheelchair Access"],
            "status": "active",
            "created_at": now - timedelta(days=28),
            "updated_at": now,
        },
        {
            "name": "Indiranagar Metro Park & Ride",
            "address": "100 Feet Road, Near Metro Station",
            "city": "Bengaluru",
            "latitude": 12.9784,
            "longitude": 77.6408,
            "total_slots": 12,
            "base_hourly_rate": 40.0,
            "dynamic_pricing_enabled": True,
            "operating_hours": "05:00 AM - 12:00 AM",
            "amenities": ["Metro Link", "CCTV 24x7", "Covered"],
            "status": "active",
            "created_at": now - timedelta(days=25),
            "updated_at": now,
        },
        {
            "name": "Whitefield IT Park Express Lot",
            "address": "ITPL Main Road, Whitefield",
            "city": "Bengaluru",
            "latitude": 12.9855,
            "longitude": 77.7364,
            "total_slots": 8,
            "base_hourly_rate": 45.0,
            "dynamic_pricing_enabled": False,
            "operating_hours": "24/7 Open",
            "amenities": ["EV Fast Charging", "Shuttle", "Covered"],
            "status": "active",
            "created_at": now - timedelta(days=20),
            "updated_at": now,
        },
    ]
    loc_res = await db.parking_locations.insert_many(locations_data)
    loc_ids = list(loc_res.inserted_ids)

    # 4. Parking Slots
    rng = random.Random(42)
    slot_docs = []
    loc_slot_map: dict[int, list[dict]] = {0: [], 1: [], 2: [], 3: []}
    slot_counts = [16, 12, 12, 8]
    statuses_pool = ["available", "available", "available", "occupied", "occupied", "reserved"]

    for loc_idx, loc_id in enumerate(loc_ids):
        count = slot_counts[loc_idx]
        for s_num in range(1, count + 1):
            floor = "B1" if s_num <= count // 2 else "G"
            zone = "A" if s_num % 2 == 1 else "B"
            if s_num <= 2:
                slot_type = "ev"
            elif s_num == 3:
                slot_type = "handicapped"
            elif s_num % 5 == 0:
                slot_type = "compact"
            else:
                slot_type = "standard"

            status = statuses_pool[(loc_idx + s_num) % len(statuses_pool)]
            # Guarantee plenty of available slots on each lot
            if s_num in (1, 4, 7):
                status = "available"

            slot_code = f"{floor}-{zone}{s_num:02d}"
            sensor_id = f"ESP32-L{loc_idx + 1}-S{s_num:02d}"
            dist = round(rng.uniform(18.0, 65.0), 1) if status == "occupied" else round(rng.uniform(160.0, 260.0), 1)
            doc = {
                "location_id": loc_id,
                "slot_code": slot_code,
                "floor": floor,
                "zone": zone,
                "slot_type": slot_type,
                "status": status,
                "current_booking_id": None,
                "sensor_id": sensor_id,
                "last_sensor_distance_cm": dist,
                "last_updated": now - timedelta(minutes=rng.randint(2, 45)),
            }
            slot_docs.append(doc)

    slot_res = await db.parking_slots.insert_many(slot_docs)
    inserted_slots = await db.parking_slots.find({}).to_list(length=100)
    for slot in inserted_slots:
        for idx, loc_id in enumerate(loc_ids):
            if slot["location_id"] == loc_id:
                loc_slot_map[idx].append(slot)

    # 5. Live & Historical Bookings + Payments (past 14 days for rich analytics)
    booking_docs = []
    payment_docs = []
    sensor_log_docs = []

    # Active & Confirmed live bookings for sample users
    live_specs = [
        (0, 0, "active", -1, 2),       # Rahul active booking (started 1h ago, ends in 2h)
        (1, 1, "confirmed", 1, 4),     # Priya upcoming confirmed booking
        (2, 2, "active", -2, 0.2),     # Arjun active booking expiring in ~12 mins (triggers expiry alert!)
        (3, 0, "confirmed", 2, 5),     # Sneha upcoming confirmed booking
    ]

    for idx, (u_idx, l_idx, b_status, start_offset_h, end_offset_h) in enumerate(live_specs, start=1):
        slot = next(
            (s for s in loc_slot_map[l_idx] if s["status"] in ("occupied", "reserved", "available")),
            loc_slot_map[l_idx][0],
        )
        new_slot_status = "occupied" if b_status == "active" else "reserved"
        user = users_data[u_idx]
        loc = locations_data[l_idx]
        start_dt = now + timedelta(hours=start_offset_h)
        end_dt = now + timedelta(hours=end_offset_h)
        dur = round((end_dt - start_dt).total_seconds() / 3600.0, 2)
        mult = 1.25 if loc["dynamic_pricing_enabled"] else 1.0
        total_amt = round(dur * loc["base_hourly_rate"] * mult, 2)
        b_code = f"SPK-{now.strftime('%Y%m%d')}-LIVE{idx:02d}"
        qr_token = _make_qr_token(b_code, slot["slot_code"], user["vehicle_number"])

        b_doc = {
            "booking_code": b_code,
            "user_id": user_ids[u_idx],
            "location_id": loc_ids[l_idx],
            "slot_id": slot["_id"],
            "vehicle_number": user["vehicle_number"],
            "start_time": start_dt,
            "end_time": end_dt,
            "actual_entry_time": start_dt if b_status == "active" else None,
            "actual_exit_time": None,
            "duration_hours": dur,
            "base_amount": round(dur * loc["base_hourly_rate"], 2),
            "dynamic_multiplier": mult,
            "total_amount": total_amt,
            "status": b_status,
            "expiry_alert_sent": False,
            "qr_token": qr_token,
            "qr_image_base64": _make_qr_base64(qr_token),
            "created_at": start_dt - timedelta(minutes=30),
            "updated_at": now,
        }
        b_insert = await db.bookings.insert_one(b_doc)
        await db.parking_slots.update_one(
            {"_id": slot["_id"]},
            {"$set": {"status": new_slot_status, "current_booking_id": b_insert.inserted_id}},
        )

        payment_docs.append(
            {
                "payment_code": f"PAY-{now.strftime('%Y%m%d')}-L{idx:03d}",
                "booking_id": b_insert.inserted_id,
                "user_id": user_ids[u_idx],
                "amount": total_amt,
                "currency": "INR",
                "payment_method": ["upi", "card", "wallet"][idx % 3],
                "status": "paid",
                "transaction_ref": f"TXN{rng.randint(10000000, 99999999)}",
                "paid_at": start_dt - timedelta(minutes=29),
                "created_at": start_dt - timedelta(minutes=29),
            }
        )

    # Historical completed/cancelled bookings over the past 14 days
    hist_counter = 1
    for day_offset in range(1, 15):
        day_base = now - timedelta(days=day_offset)
        daily_count = rng.randint(5, 9)
        for _ in range(daily_count):
            u_idx = rng.randint(0, len(user_ids) - 1)
            l_idx = rng.randint(0, len(loc_ids) - 1)
            slot = rng.choice(loc_slot_map[l_idx])
            user = users_data[u_idx]
            loc = locations_data[l_idx]
            hour = rng.choice([8, 9, 10, 11, 13, 15, 17, 18, 19, 20])
            start_dt = day_base.replace(hour=hour, minute=rng.choice([0, 15, 30]), second=0, microsecond=0)
            dur = rng.choice([1.0, 2.0, 3.0, 4.0])
            end_dt = start_dt + timedelta(hours=dur)
            mult = 1.35 if hour in (9, 10, 18, 19) and loc["dynamic_pricing_enabled"] else 1.0
            total_amt = round(dur * loc["base_hourly_rate"] * mult, 2)
            is_cancelled = rng.random() < 0.1
            b_status = "cancelled" if is_cancelled else "completed"
            b_code = f"SPK-{start_dt.strftime('%Y%m%d')}-H{hist_counter:03d}"
            qr_token = _make_qr_token(b_code, slot["slot_code"], user["vehicle_number"])

            b_doc = {
                "booking_code": b_code,
                "user_id": user_ids[u_idx],
                "location_id": loc_ids[l_idx],
                "slot_id": slot["_id"],
                "vehicle_number": user["vehicle_number"],
                "start_time": start_dt,
                "end_time": end_dt,
                "actual_entry_time": None if is_cancelled else start_dt,
                "actual_exit_time": None if is_cancelled else end_dt,
                "duration_hours": dur,
                "base_amount": round(dur * loc["base_hourly_rate"], 2),
                "dynamic_multiplier": mult,
                "total_amount": total_amt,
                "status": b_status,
                "expiry_alert_sent": False,
                "qr_token": qr_token,
                "qr_image_base64": _make_qr_base64(qr_token),
                "created_at": start_dt - timedelta(hours=2),
                "updated_at": end_dt,
            }
            booking_docs.append(b_doc)
            hist_counter += 1

    if booking_docs:
        hist_res = await db.bookings.insert_many(booking_docs)
        for idx, b_id in enumerate(hist_res.inserted_ids):
            b = booking_docs[idx]
            payment_docs.append(
                {
                    "payment_code": f"PAY-{b['created_at'].strftime('%Y%m%d')}-H{idx + 1:03d}",
                    "booking_id": b_id,
                    "user_id": b["user_id"],
                    "amount": b["total_amount"],
                    "currency": "INR",
                    "payment_method": rng.choice(["upi", "card", "wallet", "netbanking"]),
                    "status": "refunded" if b["status"] == "cancelled" else "paid",
                    "transaction_ref": f"TXN{rng.randint(10000000, 99999999)}",
                    "paid_at": b["created_at"],
                    "created_at": b["created_at"],
                }
            )

    if payment_docs:
        await db.payments.insert_many(payment_docs)

    # 6. Sensor Logs
    for i in range(40):
        l_idx = i % len(loc_ids)
        slot = rng.choice(loc_slot_map[l_idx])
        detected = i % 2 == 0
        sensor_log_docs.append(
            {
                "sensor_id": slot["sensor_id"],
                "location_id": loc_ids[l_idx],
                "slot_id": slot["_id"],
                "distance_cm": round(rng.uniform(22.0, 58.0), 1) if detected else round(rng.uniform(175.0, 245.0), 1),
                "vehicle_detected": detected,
                "previous_status": "available" if detected else "occupied",
                "new_status": "occupied" if detected else "available",
                "source": rng.choice(["iot_esp32", "simulator", "qr_gate"]),
                "recorded_at": now - timedelta(minutes=i * 11),
            }
        )
    await db.sensor_logs.insert_many(sensor_log_docs)

    # 7. Notifications
    notif_docs = [
        {
            "user_id": user_ids[0],
            "type": "booking_confirmed",
            "title": "Booking Confirmed",
            "message": "Your parking slot at MG Road Central Smart Hub is active. Show QR at gate.",
            "is_read": False,
            "metadata": {"location": "MG Road Central Smart Hub"},
            "created_at": now - timedelta(minutes=45),
        },
        {
            "user_id": user_ids[1],
            "type": "booking_confirmed",
            "title": "Upcoming Reservation",
            "message": "Your EV slot at Koramangala Tech Plaza starts in 1 hour.",
            "is_read": False,
            "metadata": {"location": "Koramangala Tech Plaza"},
            "created_at": now - timedelta(minutes=25),
        },
        {
            "user_id": None,
            "type": "slot_available",
            "title": "Slots Available at Indiranagar Metro",
            "message": "Multiple covered parking slots are currently open at Indiranagar Metro Park & Ride.",
            "is_read": False,
            "metadata": {"location": "Indiranagar Metro Park & Ride"},
            "created_at": now - timedelta(minutes=10),
        },
    ]
    await db.notifications.insert_many(notif_docs)

    return {
        "admins": len(admins_data),
        "users": len(users_data),
        "parking_locations": len(locations_data),
        "parking_slots": len(slot_docs),
        "bookings": len(live_specs) + len(booking_docs),
        "payments": len(payment_docs),
        "sensor_logs": len(sensor_log_docs),
        "notifications": len(notif_docs),
    }


async def _main() -> None:
    parser = argparse.ArgumentParser(description="Seed SmartPark RTD MongoDB database.")
    parser.add_argument("--reset", action="store_true", help="Drop existing documents before seeding.")
    args = parser.parse_args()

    db = await connect_to_mongo()
    try:
        result = await seed_database(db, force=args.reset)
        print("Database seed result:", result)
    finally:
        await close_mongo_connection()


if __name__ == "__main__":
    asyncio.run(_main())

