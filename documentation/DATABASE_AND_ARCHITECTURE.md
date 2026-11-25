# System Architecture & MongoDB Schema Design

## 1. Real-Time Data (RTD) Pipeline

```text
[ESP32 + HC-SR04 Ultrasonic]  OR  [Python IoT Simulator]  OR  [Admin QR Gate Scanner]
             │
             ▼  POST /api/iot/sensor-data  (or /api/bookings/qr-verify)
     [FastAPI Backend]
       ├── Validates payload (Pydantic v2) & Auth (JWT / X-IoT-Key)
       ├── Updates `parking_slots` status (available / occupied / reserved)
       ├── Appends telemetry to `sensor_logs`
       ├── Triggers `notifications` when slots free up or bookings near expiry
       └── Broadcasts via WebSocket ConnectionManager (`/ws/parking`)
             │
             ▼  Instant Push (No Page Refresh)
   [Next.js User & Admin Dashboards]
     ├── Live Slot Grid (Green / Red / Yellow)
     ├── Leaflet Map Availability Pins
     ├── Real-Time Notification Toasts & Bell Counter
     └── Admin Activity Feed & Analytics
```

---

## 2. MongoDB Collections (8 Collections with `$jsonSchema` & Indexes)

1. **`users`**: Driver accounts (`name`, `email` [unique], `phone`, `password_hash`, `vehicle_number`, `vehicle_type`, `role`, `is_active`, timestamps).
2. **`admins`**: Operations administrators (`name`, `email` [unique], `password_hash`, `role`, `permissions`, `is_active`, timestamps).
3. **`parking_locations`**: Hubs (`name`, `address`, `city`, `latitude`, `longitude`, `total_slots`, `base_hourly_rate`, `dynamic_pricing_enabled`, `operating_hours`, `amenities`, `status`).
4. **`parking_slots`**: Individual spaces (`location_id`, `slot_code` [unique per location], `floor`, `zone`, `slot_type`, `status`, `current_booking_id`, `sensor_id`, `last_sensor_distance_cm`, `last_updated`).
5. **`bookings`**: Reservations (`booking_code` [unique], `user_id`, `location_id`, `slot_id`, `vehicle_number`, `start_time`, `end_time`, `actual_entry_time`, `actual_exit_time`, `duration_hours`, `base_amount`, `dynamic_multiplier`, `total_amount`, `status`, `qr_token`, `qr_image_base64`). Compound index `(slot_id, status, start_time, end_time)` prevents double-booking.
6. **`payments`**: Payment ledger (`payment_code` [unique], `booking_id`, `user_id`, `amount`, `currency`, `payment_method`, `status`, `transaction_ref`, `paid_at`).
7. **`notifications`**: User & broadcast alerts (`user_id`, `type`, `title`, `message`, `is_read`, `metadata`, `created_at`).
8. **`sensor_logs`**: Ultrasonic & QR gate audit trail (`sensor_id`, `location_id`, `slot_id`, `distance_cm`, `vehicle_detected`, `previous_status`, `new_status`, `source`, `recorded_at`).

---

## 3. Machine Learning Architecture (`machine_learning/`)

- **Occupancy Predictor**: `RandomForestRegressor` (`n_estimators=120, max_depth=12`) trained on multi-location hourly demand curves (`location_idx`, `hour`, `day_of_week`, `is_weekend`).
- **Revenue Forecaster**: `GradientBoostingRegressor` (`n_estimators=150, learning_rate=0.06`) trained on daily location capacity, base tariff, dynamic surge factor, and predicted average occupancy.
- Model artifacts are persisted to `machine_learning/artifacts/parking_models.joblib`.

