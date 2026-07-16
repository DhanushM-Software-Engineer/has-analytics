#!/usr/bin/env bash
#
# Build the React dashboard (web/) and refresh what the app serves (public/).
# Run this whenever you change anything under web/src/.
#
# public/ stays the single source of truth for the SERVED UI (FastAPI, Firebase
# and the Dockerfile all point at it) — after this script it contains:
#   index.html + assets/   ← built React app (from web/dist)
#   matter/                ← built Matter Node/Thread UI (untouched; rebuild
#                            separately with ./build-matter.sh)
#   404.html               ← Firebase 404 page (kept)
#
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d web/node_modules ]; then
  echo "▶ installing web dependencies (first run)…"
  ( cd web && npm i )
fi

echo "▶ building React dashboard (typecheck + vite build)…"
( cd web && npm run build )

echo "▶ syncing build → public/ (preserving matter/ and 404.html)…"
find public -mindepth 1 -maxdepth 1 ! -name matter ! -name 404.html -exec rm -rf {} +
cp -R web/dist/. public/

echo "✓ public/ refreshed — serve locally with ./analytics-api/run-local.sh, deploy with ./deploy.sh"
