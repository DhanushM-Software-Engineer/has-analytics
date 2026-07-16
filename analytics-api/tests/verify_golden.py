#!/usr/bin/env python3
"""Verify the backend still reproduces the golden fixtures — the behavior guardrail.

Run this after ANY backend change (refactor, optimization, dependency bump).
It re-executes the same API calls over the same fixed window and diffs the
results against tests/golden/. Identical output = the metrics logic is intact.

Usage:
    cd analytics-api
    PYTHONPATH="$PWD/venv/lib/python3.14/site-packages" python3.14 tests/verify_golden.py

Exit code 0 = all match. Non-zero = drift detected (differences printed).

Notes:
  - Only fields that legitimately vary run-to-run are ignored (none today —
    the API returns no timestamps-of-now; the cache key makes results stable).
  - The events lists are order-sensitive (ORDER BY event_timestamp DESC in
    every query), so a reorder is treated as drift too: deliberate.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import main  # noqa: E402

GOLDEN_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "golden")


def _canon(data):
    """Canonical JSON string — same serialization capture_golden.py used."""
    return json.dumps(data, indent=1, sort_keys=True, default=str)


def _diff_paths(a, b, path="$", out=None, limit=40):
    """Collect human-readable paths where a and b differ (bounded)."""
    if out is None:
        out = []
    if len(out) >= limit:
        return out
    if type(a) is not type(b):
        out.append(f"{path}: type {type(a).__name__} → {type(b).__name__}")
    elif isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a:
                out.append(f"{path}.{k}: MISSING in golden, present now")
            elif k not in b:
                out.append(f"{path}.{k}: present in golden, MISSING now")
            else:
                _diff_paths(a[k], b[k], f"{path}.{k}", out, limit)
    elif isinstance(a, list):
        if len(a) != len(b):
            out.append(f"{path}: length {len(a)} → {len(b)}")
        for i, (x, y) in enumerate(zip(a, b)):
            _diff_paths(x, y, f"{path}[{i}]", out, limit)
    elif a != b:
        out.append(f"{path}: {a!r} → {b!r}")
    return out


def main_():
    manifest_path = os.path.join(GOLDEN_DIR, "manifest.json")
    if not os.path.exists(manifest_path):
        print("No golden fixtures found — run capture_golden.py first.")
        sys.exit(2)
    with open(manifest_path) as f:
        manifest = json.load(f)
    from_date, to_date = manifest["from_date"], manifest["to_date"]

    failures = 0

    def check(name, fresh):
        nonlocal failures
        with open(os.path.join(GOLDEN_DIR, name)) as f:
            golden = json.load(f)
        # round-trip fresh through JSON so types match the stored form
        fresh = json.loads(_canon(fresh))
        if fresh == golden:
            print(f"  OK   {name}")
        else:
            failures += 1
            print(f"  DRIFT {name}")
            for line in _diff_paths(golden, fresh):
                print(f"        {line}")

    print(f"Verifying against golden window {from_date} → {to_date}\n")
    check("hubs.json", main.list_hubs())
    with open(os.path.join(GOLDEN_DIR, "hubs.json")) as f:
        hubs = json.load(f)["hubs"]
    for hub_id in hubs:
        safe = hub_id.replace(":", "-")
        name = f"hub_{safe}__{from_date}__{to_date}.json"
        if not os.path.exists(os.path.join(GOLDEN_DIR, name)):
            print(f"  SKIP {name} (no golden file)")
            continue
        check(name, main.hub_detail(hub_id, from_date, to_date))

    if failures:
        print(f"\n{failures} file(s) drifted — backend behavior changed.")
        sys.exit(1)
    print("\nAll golden fixtures reproduced — backend behavior intact.")


if __name__ == "__main__":
    main_()
