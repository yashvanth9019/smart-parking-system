"""JWT token management, password hashing, QR signing, and FastAPI RBAC dependencies."""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt
import qrcode
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.app.config import get_settings
from database.mongodb import get_database
from database.schemas import serialize_doc, to_object_id

bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        return False


def create_access_token(subject: str, role: str, email: str, extra: dict[str, Any] | None = None) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    payload: dict[str, Any] = {
        "sub": subject,
        "role": role,
        "email": email,
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token has expired.",
        ) from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
        ) from exc


def generate_qr_payload_and_image(booking_code: str, slot_code: str, vehicle_number: str) -> tuple[str, str]:
    """Create HMAC-signed QR JSON payload and base64 PNG image."""
    settings = get_settings()
    raw = f"{booking_code}|{slot_code}|{vehicle_number}"
    sig = hmac.new(settings.QR_HMAC_SECRET.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()[:16]
    qr_token = json.dumps(
        {"booking_code": booking_code, "slot_code": slot_code, "vehicle": vehicle_number, "sig": sig}
    )

    qr = qrcode.QRCode(version=1, box_size=7, border=2)
    qr.add_data(qr_token)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_b64 = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    return qr_token, qr_b64


def verify_qr_signature(booking_code: str, slot_code: str, vehicle_number: str, sig: str) -> bool:
    settings = get_settings()
    raw = f"{booking_code}|{slot_code}|{vehicle_number}"
    expected = hmac.new(settings.QR_HMAC_SECRET.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()[:16]
    return hmac.compare_digest(expected, sig)


async def get_current_principal(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict[str, Any]:
    """Authenticate either a user or an admin from Bearer JWT."""
    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authorization token required.")

    payload = decode_access_token(credentials.credentials)
    user_id = payload.get("sub")
    role = payload.get("role", "user")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject.")

    db = get_database()
    try:
        oid = to_object_id(user_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Malformed user ID in token.") from exc

    collection = db.admins if role in ("admin", "superadmin") else db.users
    doc = await collection.find_one({"_id": oid})
    if not doc or not doc.get("is_active", True):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account not found or inactive.")

    serialized = serialize_doc(doc)
    assert serialized is not None
    serialized.pop("password_hash", None)
    return serialized


async def get_current_user(principal: dict[str, Any] = Depends(get_current_principal)) -> dict[str, Any]:
    if principal.get("role") not in ("user", "admin", "superadmin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User privileges required.")
    return principal


async def get_current_admin(principal: dict[str, Any] = Depends(get_current_principal)) -> dict[str, Any]:
    if principal.get("role") not in ("admin", "superadmin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required.")
    return principal


async def verify_iot_or_admin(
    x_iot_key: str | None = Header(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict[str, Any]:
    """Allow IoT ESP32 devices (via X-IoT-Key) OR authenticated Admins to push sensor readings."""
    settings = get_settings()
    if x_iot_key and hmac.compare_digest(x_iot_key, settings.IOT_API_KEY):
        return {"role": "iot_device", "device": "esp32"}
    if credentials and credentials.credentials:
        principal = await get_current_principal(credentials)
        if principal.get("role") in ("admin", "superadmin"):
            return principal
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Valid IoT API key or Admin token required.")

