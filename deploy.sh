#!/usr/bin/env bash
#
# Deploy the Schnell Analytics dashboard.
#
#   ./deploy.sh            full deploy — Cloud Run (API) + Firebase Hosting (UI)
#   ./deploy.sh --web-only UI only — skips the slow Cloud Run container rebuild
#                          (use when you only changed public/index.html or
#                           public/dashboard_app.js)
#
# The UI lives in public/ (single source of truth — no copy step). Firebase
# serves those files with a no-cache header, so browsers always fetch the
# latest build without any manual version bump.
#
set -euo pipefail
cd "$(dirname "$0")"

if [[ "${1:-}" != "--web-only" ]]; then
  echo "▶ deploying backend to Cloud Run"
  gcloud run deploy schnell-analytics-dashboard \
    --source . --region asia-south1 --project schnell-home-automation
else
  echo "▶ --web-only: skipping Cloud Run deploy"
fi

echo "▶ deploying frontend to Firebase Hosting"
firebase deploy --only hosting

echo "✓ deploy complete"
