"""Standalone IoT ultrasonic sensor simulator streaming live occupancy events to SmartPark RTD."""

from __future__ import annotations

import argparse
import os
import random
import time
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv()


def fetch_slots(client: httpx.Client, api_url: str) -> list[dict[str, Any]]:
    resp = client.get(f"{api_url}/api/slots", timeout=10.0)
    resp.raise_for_status()
    return resp.json().get("slots", [])


def send_sensor_reading(
    client: httpx.Client,
    api_url: str,
    api_key: str,
    slot: dict[str, Any],
    occupy: bool,
) -> dict[str, Any]:
    distance_cm = round(random.uniform(18.0, 62.0), 1) if occupy else round(random.uniform(165.0, 260.0), 1)
    payload = {
        "sensor_id": slot.get("sensor_id"),
        "slot_id": slot.get("id"),
        "distance_cm": distance_cm,
        "vehicle_detected": occupy,
        "source": "simulator",
    }
    resp = client.post(
        f"{api_url}/api/iot/sensor-data",
        json=payload,
        headers={"X-IoT-Key": api_key},
        timeout=10.0,
    )
    resp.raise_for_status()
    return resp.json()


def run_simulator(api_url: str, api_key: str, interval: float, cycles: int) -> None:
    print(f"[IoT Simulator] Connecting to {api_url} (interval={interval}s, cycles={'infinite' if cycles == 0 else cycles})")
    iteration = 0
    with httpx.Client() as client:
        while cycles == 0 or iteration < cycles:
            iteration += 1
            try:
                slots = fetch_slots(client, api_url)
                eligible = [s for s in slots if s.get("status") in ("available", "occupied")]
                if not eligible:
                    print("[IoT Simulator] No available/occupied slots found to simulate.")
                    time.sleep(interval)
                    continue

                slot = random.choice(eligible)
                next_occupied = slot.get("status") == "available"
                res = send_sensor_reading(client, api_url, api_key, slot, occupy=next_occupied)
                updated = res.get("slot", {})
                print(
                    f"[Cycle {iteration}] Sensor {updated.get('sensor_id')} | "
                    f"Slot {updated.get('slot_code')} ({updated.get('location_name')}) -> "
                    f"{res.get('previous_status')} => {res.get('new_status')} "
                    f"({updated.get('last_sensor_distance_cm')} cm)"
                )
            except Exception as exc:
                print(f"[IoT Simulator] Error: {exc}")

            if cycles == 0 or iteration < cycles:
                time.sleep(interval)


def main() -> None:
    parser = argparse.ArgumentParser(description="SmartPark RTD Ultrasonic IoT Simulator")
    parser.add_argument("--api-url", default=os.getenv("IOT_API_BASE_URL", "http://localhost:8000"))
    parser.add_argument("--api-key", default=os.getenv("IOT_API_KEY", "esp32-smartpark-device-key-2026"))
    parser.add_argument("--interval", type=float, default=float(os.getenv("SIMULATOR_INTERVAL_SECONDS", "5")))
    parser.add_argument("--cycles", type=int, default=0, help="Number of simulated events (0 = run continuously)")
    args = parser.parse_args()
    run_simulator(args.api_url.rstrip("/"), args.api_key, args.interval, args.cycles)


if __name__ == "__main__":
    main()

