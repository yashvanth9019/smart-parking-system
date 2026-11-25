"""CLI script to train/retrain SmartPark RTD machine learning models."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from machine_learning.predictor import MODEL_BUNDLE_PATH, retrain_models  # noqa: E402


def main() -> None:
    bundle = retrain_models()
    print(f"Saved ML model bundle to: {MODEL_BUNDLE_PATH}")
    print("Model Evaluation Metrics:")
    print(json.dumps(bundle["metrics"], indent=2))


if __name__ == "__main__":
    main()

