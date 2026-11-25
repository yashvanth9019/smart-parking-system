"""FastAPI application configuration loaded from environment variables."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(ROOT_DIR / ".env"), env_file_encoding="utf-8", extra="ignore")

    APP_NAME: str = "SmartPark RTD - Smart Parking Management System"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    MONGODB_URL: str = "mongodb://localhost:27017"
    MONGODB_DB_NAME: str = "smart_parking_db"

    JWT_SECRET_KEY: str = "super-secret-smart-parking-rtd-jwt-key-2026-change-me"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 720
    QR_HMAC_SECRET: str = "smart-parking-qr-verification-secret-2026"

    BACKEND_HOST: str = "0.0.0.0"
    BACKEND_PORT: int = 8000
    CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    EXPIRY_CHECK_INTERVAL_SECONDS: int = 30
    EXPIRY_WARNING_MINUTES: int = 15

    IOT_API_KEY: str = "esp32-smartpark-device-key-2026"

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

