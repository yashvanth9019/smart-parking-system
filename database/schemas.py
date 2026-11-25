"""MongoDB schema validators, collection names, and serialization helpers."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from bson import ObjectId

COLLECTIONS = [
    "users",
    "admins",
    "parking_locations",
    "parking_slots",
    "bookings",
    "payments",
    "notifications",
    "sensor_logs",
]

COLLECTION_VALIDATORS: dict[str, dict[str, Any]] = {
    "users": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["name", "email", "password_hash", "role", "created_at"],
            "properties": {
                "name": {"bsonType": "string", "minLength": 2},
                "email": {"bsonType": "string"},
                "phone": {"bsonType": "string"},
                "password_hash": {"bsonType": "string"},
                "vehicle_number": {"bsonType": "string"},
                "vehicle_type": {"enum": ["car", "suv", "ev", "bike"]},
                "role": {"enum": ["user"]},
                "is_active": {"bsonType": "bool"},
                "created_at": {"bsonType": "date"},
            },
        }
    },
    "admins": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["name", "email", "password_hash", "role", "created_at"],
            "properties": {
                "name": {"bsonType": "string", "minLength": 2},
                "email": {"bsonType": "string"},
                "password_hash": {"bsonType": "string"},
                "role": {"enum": ["admin", "superadmin"]},
                "is_active": {"bsonType": "bool"},
                "created_at": {"bsonType": "date"},
            },
        }
    },
    "parking_locations": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["name", "address", "city", "latitude", "longitude", "base_hourly_rate", "created_at"],
            "properties": {
                "name": {"bsonType": "string", "minLength": 2},
                "address": {"bsonType": "string"},
                "city": {"bsonType": "string"},
                "latitude": {"bsonType": ["double", "int"]},
                "longitude": {"bsonType": ["double", "int"]},
                "total_slots": {"bsonType": "int", "minimum": 0},
                "base_hourly_rate": {"bsonType": ["double", "int"], "minimum": 0},
                "dynamic_pricing_enabled": {"bsonType": "bool"},
                "operating_hours": {"bsonType": "string"},
                "status": {"enum": ["active", "maintenance", "closed"]},
                "created_at": {"bsonType": "date"},
            },
        }
    },
    "parking_slots": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["location_id", "slot_code", "status", "last_updated"],
            "properties": {
                "location_id": {"bsonType": "objectId"},
                "slot_code": {"bsonType": "string"},
                "floor": {"bsonType": "string"},
                "zone": {"bsonType": "string"},
                "slot_type": {"enum": ["standard", "ev", "handicapped", "compact"]},
                "status": {"enum": ["available", "occupied", "reserved", "maintenance"]},
                "sensor_id": {"bsonType": "string"},
                "last_updated": {"bsonType": "date"},
            },
        }
    },
    "bookings": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": [
                "booking_code",
                "user_id",
                "location_id",
                "slot_id",
                "start_time",
                "end_time",
                "total_amount",
                "status",
                "created_at",
            ],
            "properties": {
                "booking_code": {"bsonType": "string"},
                "user_id": {"bsonType": "objectId"},
                "location_id": {"bsonType": "objectId"},
                "slot_id": {"bsonType": "objectId"},
                "vehicle_number": {"bsonType": "string"},
                "start_time": {"bsonType": "date"},
                "end_time": {"bsonType": "date"},
                "total_amount": {"bsonType": ["double", "int"], "minimum": 0},
                "status": {"enum": ["confirmed", "active", "completed", "cancelled", "expired"]},
                "created_at": {"bsonType": "date"},
            },
        }
    },
    "payments": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["payment_code", "booking_id", "user_id", "amount", "status", "created_at"],
            "properties": {
                "payment_code": {"bsonType": "string"},
                "booking_id": {"bsonType": "objectId"},
                "user_id": {"bsonType": "objectId"},
                "amount": {"bsonType": ["double", "int"], "minimum": 0},
                "payment_method": {"enum": ["card", "upi", "wallet", "netbanking"]},
                "status": {"enum": ["paid", "pending", "refunded", "failed"]},
                "created_at": {"bsonType": "date"},
            },
        }
    },
    "notifications": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["type", "title", "message", "is_read", "created_at"],
            "properties": {
                "type": {
                    "enum": [
                        "booking_confirmed",
                        "booking_cancelled",
                        "slot_available",
                        "expiry_alert",
                        "sensor_alert",
                        "entry_exit",
                    ]
                },
                "title": {"bsonType": "string"},
                "message": {"bsonType": "string"},
                "is_read": {"bsonType": "bool"},
                "created_at": {"bsonType": "date"},
            },
        }
    },
    "sensor_logs": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["sensor_id", "location_id", "slot_id", "vehicle_detected", "recorded_at"],
            "properties": {
                "sensor_id": {"bsonType": "string"},
                "location_id": {"bsonType": "objectId"},
                "slot_id": {"bsonType": "objectId"},
                "distance_cm": {"bsonType": ["double", "int"]},
                "vehicle_detected": {"bsonType": "bool"},
                "source": {"enum": ["iot_esp32", "simulator", "qr_gate", "manual"]},
                "recorded_at": {"bsonType": "date"},
            },
        }
    },
}


def to_object_id(value: str | ObjectId) -> ObjectId:
    """Convert a string ID to BSON ObjectId, raising ValueError if invalid."""
    if isinstance(value, ObjectId):
        return value
    if not ObjectId.is_valid(value):
        raise ValueError(f"Invalid ObjectId: {value}")
    return ObjectId(value)


def _convert_value(val: Any) -> Any:
    if isinstance(val, ObjectId):
        return str(val)
    if isinstance(val, datetime):
        if val.tzinfo is None:
            val = val.replace(tzinfo=timezone.utc)
        return val.isoformat()
    if isinstance(val, list):
        return [_convert_value(item) for item in val]
    if isinstance(val, dict):
        return {k: _convert_value(v) for k, v in val.items()}
    return val


def serialize_doc(doc: dict[str, Any] | None) -> dict[str, Any] | None:
    """Serialize a MongoDB document into JSON-safe types, renaming `_id` to `id`."""
    if doc is None:
        return None
    result: dict[str, Any] = {}
    for key, value in doc.items():
        if key == "_id":
            result["id"] = str(value)
        else:
            result[key] = _convert_value(value)
    return result


def serialize_list(docs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Serialize a list of MongoDB documents."""
    return [serialized for d in docs if (serialized := serialize_doc(d)) is not None]

