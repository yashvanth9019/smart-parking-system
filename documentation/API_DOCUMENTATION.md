# SmartPark RTD — API & WebSocket Documentation

Base URL: `http://localhost:8000`  
Interactive OpenAPI Docs: `http://localhost:8000/docs`

---

## 1. Authentication & Profile (`/api/auth`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | Public | Register a driver (`name`, `email`, `phone`, `password`, `vehicle_number`, `vehicle_type`) |
| `POST` | `/api/auth/login` | Public | Driver login -> returns `access_token` (JWT) + `user` |
| `POST` | `/api/auth/admin/login` | Public | Admin login -> returns `access_token` (JWT) + `user` |
| `GET` | `/api/auth/me` | Bearer JWT | Fetch current user/admin profile |
| `PUT` | `/api/auth/me` | Bearer JWT | Update driver profile & vehicle info |
| `POST` | `/api/auth/change-password` | Bearer JWT | Change account password |

---

## 2. Parking Locations & Slots (`/api`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/locations` | Public | List parking hubs with live `available_slots`, `occupied_slots`, `reserved_slots`, `current_hourly_rate`. Supports `?search=`, `?city=`, `?max_rate=`. |
| `GET` | `/api/locations/{location_id}` | Public | Hub details + all slots for that hub |
| `GET` | `/api/locations/{location_id}/slots` | Public | Filterable slots (`?status=`, `?slot_type=`, `?floor=`) |
| `GET` | `/api/slots` | Public | List all slots across hubs |
| `POST` | `/api/admin/locations` | Admin JWT | Create parking location (optionally auto-creates `initial_slot_count` slots) |
| `PUT` | `/api/admin/locations/{location_id}` | Admin JWT | Update location details, operating hours, or pricing |
| `DELETE` | `/api/admin/locations/{location_id}` | Admin JWT | Delete location (blocked if active/confirmed bookings exist) |
| `POST` | `/api/admin/slots` | Admin JWT | Add a new parking slot |
| `PUT` | `/api/admin/slots/{slot_id}` | Admin JWT | Update slot attributes or status |
| `DELETE` | `/api/admin/slots/{slot_id}` | Admin JWT | Delete a parking slot |

---

## 3. Bookings, Dynamic Pricing & QR Gate (`/api/bookings`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/bookings/quote` | Public | Calculate dynamic tariff breakdown & smart slot recommendation |
| `POST` | `/api/bookings` | User JWT | Create booking (supports manual `slot_id` or `auto_allocate: true`), validates payment, prevents overlap conflicts, generates HMAC QR code, records payment, broadcasts WebSocket update |
| `GET` | `/api/bookings/my` | User JWT | List authenticated user's bookings (`?status=`) |
| `GET` | `/api/bookings/all` | Admin JWT | List all customer bookings (`?status=`, `?location_id=`) |
| `POST` | `/api/bookings/{booking_id}/cancel` | User/Admin JWT | Cancel booking, refund payment, release slot, broadcast availability alert |
| `POST` | `/api/bookings/qr-verify` | Admin JWT | Verify `qr_payload` or `booking_code` for vehicle `entry`, `exit`, or `auto` |

---

## 4. IoT Sensors & Simulation (`/api/iot`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/iot/sensor-data` | `X-IoT-Key` or Admin JWT | Ingest ultrasonic reading (`sensor_id` or `slot_id`, `distance_cm`, `vehicle_detected`, `source`), update MongoDB, write `sensor_logs`, broadcast via WebSocket |
| `POST` | `/api/iot/simulate/toggle/{slot_id}` | Admin JWT | Toggle a single slot between occupied & available |
| `POST` | `/api/iot/simulate/burst` | Admin JWT | Simulate `count` random ultrasonic sensor events |
| `GET` | `/api/iot/logs` | Admin JWT | Fetch recent sensor telemetry logs |

---

## 5. Analytics & Machine Learning (`/api/admin/analytics`, `/api/ml`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/admin/analytics?period=daily\|weekly\|monthly` | Admin JWT | KPIs, revenue trends, revenue by location, activity feed |
| `GET` | `/api/ml/occupancy-forecast?location_id=` | Public | 24-hour occupancy & dynamic rate prediction (`RandomForestRegressor`) |
| `GET` | `/api/ml/peak-hours?location_id=` | Public | Weekday vs weekend hourly occupancy profile + peak/quiet hours |
| `GET` | `/api/ml/revenue-forecast?days=7` | Admin JWT | Multi-day revenue prediction (`GradientBoostingRegressor`) |
| `POST` | `/api/ml/retrain` | Admin JWT | Retrain ML models and return evaluation metrics (`R²`, `MAE`) |

---

## 6. Notifications (`/api/notifications`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/notifications` | User/Admin JWT | Get user notifications + unread count |
| `POST` | `/api/notifications/{id}/read` | User/Admin JWT | Mark single notification as read |
| `POST` | `/api/notifications/read-all` | User/Admin JWT | Mark all notifications as read |

---

## 7. Real-Time WebSocket Stream (`/ws/parking`)

Connect to `ws://localhost:8000/ws/parking?token=<JWT_TOKEN>`

### Server-to-Client Events
- `connected`: Initial handshake confirmation + active connection count.
- `slot_updated`: Broadcast whenever an IoT sensor, QR gate, or booking changes a slot's status; includes `{ slot, location_summary }`.
- `location_updated`: Broadcast when an admin creates, updates, or deletes a location.
- `notification`: Real-time alert (`booking_confirmed`, `booking_cancelled`, `slot_available`, `expiry_alert`, `entry_exit`).
- `admin_activity`: Real-time telemetry/booking feed pushed to connected admin clients.

