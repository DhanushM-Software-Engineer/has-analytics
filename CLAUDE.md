# CLAUDE.md

Guidance for Claude Code working in this repository. This is **one project**: the
Schnell Fleet Analytics dashboard **plus** an embedded, trimmed Matter Node/Thread UI.

## What this project is

- **Schnell Fleet Debugging Dashboard** — a live, BigQuery-backed analytics dashboard
  for the Schnell / Home-Assistant smart-home fleet. FastAPI backend + a vanilla-JS
  (Chart.js) single-page UI. All data comes from BigQuery (`schnell_analytics`).
- **Embedded Matter UI** — the Node and Thread views from the Matter server's own
  dashboard, trimmed to just those two features and **served by this app** at `/matter`.
  The Node/Thread tabs in the dashboard embed it (same-origin iframe); it connects to
  the hub's Matter WebSocket for live data.

## Repository layout

```
Analytics/
├── analytics-api/main.py        FastAPI backend — all BigQuery queries, serves public/
│   ├── requirements.txt
│   ├── run-local.sh             start the dashboard locally on :8080 (see venv note)
│   └── venv/                    (ignored; currently broken — see venv note)
├── public/                      UI — SINGLE SOURCE OF TRUTH (served locally + by Firebase)
│   ├── index.html, dashboard_app.js, 404.html
│   └── matter/                  BUILT Matter Node/Thread UI bundle (served at /matter)
├── matter-ui/                   Matter UI BUILD SOURCE (trimmed: dashboard + ws-client + custom-clusters)
├── build-matter.sh              rebuild matter-ui → refresh public/matter/
├── deploy.sh                    deploy to Cloud Run (API) + Firebase Hosting (UI)
├── Dockerfile, firebase.json, .firebaserc
├── .gcloudignore / .dockerignore / .gitignore
├── README.md                   project overview & quick start
└── docs/                       all reference documentation
    ├── Schnell_Analytics_Architecture.md   authoritative data-model & backend reference
    ├── FORMULAS.md             plain-language formula reference
    └── APP/HA/DOCK_TELEMETRY.md            raw BigQuery column references
```

## Commands

```bash
# Run the dashboard locally on http://localhost:8080
./analytics-api/run-local.sh        # kills :8080, then starts (Ctrl+C to stop)

# Rebuild the Matter Node/Thread UI after editing anything under matter-ui/
./build-matter.sh                   # builds matter-ui + copies bundle → public/matter/

# Deploy live (Cloud Run + Firebase)
./deploy.sh                         # full deploy
./deploy.sh --web-only              # UI-only (skips the Cloud Run rebuild)
```

> **venv note:** `analytics-api/venv` was created before the project folder was moved,
> so `venv/bin/uvicorn` won't run (stale absolute path). `run-local.sh` works around it
> by using the system `python3.14` + the venv's site-packages. To restore a normal venv:
> `cd analytics-api && rm -rf venv && python3 -m venv venv && venv/bin/pip install -r requirements.txt`.

## Data model (the important part)

All metrics are **all-source** and reconcile with their drill-downs. Full detail lives
in `docs/Schnell_Analytics_Architecture.md`; the essentials:

- **Total Events / Reliability / Failures** = app commands (`app_logs`, app-triggered
  only) + dock presses (`ha_logs`) + scene activations + automation runs (`ha_logs`).
  `Total = Success + Failures` always holds.
- **Latency / Speed / North Star** = app-command only (only `app_logs` has timestamps).
- **Hub → SNAP → Hub latency** = `snap_state_change_ts − matter_command_ts` gap (ha_logs).
- **Dock** reliability + counts from `ha_logs` (press = `call_service` tagged `dock_id`,
  success = its `context_id` produced an on/off state); `dock_logs` is usage-breakdown only.
- **Observed Change (App)** is unreliable and never shown (internal `usage.direct`).
- **Direct HA-screen control** is not counted (indistinguishable from app in `ha_logs`).
- Backend returns complete, unsampled event lists so Log Center / heatmap / Daily chart
  counts equal the summary cards exactly.

## Matter UI integration

- Node/Thread tabs load `/matter/index.html?ac=1&ip=192.168.0.41:8123&user=dhanush`
  (Thread adds `#thread`). Served same-origin from `public/matter/`.
- `?ac=1` makes the Matter UI **auto-connect** (skip its login) and **hide its own
  header/nav bar** (edits in `matter-ui/packages/dashboard/src/entrypoint/main.ts` and
  `.../pages/components/header.ts`).
- Hardcoded connection is in `public/dashboard_app.js` (`const MATTER_UI = {...}`).
- The Matter server itself (controller + WebSocket) runs on the **hub** at
  `192.168.0.41:5580` — separate from this project.

## Build / deploy gotchas

- **Build only the dashboard package**, never the matter-ui root: `cd matter-ui/packages/dashboard && npm run build` (this is what `build-matter.sh` does). The root build pulls in packages that need optional native BLE. matter-ui was trimmed to remove those.
- matter-ui wants **Node ≥ 22.13** (a 22.7 install has built it fine, but upgrade if you hit issues).
- **Deploy scope:** `.gcloudignore`/`.dockerignore` exclude `matter-ui/` (build input) but keep `public/matter/` (served). Both Cloud Run and Firebase serve `public/matter/`. `git push` + `./deploy.sh` after building.
- **No cache-busting** — Firebase serves JS/HTML with `no-cache`; do not add `?v=` query strings.
- **Live (HTTPS) limitation:** the embedded Matter UI connects to the hub over `ws://` (insecure), which a browser blocks from an HTTPS page. So on the live Firebase URL the Matter tabs load but can't fetch live data unless the hub is served over `wss://`. Over local HTTP everything works.

## Conventions

- **`public/` is the single source of truth for the UI** — edit there. There are no
  root `dashboard.html`/`dashboard_app.js` duplicates.
- Keep the all-source invariants intact when touching metrics (see architecture doc).
- Commit/push only when asked.
