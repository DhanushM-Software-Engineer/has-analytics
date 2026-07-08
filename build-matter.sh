#!/usr/bin/env bash
#
# Rebuild the trimmed Matter Node/Thread UI (matter-ui/) and refresh the copy the
# analytics app serves at /matter (public/matter/). Run this whenever you change
# anything under matter-ui/. Requires Node >= 22.13 and `npm i` already run in matter-ui/.
#
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d matter-ui/node_modules ]; then
  echo "▶ installing matter-ui dependencies (first run)…"
  ( cd matter-ui && npm i )
fi

echo "▶ building Matter UI (dashboard package)…"
( cd matter-ui/packages/dashboard && npm run build )

echo "▶ copying bundle → public/matter/"
rm -rf public/matter && mkdir -p public/matter
cp -R matter-ui/packages/dashboard/dist/web/. public/matter/

echo "✓ public/matter refreshed — deploy with ./deploy.sh"
