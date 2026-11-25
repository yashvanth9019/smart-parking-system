"""Async MongoDB connection manager, collection validators, and index setup."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING
from pymongo.errors import CollectionInvalid, OperationFailure

from database.schemas import COLLECTIONS, COLLECTION_VALIDATORS

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

logger = logging.getLogger("smartpark.database")

_client: Optional[AsyncIOMotorClient] = None
_db: Optional[AsyncIOMotorDatabase] = None


def get_mongo_url() -> str:
    return os.getenv("MONGODB_URL", "mongodb://localhost:27017")


def get_db_name() -> str:
    return os.getenv("MONGODB_DB_NAME", "smart_parking_db")


async def connect_to_mongo() -> AsyncIOMotorDatabase:
    """Initialize global Motor client and ensure validators & indexes exist."""
    global _client, _db
    if _db is not None:
        return _db

    mongo_url = get_mongo_url()
    db_name = get_db_name()
    logger.info("Connecting to MongoDB at %s (db=%s)", mongo_url, db_name)
    _client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=5000)
    # Verify connectivity
    await _client.admin.command("ping")
    _db = _client[db_name]
    await ensure_indexes_and_validators(_db)
    logger.info("MongoDB connected and schemas/indexes verified.")
    return _db


async def close_mongo_connection() -> None:
    """Close global Motor client cleanly."""
    global _client, _db
    if _client is not None:
        _client.close()
        _client = None
        _db = None
        logger.info("MongoDB connection closed.")


def get_database() -> AsyncIOMotorDatabase:
    """Return active database instance or raise if not connected."""
    if _db is None:
        raise RuntimeError("Database is not initialized. Call connect_to_mongo() first.")
    return _db


async def ensure_indexes_and_validators(db: AsyncIOMotorDatabase) -> None:
    """Create collections with JSON schema validation and required indexes."""
    existing = set(await db.list_collection_names())

    for name in COLLECTIONS:
        validator = COLLECTION_VALIDATORS.get(name)
        if name not in existing:
            try:
                await db.create_collection(
                    name,
                    validator=validator,
                    validationLevel="moderate",
                    validationAction="error",
                )
            except CollectionInvalid:
                pass
        elif validator:
            try:
                await db.command(
                    {
                        "collMod": name,
                        "validator": validator,
                        "validationLevel": "moderate",
                        "validationAction": "error",
                    }
                )
            except OperationFailure as exc:
                logger.warning("Could not update validator for %s: %s", name, exc)

    # Users indexes
    await db.users.create_index([("email", ASCENDING)], unique=True, name="idx_users_email_unique")
    await db.users.create_index([("vehicle_number", ASCENDING)], name="idx_users_vehicle")

    # Admins indexes
    await db.admins.create_index([("email", ASCENDING)], unique=True, name="idx_admins_email_unique")

    # Parking locations indexes
    await db.parking_locations.create_index([("city", ASCENDING), ("status", ASCENDING)], name="idx_locations_city_status")
    await db.parking_locations.create_index([("name", ASCENDING)], name="idx_locations_name")

    # Parking slots indexes
    await db.parking_slots.create_index(
        [("location_id", ASCENDING), ("slot_code", ASCENDING)],
        unique=True,
        name="idx_slots_location_code_unique",
    )
    await db.parking_slots.create_index([("location_id", ASCENDING), ("status", ASCENDING)], name="idx_slots_location_status")
    await db.parking_slots.create_index([("sensor_id", ASCENDING)], name="idx_slots_sensor")

    # Bookings indexes (includes overlap prevention index)
    await db.bookings.create_index([("booking_code", ASCENDING)], unique=True, name="idx_bookings_code_unique")
    await db.bookings.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)], name="idx_bookings_user_recent")
    await db.bookings.create_index(
        [("slot_id", ASCENDING), ("status", ASCENDING), ("start_time", ASCENDING), ("end_time", ASCENDING)],
        name="idx_bookings_slot_window",
    )
    await db.bookings.create_index([("location_id", ASCENDING), ("status", ASCENDING)], name="idx_bookings_location_status")

    # Payments indexes
    await db.payments.create_index([("payment_code", ASCENDING)], unique=True, name="idx_payments_code_unique")
    await db.payments.create_index([("booking_id", ASCENDING)], name="idx_payments_booking")
    await db.payments.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)], name="idx_payments_user_recent")

    # Notifications indexes
    await db.notifications.create_index(
        [("user_id", ASCENDING), ("is_read", ASCENDING), ("created_at", DESCENDING)],
        name="idx_notifications_user_read",
    )
    await db.notifications.create_index([("created_at", DESCENDING)], name="idx_notifications_recent")

    # Sensor logs indexes
    await db.sensor_logs.create_index([("slot_id", ASCENDING), ("recorded_at", DESCENDING)], name="idx_sensor_logs_slot_time")
    await db.sensor_logs.create_index([("location_id", ASCENDING), ("recorded_at", DESCENDING)], name="idx_sensor_logs_loc_time")
    await db.sensor_logs.create_index([("sensor_id", ASCENDING)], name="idx_sensor_logs_sensor")

