"""Authentication, registration, and profile management routes."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from backend.app.models import (
    LoginRequest,
    PasswordChangeRequest,
    UserProfileUpdateRequest,
    UserRegisterRequest,
)
from backend.app.security import (
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from database.mongodb import get_database
from database.schemas import serialize_doc, to_object_id

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register_user(payload: UserRegisterRequest) -> dict[str, Any]:
    db = get_database()
    email = payload.email.lower().strip()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists.")

    now = datetime.now(timezone.utc)
    user_doc = {
        "name": payload.name.strip(),
        "email": email,
        "phone": payload.phone.strip(),
        "password_hash": hash_password(payload.password),
        "vehicle_number": payload.vehicle_number.upper().strip(),
        "vehicle_type": payload.vehicle_type,
        "role": "user",
        "is_active": True,
        "created_at": now,
        "updated_at": now,
    }
    res = await db.users.insert_one(user_doc)
    user_doc["_id"] = res.inserted_id
    user_out = serialize_doc(user_doc)
    assert user_out is not None
    user_out.pop("password_hash", None)

    token = create_access_token(subject=user_out["id"], role="user", email=email)
    return {"access_token": token, "token_type": "bearer", "user": user_out}


@router.post("/login")
async def login_user(payload: LoginRequest) -> dict[str, Any]:
    db = get_database()
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")
    if not user.get("is_active", True):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled.")

    user_out = serialize_doc(user)
    assert user_out is not None
    user_out.pop("password_hash", None)

    token = create_access_token(subject=user_out["id"], role="user", email=email)
    return {"access_token": token, "token_type": "bearer", "user": user_out}


@router.post("/admin/login")
async def login_admin(payload: LoginRequest) -> dict[str, Any]:
    db = get_database()
    email = payload.email.lower().strip()
    admin = await db.admins.find_one({"email": email})
    if not admin or not verify_password(payload.password, admin["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid admin credentials.")
    if not admin.get("is_active", True):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin account is disabled.")

    admin_out = serialize_doc(admin)
    assert admin_out is not None
    admin_out.pop("password_hash", None)

    token = create_access_token(subject=admin_out["id"], role=admin_out["role"], email=email)
    return {"access_token": token, "token_type": "bearer", "user": admin_out}


@router.get("/me")
async def get_profile(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    return {"user": current_user}


@router.put("/me")
async def update_profile(
    payload: UserProfileUpdateRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    if current_user.get("role") in ("admin", "superadmin"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Admin profile updates are restricted.")

    updates: dict[str, Any] = {}
    if payload.name is not None:
        updates["name"] = payload.name.strip()
    if payload.phone is not None:
        updates["phone"] = payload.phone.strip()
    if payload.vehicle_number is not None:
        updates["vehicle_number"] = payload.vehicle_number.upper().strip()
    if payload.vehicle_type is not None:
        updates["vehicle_type"] = payload.vehicle_type

    if not updates:
        return {"user": current_user}

    updates["updated_at"] = datetime.now(timezone.utc)
    db = get_database()
    oid = to_object_id(current_user["id"])
    await db.users.update_one({"_id": oid}, {"$set": updates})
    doc = await db.users.find_one({"_id": oid})
    out = serialize_doc(doc)
    assert out is not None
    out.pop("password_hash", None)
    return {"user": out}


@router.post("/change-password")
async def change_password(
    payload: PasswordChangeRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, str]:
    db = get_database()
    oid = to_object_id(current_user["id"])
    col = db.admins if current_user.get("role") in ("admin", "superadmin") else db.users
    doc = await col.find_one({"_id": oid})
    if not doc or not verify_password(payload.current_password, doc["password_hash"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect.")

    await col.update_one(
        {"_id": oid},
        {"$set": {"password_hash": hash_password(payload.new_password), "updated_at": datetime.now(timezone.utc)}},
    )
    return {"message": "Password updated successfully."}

