"""ML occupancy prediction, peak-hour analysis, and revenue forecasting using scikit-learn."""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split

ARTIFACTS_DIR = Path(__file__).resolve().parent / "artifacts"
MODEL_BUNDLE_PATH = ARTIFACTS_DIR / "parking_models.joblib"

_cached_bundle: dict[str, Any] | None = None


def _generate_training_dataset(
    extra_records: list[dict[str, Any]] | None = None,
    seed: int = 42,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Generate realistic multi-location parking time-series features for training."""
    rng = np.random.default_rng(seed)
    occ_features: list[list[float]] = []
    occ_targets: list[float] = []

    rev_features: list[list[float]] = []
    rev_targets: list[float] = []

    location_profiles = [
        {"idx": 0, "slots": 16, "rate": 60.0, "base_demand": 0.52, "commute_bias": 0.25},  # Central hub
        {"idx": 1, "slots": 12, "rate": 50.0, "base_demand": 0.48, "commute_bias": 0.30},  # Tech plaza
        {"idx": 2, "slots": 12, "rate": 40.0, "base_demand": 0.45, "commute_bias": 0.28},  # Metro park
        {"idx": 3, "slots": 8, "rate": 45.0, "base_demand": 0.42, "commute_bias": 0.20},   # IT express
    ]

    # 90 days x 24 hours x 4 locations = 8,640 hourly samples
    for day in range(90):
        dow = day % 7
        is_weekend = 1.0 if dow >= 5 else 0.0
        for loc in location_profiles:
            daily_occs: list[float] = []
            for hour in range(24):
                # Morning rush (8-11), lunch (12-14), evening peak (17-20)
                morning_peak = math.exp(-((hour - 9.5) ** 2) / 5.5) * (0.28 if not is_weekend else 0.10)
                evening_peak = math.exp(-((hour - 18.5) ** 2) / 6.0) * (0.32 if not is_weekend else 0.28)
                midday = math.exp(-((hour - 13.5) ** 2) / 9.0) * (0.16 if not is_weekend else 0.26)
                night_drop = -0.34 if (hour < 6 or hour >= 22) else 0.0
                noise = float(rng.normal(0.0, 0.045))

                occ_ratio = (
                    loc["base_demand"]
                    + loc["commute_bias"] * (morning_peak + evening_peak)
                    + midday
                    + night_drop
                    + (0.06 if is_weekend and 11 <= hour <= 20 else 0.0)
                    + noise
                )
                occ_ratio = float(np.clip(occ_ratio, 0.06, 0.97))
                daily_occs.append(occ_ratio)

                occ_features.append([float(loc["idx"]), float(hour), float(dow), is_weekend])
                occ_targets.append(occ_ratio)

            avg_occ = float(np.mean(daily_occs))
            # Daily revenue scales with occupied slot-hours, base rate, and dynamic multiplier
            dynamic_boost = 1.18 if avg_occ > 0.55 else 1.04
            daily_rev = (
                avg_occ
                * loc["slots"]
                * 10.5  # effective turnover hours/day
                * loc["rate"]
                * dynamic_boost
                * float(rng.uniform(0.92, 1.08))
            )
            rev_features.append(
                [float(loc["idx"]), float(dow), is_weekend, avg_occ, float(loc["slots"]), float(loc["rate"])]
            )
            rev_targets.append(round(daily_rev, 2))

    # Blend in any observed database records if provided
    if extra_records:
        for rec in extra_records:
            occ_features.append(
                [
                    float(rec.get("loc_idx", 0)),
                    float(rec.get("hour", 12)),
                    float(rec.get("dow", 2)),
                    float(rec.get("is_weekend", 0)),
                ]
            )
            occ_targets.append(float(np.clip(rec.get("occupancy_ratio", 0.5), 0.05, 0.98)))

    return (
        np.array(occ_features, dtype=np.float64),
        np.array(occ_targets, dtype=np.float64),
        np.array(rev_features, dtype=np.float64),
        np.array(rev_targets, dtype=np.float64),
    )


def retrain_models(extra_records: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Train occupancy & revenue ML models, save bundle to disk, and return metrics."""
    global _cached_bundle
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

    X_occ, y_occ, X_rev, y_rev = _generate_training_dataset(extra_records=extra_records)

    X_occ_tr, X_occ_te, y_occ_tr, y_occ_te = train_test_split(X_occ, y_occ, test_size=0.2, random_state=42)
    occ_model = RandomForestRegressor(n_estimators=120, max_depth=12, random_state=42, n_jobs=-1)
    occ_model.fit(X_occ_tr, y_occ_tr)
    occ_preds = occ_model.predict(X_occ_te)

    X_rev_tr, X_rev_te, y_rev_tr, y_rev_te = train_test_split(X_rev, y_rev, test_size=0.2, random_state=42)
    rev_model = GradientBoostingRegressor(n_estimators=150, max_depth=4, learning_rate=0.06, random_state=42)
    rev_model.fit(X_rev_tr, y_rev_tr)
    rev_preds = rev_model.predict(X_rev_te)

    metrics = {
        "occupancy_r2": round(float(r2_score(y_occ_te, occ_preds)), 4),
        "occupancy_mae": round(float(mean_absolute_error(y_occ_te, occ_preds)), 4),
        "revenue_r2": round(float(r2_score(y_rev_te, rev_preds)), 4),
        "revenue_mae": round(float(mean_absolute_error(y_rev_te, rev_preds)), 2),
        "training_samples_occupancy": int(len(X_occ)),
        "training_samples_revenue": int(len(X_rev)),
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }

    bundle = {
        "occupancy_model": occ_model,
        "revenue_model": rev_model,
        "metrics": metrics,
    }
    joblib.dump(bundle, MODEL_BUNDLE_PATH)
    _cached_bundle = bundle
    return bundle


def ensure_models_loaded() -> dict[str, Any]:
    """Load cached ML model bundle from disk, training if missing."""
    global _cached_bundle
    if _cached_bundle is not None:
        return _cached_bundle
    if MODEL_BUNDLE_PATH.exists():
        _cached_bundle = joblib.load(MODEL_BUNDLE_PATH)
        return _cached_bundle
    return retrain_models()


def _congestion_label(occ_pct: float) -> str:
    if occ_pct >= 80:
        return "Peak"
    if occ_pct >= 60:
        return "High"
    if occ_pct >= 35:
        return "Moderate"
    return "Low"


def predict_24h_occupancy(
    location_id: str,
    location_idx: int = 0,
    total_slots: int = 16,
    base_hourly_rate: float = 50.0,
    start_dt: datetime | None = None,
) -> dict[str, Any]:
    """Predict hourly parking occupancy and dynamic pricing multiplier for the next 24 hours."""
    bundle = ensure_models_loaded()
    occ_model: RandomForestRegressor = bundle["occupancy_model"]

    now = start_dt or datetime.now(timezone.utc)
    loc_feature = float(location_idx % 4)

    rows = []
    timestamps: list[datetime] = []
    for offset in range(24):
        ts = (now + timedelta(hours=offset)).replace(minute=0, second=0, microsecond=0)
        dow = ts.weekday()
        is_weekend = 1.0 if dow >= 5 else 0.0
        rows.append([loc_feature, float(ts.hour), float(dow), is_weekend])
        timestamps.append(ts)

    preds = occ_model.predict(np.array(rows, dtype=np.float64))
    forecast: list[dict[str, Any]] = []
    for ts, pred_ratio in zip(timestamps, preds):
        ratio = float(np.clip(pred_ratio, 0.05, 0.98))
        occ_pct = round(ratio * 100.0, 1)
        occ_slots = int(round(ratio * max(total_slots, 1)))
        avail_slots = max(total_slots - occ_slots, 0)
        mult = 1.35 if ratio >= 0.8 else (1.2 if ratio >= 0.65 else (1.1 if ratio >= 0.5 else 1.0))
        forecast.append(
            {
                "timestamp": ts.isoformat(),
                "hour_label": ts.strftime("%H:%M"),
                "predicted_occupancy_pct": occ_pct,
                "predicted_occupied_slots": occ_slots,
                "predicted_available_slots": avail_slots,
                "congestion_level": _congestion_label(occ_pct),
                "suggested_multiplier": mult,
                "estimated_rate": round(base_hourly_rate * mult, 2),
            }
        )

    best_slot = min(forecast, key=lambda x: x["predicted_occupancy_pct"])
    peak_slot = max(forecast, key=lambda x: x["predicted_occupancy_pct"])
    return {
        "location_id": location_id,
        "total_slots": total_slots,
        "forecast": forecast,
        "best_time_to_park": best_slot["hour_label"],
        "peak_time": peak_slot["hour_label"],
        "peak_occupancy_pct": peak_slot["predicted_occupancy_pct"],
        "model_metrics": bundle["metrics"],
    }


def analyze_peak_hours(location_idx: int = 0, total_slots: int = 16) -> dict[str, Any]:
    """Compute hourly weekday vs. weekend peak-hour occupancy profile."""
    bundle = ensure_models_loaded()
    occ_model: RandomForestRegressor = bundle["occupancy_model"]
    loc_f = float(location_idx % 4)

    weekday_rows = [[loc_f, float(h), 2.0, 0.0] for h in range(24)]
    weekend_rows = [[loc_f, float(h), 5.0, 1.0] for h in range(24)]

    wd_preds = np.clip(occ_model.predict(np.array(weekday_rows)), 0.05, 0.98) * 100.0
    we_preds = np.clip(occ_model.predict(np.array(weekend_rows)), 0.05, 0.98) * 100.0

    hourly_profile = []
    for h in range(24):
        wd = round(float(wd_preds[h]), 1)
        we = round(float(we_preds[h]), 1)
        avg = round((wd * 5 + we * 2) / 7.0, 1)
        hourly_profile.append(
            {
                "hour": h,
                "hour_label": f"{h:02d}:00",
                "weekday_occupancy_pct": wd,
                "weekend_occupancy_pct": we,
                "overall_avg_pct": avg,
                "estimated_occupied_slots": int(round((avg / 100.0) * max(total_slots, 1))),
            }
        )

    sorted_peak = sorted(hourly_profile, key=lambda x: x["overall_avg_pct"], reverse=True)
    sorted_quiet = sorted(hourly_profile, key=lambda x: x["overall_avg_pct"])
    return {
        "hourly_profile": hourly_profile,
        "top_peak_hours": [x["hour_label"] for x in sorted_peak[:4]],
        "off_peak_hours": [x["hour_label"] for x in sorted_quiet[:4]],
        "model_metrics": bundle["metrics"],
    }


def predict_revenue_forecast(locations: list[dict[str, Any]], days: int = 7) -> dict[str, Any]:
    """Forecast daily parking revenue across all active locations for the next N days."""
    bundle = ensure_models_loaded()
    occ_model: RandomForestRegressor = bundle["occupancy_model"]
    rev_model: GradientBoostingRegressor = bundle["revenue_model"]

    now = datetime.now(timezone.utc)
    daily_totals: list[dict[str, Any]] = []
    grand_total = 0.0

    for d_offset in range(days):
        target_date = now + timedelta(days=d_offset)
        dow = target_date.weekday()
        is_weekend = 1.0 if dow >= 5 else 0.0

        day_rev = 0.0
        loc_breakdown: list[dict[str, Any]] = []
        occ_sum = 0.0

        for idx, loc in enumerate(locations):
            loc_f = float(idx % 4)
            slots = int(loc.get("total_slots", 12) or 12)
            rate = float(loc.get("base_hourly_rate", 50.0) or 50.0)

            hours_input = np.array([[loc_f, float(h), float(dow), is_weekend] for h in range(24)])
            avg_occ = float(np.clip(np.mean(occ_model.predict(hours_input)), 0.1, 0.95))

            rev_input = np.array([[loc_f, float(dow), is_weekend, avg_occ, float(slots), rate]])
            pred_rev = max(float(rev_model.predict(rev_input)[0]), 0.0)
            pred_rev = round(pred_rev, 2)

            day_rev += pred_rev
            occ_sum += avg_occ
            loc_breakdown.append(
                {
                    "location_id": str(loc.get("id", loc.get("_id", idx))),
                    "location_name": loc.get("name", f"Location {idx + 1}"),
                    "predicted_revenue": pred_rev,
                    "predicted_avg_occupancy_pct": round(avg_occ * 100.0, 1),
                }
            )

        day_rev = round(day_rev, 2)
        grand_total += day_rev
        avg_day_occ = round((occ_sum / max(len(locations), 1)) * 100.0, 1)
        daily_totals.append(
            {
                "date": target_date.strftime("%Y-%m-%d"),
                "day_name": target_date.strftime("%a"),
                "predicted_total_revenue": day_rev,
                "avg_occupancy_pct": avg_day_occ,
                "locations": loc_breakdown,
            }
        )

    return {
        "days": days,
        "projected_total_revenue": round(grand_total, 2),
        "projected_daily_average": round(grand_total / max(days, 1), 2),
        "daily_forecast": daily_totals,
        "model_metrics": bundle["metrics"],
    }

