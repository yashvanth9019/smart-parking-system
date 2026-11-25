"""Pydantic v2 request and response schemas with input validation."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field, model_validator


# --- Auth & Profile ---
class UserRegisterRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=80)
    email: EmailStr
    phone: str = Field(..., min_length=7, max_length=20)
    password: str = Field(..., min_length=6, max_length=128)
    vehicle_number: str = Field(..., min_length=4, max_length=20)
    vehicle_type: Literal["car", "suv", "ev", "bike"] = "car"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=4, max_length=128)


class UserProfileUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=80)
    phone: Optional[str] = Field(default=None, min_length=7, max_length=20)
    vehicle_number: Optional[str] = Field(default=None, min_length=4, max_length=20)
    vehicle_type: Optional[Literal["car", "suv", "ev", "bike"]] = None


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(..., min_length=4)
    new_password: str = Field(..., min_length=6, max_length=128)


# --- Parking Locations & Slots ---
class LocationCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    address: str = Field(..., min_length=4, max_length=200)
    city: str = Field(..., min_length=2, max_length=60)
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    base_hourly_rate: float = Field(..., gt=0.0, le=5000.0)
    dynamic_pricing_enabled: bool = True
    operating_hours: str = Field(default="24/7 Open", max_length=80)
    amenities: list[str] = Field(default_factory=list)
    status: Literal["active", "maintenance", "closed"] = "active"
    initial_slot_count: int = Field(default=0, ge=0, le=100)


class LocationUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    address: Optional[str] = Field(default=None, min_length=4, max_length=200)
    city: Optional[str] = Field(default=None, min_length=2, max_length=60)
    latitude: Optional[float] = Field(default=None, ge=-90.0, le=90.0)
    longitude: Optional[float] = Field(default=None, ge=-180.0, le=180.0)
    base_hourly_rate: Optional[float] = Field(default=None, gt=0.0, le=5000.0)
    dynamic_pricing_enabled: Optional[bool] = None
    operating_hours: Optional[str] = Field(default=None, max_length=80)
    amenities: Optional[list[str]] = None
    status: Optional[Literal["active", "maintenance", "closed"]] = None


class SlotCreateRequest(BaseModel):
    location_id: str
    slot_code: str = Field(..., min_length=2, max_length=20)
    floor: str = Field(default="G", max_length=12)
    zone: str = Field(default="A", max_length=12)
    slot_type: Literal["standard", "ev", "handicapped", "compact"] = "standard"
    status: Literal["available", "occupied", "reserved", "maintenance"] = "available"
    sensor_id: Optional[str] = None


class SlotUpdateRequest(BaseModel):
    slot_code: Optional[str] = Field(default=None, min_length=2, max_length=20)
    floor: Optional[str] = Field(default=None, max_length=12)
    zone: Optional[str] = Field(default=None, max_length=12)
    slot_type: Optional[Literal["standard", "ev", "handicapped", "compact"]] = None
    status: Optional[Literal["available", "occupied", "reserved", "maintenance"]] = None
    sensor_id: Optional[str] = None


# --- Bookings & QR Gate ---
class BookingQuoteRequest(BaseModel):
    location_id: str
    start_time: datetime
    end_time: datetime
    slot_type: Optional[Literal["standard", "ev", "handicapped", "compact"]] = None

    @model_validator(mode="after")
    def validate_window(self) -> "BookingQuoteRequest":
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        return self


class BookingCreateRequest(BaseModel):
    location_id: str
    slot_id: Optional[str] = None  # If omitted and auto_allocate=True, smart allocator picks best slot
    auto_allocate: bool = False
    preferred_slot_type: Optional[Literal["standard", "ev", "handicapped", "compact"]] = None
    vehicle_number: str = Field(..., min_length=4, max_length=20)
    start_time: datetime
    end_time: datetime
    payment_method: Literal["card", "upi", "wallet", "netbanking"] = "upi"
    payment_confirmed: bool = True

    @model_validator(mode="after")
    def validate_times(self) -> "BookingCreateRequest":
        if self.end_time <= self.start_time:
            raise ValueError("End time must be strictly after start time.")
        duration_hours = (self.end_time - self.start_time).total_seconds() / 3600.0
        if duration_hours < 0.5:
            raise ValueError("Minimum booking duration is 30 minutes.")
        if duration_hours > 72:
            raise ValueError("Maximum single booking duration is 72 hours.")
        if not self.slot_id and not self.auto_allocate:
            raise ValueError("Provide a slot_id or enable auto_allocate for smart slot selection.")
        return self


class QRScanRequest(BaseModel):
    qr_payload: Optional[str] = None
    booking_code: Optional[str] = None
    action: Literal["entry", "exit", "auto"] = "auto"


# --- IoT Sensor Data ---
class SensorUpdateRequest(BaseModel):
    sensor_id: Optional[str] = None
    slot_id: Optional[str] = None
    distance_cm: float = Field(..., ge=0.0, le=500.0)
    vehicle_detected: Optional[bool] = None
    source: Literal["iot_esp32", "simulator", "qr_gate", "manual"] = "iot_esp32"

    @model_validator(mode="after")
    def require_identifier(self) -> "SensorUpdateRequest":
        if not self.sensor_id and not self.slot_id:
            raise ValueError("Either sensor_id or slot_id is required.")
        return self

