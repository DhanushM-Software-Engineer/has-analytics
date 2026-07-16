#!/usr/bin/env python3
"""Capture golden API fixtures — freezes the backend's *behavior*, not its code.

Snapshots the exact JSON the dashboard API returns today, so any future backend
refactor (optimization, restructuring, scaling work) can be verified to produce
identical metrics with `verify_golden.py`. The logic is the contract; these
files are the proof of it.

Usage:
    cd analytics-api
    PYTHONPATH="$PWD/venv/lib/python3.14/site-packages" python3.14 tests/capture_golden.py

Writes to tests/golden/:
    hubs.json                     — /api/hubs response
    hub_<id>__<from>__<to>.json   — /api/hub/{id} response per hub, FIXED window
    manifest.json                 — what was captured and when

A FIXED date window is used (not the moving 30-day default) so re-runs are
comparable: the underlying BigQuery rows for a past window never change.
"""
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import main  # noqa: E402  (the FastAPI app module — endpoints called directly)

# Fixed capture window — covers all real fleet data recorded so far.
FROM_DATE = "2026-06-01"
TO_DATE   = "2026-07-15"

GOLDEN_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "golden")
os.makedirs(GOLDEN_DIR, exist_ok=True)


def _dump(name: str, data) -> str:
    """Write canonical JSON (sorted keys, stable separators) for diffability."""
    path = os.path.join(GOLDEN_DIR, name)
    with open(path, "w") as f:
        json.dump(data, f, indent=1, sort_keys=True, default=str)
        f.write("\n")
    return path


def main_():
    manifest = {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "from_date": FROM_DATE,
        "to_date": TO_DATE,
        "files": [],
    }

    hubs_resp = main.list_hubs()
    print(f"/api/hubs → {len(hubs_resp['hubs'])} hubs")
    manifest["files"].append(_dump("hubs.json", hubs_resp))

    for hub_id in hubs_resp["hubs"]:
        resp = main.hub_detail(hub_id, FROM_DATE, TO_DATE)
        safe = hub_id.replace(":", "-")
        name = f"hub_{safe}__{FROM_DATE}__{TO_DATE}.json"
        path = _dump(name, resp)
        print(f"/api/hub/{hub_id} → total_activity={resp.get('total_activity')} "
              f"succ={resp.get('activity_success')} fail={resp.get('activity_fail')} "
              f"→ {os.path.basename(path)} ({os.path.getsize(path)//1024} KB)")
        manifest["files"].append(path)

    manifest["files"] = [os.path.basename(p) for p in manifest["files"]]
    _dump("manifest.json", manifest)
    print(f"\nGolden fixtures written to {GOLDEN_DIR}")


if __name__ == "__main__":
    main_()
