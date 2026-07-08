#!/usr/bin/env bash
# Run the analytics dashboard locally on :8080.
# Works around the relocated venv by using the system python3.14 + the venv packages.
cd "$(dirname "$0")"
kill -9 $(lsof -ti :8080) 2>/dev/null || true
export PYTHONPATH="$PWD/venv/lib/python3.14/site-packages"
echo "→ http://localhost:8080"
python3.14 -m uvicorn main:app --host 0.0.0.0 --port 8080
