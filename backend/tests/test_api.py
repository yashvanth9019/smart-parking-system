"""End-to-end API & real-time integration tests for SmartPark RTD."""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("MONGODB_DB_NAME", "smart_parking_test_db")

from backend.app.main import app  # noqa: E402
from database.mongodb import get_database  # noqa: E402
from database.seed import seed_database  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as tc:
        yield tc


def test_health_and_seeded_locations(client: TestClient):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "healthy"

    loc_resp = client.get("/api/locations")
    assert loc_resp.status_code == 200
    data = loc_resp.json()
    assert len(data["locations"]) >= 4
    assert data["summary"]["total_slots"] >= 40


def test_user_auth_booking_double_booking_and_qr_flow(client: TestClient):
    # 1. Register new user
    email = f"tester_{int(datetime.now().timestamp())}@example.com"
    reg = client.post(
        "/api/auth/register",
        json={
            "name": "Test Driver",
            "email": email,
            "phone": "+91-9988776655",
            "password": "Password@123",
            "vehicle_number": "KA01TEST99",
            "vehicle_type": "car",
        },
    )
    assert reg.status_code == 201
    user_token = reg.json()["access_token"]
    user_headers = {"Authorization": f"Bearer {user_token}"}

    # 2. Fetch available slot
    locs = client.get("/api/locations").json()["locations"]
    loc_id = locs[0]["id"]
    slots = client.get(f"/api/locations/{loc_id}/slots").json()["slots"]
    avail_slot = next(s for s in slots if s["status"] == "available")

    now = datetime.now(timezone.utc)
    start_iso = (now + timedelta(minutes=10)).isoformat()
    end_iso = (now + timedelta(hours=2, minutes=10)).isoformat()

    # 3. Quote
    quote = client.post(
        "/api/bookings/quote",
        json={"location_id": loc_id, "start_time": start_iso, "end_time": end_iso},
    )
    assert quote.status_code == 200
    assert quote.json()["pricing"]["total_amount"] > 0

    # 4. Book slot
    booking_resp = client.post(
        "/api/bookings",
        headers=user_headers,
        json={
            "location_id": loc_id,
            "slot_id": avail_slot["id"],
            "vehicle_number": "KA01TEST99",
            "start_time": start_iso,
            "end_time": end_iso,
            "payment_method": "upi",
            "payment_confirmed": True,
        },
    )
    assert booking_resp.status_code == 201
    booking = booking_resp.json()["booking"]
    assert booking["qr_image_base64"].startswith("data:image/png;base64,")

    # 5. Prevent double booking on same slot & overlapping window
    dup_resp = client.post(
        "/api/bookings",
        headers=user_headers,
        json={
            "location_id": loc_id,
            "slot_id": avail_slot["id"],
            "vehicle_number": "KA01TEST88",
            "start_time": start_iso,
            "end_time": end_iso,
            "payment_method": "card",
            "payment_confirmed": True,
        },
    )
    assert dup_resp.status_code == 409

    # 6. Admin login & QR Gate entry + exit
    admin_login = client.post(
        "/api/auth/admin/login",
        json={"email": "admin@smartpark.io", "password": "Admin@123"},
    )
    assert admin_login.status_code == 200
    admin_headers = {"Authorization": f"Bearer {admin_login.json()['access_token']}"}

    entry_resp = client.post(
        "/api/bookings/qr-verify",
        headers=admin_headers,
        json={"qr_payload": booking["qr_token"], "action": "entry"},
    )
    assert entry_resp.status_code == 200
    assert entry_resp.json()["slot"]["status"] == "occupied"

    exit_resp = client.post(
        "/api/bookings/qr-verify",
        headers=admin_headers,
        json={"booking_code": booking["booking_code"], "action": "exit"},
    )
    assert exit_resp.status_code == 200
    assert exit_resp.json()["slot"]["status"] == "available"
    assert exit_resp.json()["booking"]["status"] == "completed"


def test_iot_sensor_and_ml_endpoints(client: TestClient):
    slots = client.get("/api/slots").json()["slots"]
    target = next(s for s in slots if s["status"] == "available")

    sensor_resp = client.post(
        "/api/iot/sensor-data",
        headers={"X-IoT-Key": "esp32-smartpark-device-key-2026"},
        json={"sensor_id": target["sensor_id"], "distance_cm": 34.5, "source": "simulator"},
    )
    assert sensor_resp.status_code == 200
    assert sensor_resp.json()["new_status"] == "occupied"

    # Restore to available
    restore_resp = client.post(
        "/api/iot/sensor-data",
        headers={"X-IoT-Key": "esp32-smartpark-device-key-2026"},
        json={"sensor_id": target["sensor_id"], "distance_cm": 220.0, "source": "simulator"},
    )
    assert restore_resp.status_code == 200
    assert restore_resp.json()["new_status"] == "available"

    occ_fc = client.get("/api/ml/occupancy-forecast")
    assert occ_fc.status_code == 200
    assert len(occ_fc.json()["forecast"]) == 24

    peak = client.get("/api/ml/peak-hours")
    assert peak.status_code == 200
    assert len(peak.json()["hourly_profile"]) == 24


def test_websocket_live_slot_broadcast(client: TestClient):
    slots = client.get("/api/slots").json()["slots"]
    target = next(s for s in slots if s["status"] == "available")

    with client.websocket_connect("/ws/parking") as ws:
        hello = ws.receive_json()
        assert hello["event"] == "connected"

        resp = client.post(
            "/api/iot/sensor-data",
            headers={"X-IoT-Key": "esp32-smartpark-device-key-2026"},
            json={"sensor_id": target["sensor_id"], "distance_cm": 31.0, "source": "simulator"},
        )
        assert resp.status_code == 200

        broadcast = ws.receive_json()
        assert broadcast["event"] == "slot_updated"
        assert broadcast["data"]["slot"]["id"] == target["id"]
        assert broadcast["data"]["slot"]["status"] == "occupied"

        # Restore back to available
        client.post(
            "/api/iot/sensor-data",
            headers={"X-IoT-Key": "esp32-smartpark-device-key-2026"},
            json={"sensor_id": target["sensor_id"], "distance_cm": 225.0, "source": "simulator"},
        )


