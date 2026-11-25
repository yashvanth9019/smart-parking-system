# SmartPark RTD — Smart Parking Management System Using Real-Time Data

An advanced, full-stack **Real-Time Data (RTD)** Smart Parking Management System built with **Next.js**, **React**, **Tailwind CSS**, **Python FastAPI**, **MongoDB**, **WebSockets**, **Chart.js**, **Leaflet / OpenStreetMap**, **scikit-learn**, and **ESP32 IoT / Python Ultrasonic Sensor Simulation**.

---

## Key Features

- **Real-Time Live Parking Dashboard**: Instant slot updates (Green = Available, Red = Occupied, Yellow = Reserved) over WebSockets without page refreshes.
- **Interactive OpenStreetMap (Leaflet)**: Multi-location parking hub map with live color-coded availability pins, pricing, and operating hours.
- **Smart Slot Allocation & Dynamic Pricing**: Automatic best-slot recommendation (matching EV/Accessible/Standard needs and floor proximity) + surge/peak/discount multiplier calculation.
- **Atomic Double-Booking Prevention & QR Entry/Exit**: Overlap conflict detection in MongoDB, unique booking IDs (`SPK-...`), HMAC-signed PNG QR codes, and Admin QR Gate verification.
- **Real-Time Notifications & Expiry Monitor**: Live toast + notification bell alerts for booking confirmations, cancellations, freed slots, and background parking expiry warnings.
- **Admin Command Center**: Manage locations, pricing, and slots; view daily/weekly/monthly revenue analytics; scan QR gates; monitor real-time activity feed; control IoT traffic simulator.
- **Machine Learning Module**: `RandomForestRegressor` for 24-hour occupancy & peak-hour prediction and `GradientBoostingRegressor` for 7-day revenue forecasting.
- **IoT Hardware & Simulation**: Ready-to-flash ESP32 + HC-SR04 Arduino sketch (`iot_simulation/esp32_ultrasonic.ino`) and standalone Python traffic simulator (`iot_simulation/simulator.py`).

---

## Project Structure

```text
nv/
├── backend/                  # FastAPI REST API, JWT auth, RBAC, business services, pytest suite
├── database/                 # Motor async MongoDB connection, JSON schema validators, indexes, seed.py
├── websocket/                # WebSocket ConnectionManager for live slots, alerts & admin feed
├── iot_simulation/           # Python ultrasonic simulator + ESP32 HC-SR04 firmware sketch
├── machine_learning/         # scikit-learn occupancy & revenue prediction models & training CLI
├── frontend/                 # Next.js + React + Tailwind + Chart.js + Leaflet web app
├── documentation/            # API reference, DB schema & architecture, VS Code step-by-step guide
├── .env.example              # Backend & MongoDB environment template
└── README.md
```

---

## Quick Start

### 1. Prerequisites
- **Python 3.11+** (tested on Python 3.13)
- **Node.js 20+** and **npm**
- **MongoDB 7+** (`mongod` running on `mongodb://localhost:27017`)

### 2. Configure Environment
```bash
cp .env.example .env
cp frontend/.env.local.example frontend/.env.local
```

### 3. Install Backend Dependencies, Train ML Models & Seed Database
```bash
pip install -r backend/requirements.txt
python machine_learning/train.py
python -m database.seed --reset
```

### 4. Start FastAPI Backend (Terminal 1)
```bash
uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```
- Swagger API Docs: `http://localhost:8000/docs`

### 5. Start Next.js Frontend (Terminal 2)
```bash
cd frontend
npm install
npm run dev
```
- Web App: `http://localhost:3005`

### 6. Optional: Run Standalone IoT Ultrasonic Simulator (Terminal 3)
```bash
python iot_simulation/simulator.py --interval 5
```

---

## Demo Credentials

| Role | Email | Password | Portal |
|---|---|---|---|
| **Driver (User)** | `rahul@example.com` | `User@123` | `http://localhost:3005/login` |
| **Driver (EV)** | `priya@example.com` | `User@123` | `http://localhost:3005/login` |
| **Administrator** | `admin@smartpark.io` | `Admin@123` | `http://localhost:3005/admin/login` |

---

## Documentation
- [API Documentation](documentation/API_DOCUMENTATION.md)
- [Database & System Architecture](documentation/DATABASE_AND_ARCHITECTURE.md)
- [VS Code Step-by-Step Run Guide](documentation/VSCODE_SETUP_GUIDE.md)

