# CLAUDE.md

Guidance for Claude Code working in this repository. This is **one project**: the
Schnell Fleet Analytics dashboard **plus** an embedded, trimmed Matter Node/Thread UI.

## What this project is

- **Schnell Fleet Debugging Dashboard** — a live, BigQuery-backed analytics dashboard
  for the Schnell / Home-Assistant smart-home fleet. FastAPI backend + a **React +
  TypeScript** (Vite, Tailwind CSS v4, Chart.js, Lucide icons) single-page UI in `web/`.
  Design system v2 ("refined modern dark": zinc neutrals + indigo accent) lives in
  `web/src/styles/global.css` — all colors flow from its CSS tokens. All data comes from BigQuery
  (`schnell_analytics`).
- **Embedded Matter UI** — the Node and Thread views from the Matter server's own
  dashboard, trimmed to just those two features and **served by this app** at `/matter`.
  The Node/Thread tabs in the dashboard embed it (same-origin iframe); it connects to
  the hub's Matter WebSocket for live data. `matter-ui/` is part of this project.

## Repository layout

```
Analytics/
├── analytics-api/main.py        FastAPI backend — all BigQuery queries, serves public/
│   ├── requirements.txt
│   ├── run-local.sh             start the dashboard locally on :8080 (see venv note)
│   ├── tests/                   golden API fixtures + verify_golden.py (behavior guardrail)
│   └── venv/                    (ignored; currently broken — see venv note)
├── web/                         DASHBOARD UI SOURCE — React + TypeScript (Vite)
│   ├── src/                     types/ api/ lib/ charts/ state/ components/ modals/ views/
│   └── README.md                dev workflow & structure
├── public/                      BUILT output — what is SERVED (locally + Firebase). Never hand-edit.
│   ├── index.html, assets/      built React dashboard (from web/, via ./build-web.sh)
│   ├── matter/                  built Matter Node/Thread UI bundle (served at /matter)
│   └── 404.html                 Firebase 404 page
├── matter-ui/                   Matter UI BUILD SOURCE (trimmed: dashboard + ws-client + custom-clusters)
├── build-web.sh                 rebuild web/ → refresh public/ (preserves matter/ + 404.html)
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
# Serve the built dashboard locally on http://localhost:8080 (production path)
./analytics-api/run-local.sh        # kills :8080, then starts (Ctrl+C to stop)

# UI development with hot reload (backend must be running on :8080)
cd web && npm run dev               # http://localhost:5173 — /api & /matter proxied to :8080

# Rebuild the dashboard after editing anything under web/src/
./build-web.sh                      # typecheck + vite build → refresh public/ (keeps matter/)

# Rebuild the Matter Node/Thread UI after editing anything under matter-ui/
./build-matter.sh                   # builds matter-ui + copies bundle → public/matter/

# Verify the backend still reproduces its frozen behavior (after ANY backend change)
cd analytics-api && PYTHONPATH="$PWD/venv/lib/python3.14/site-packages" python3.14 tests/verify_golden.py

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
  only) + dock presses (`ha_logs`) + scene activations + automation runs + **direct hub
  control** (`ha_logs`). `Total = Success + Failures` always holds.
- **Sources are App / Dock / Hub.** "Hub" is one consolidated source = direct hub
  control + automation runs + scene activations (reliability-by-source + usage share).
- **Latency / Speed / North Star** = app-command only (only `app_logs` has timestamps).
- **Hub → SNAP → Hub latency** = `snap_state_change_ts − matter_command_ts` gap (ha_logs),
  capped at `SNAP_MAX_MS` (30 s) to drop stale/clock-skewed outliers.
- **Dock** reliability + counts from `ha_logs` (press = `call_service` tagged `dock_id`,
  success = its `context_id` produced an on/off state); `dock_logs` is usage-breakdown only.
- **Observed Change (App)** is unreliable and never shown (internal `usage.direct`).
- **Direct hub control** = a controllable device (light/switch/fan/…) reaching a concrete
  state with `actuation_source LIKE 'ha:%'` (excludes `ha:automation`). This is the real
  origin field — it replaces the old trigger_id anti-join, which counted HA system noise.
  Every counted event is a confirmed actuation (success); folded into the totals.
- Backend returns complete, unsampled event lists so Log Center / heatmap / Daily chart
  counts equal the summary cards exactly.

## Matter UI integration

- Node/Thread tabs load `/matter/index.html?ac=1&ip=192.168.0.41:8123&user=dhanush`
  (Thread adds `#thread`). Served same-origin from `public/matter/`.
- `?ac=1` makes the Matter UI **auto-connect** (skip its login) and **hide its own
  header/nav bar** (edits in `matter-ui/packages/dashboard/src/entrypoint/main.ts` and
  `.../pages/components/header.ts`).
- Hardcoded connection is in `web/src/lib/constants.ts` (`MATTER_UI`).
- The Matter server itself (controller + WebSocket) runs on the **hub** at
  `192.168.0.41:5580` — separate from this project.

## Build / deploy gotchas

- **Build only the dashboard package**, never the matter-ui root: `cd matter-ui/packages/dashboard && npm run build` (this is what `build-matter.sh` does). The root build pulls in packages that need optional native BLE. matter-ui was trimmed to remove those.
- matter-ui wants **Node ≥ 22.13** (a 22.7 install has built it fine, but upgrade if you hit issues).
- **Deploy scope:** `.gcloudignore`/`.dockerignore` exclude `web/` and `matter-ui/` (build inputs) but keep `public/` (built, served). Both Cloud Run and Firebase serve `public/`. `./build-web.sh` (and `./build-matter.sh` if needed) + `git push` + `./deploy.sh`.
- **No cache-busting** — Firebase serves JS/HTML with `no-cache`; Vite's hashed asset filenames are fine (inherent to the build), but do not add manual `?v=` query strings.
- **Live (HTTPS) limitation:** the embedded Matter UI connects to the hub over `ws://` (insecure), which a browser blocks from an HTTPS page. So on the live Firebase URL the Matter tabs load but can't fetch live data unless the hub is served over `wss://`. Over local HTTP everything works.

## Conventions

- **`web/` is the source of truth for the dashboard UI** — edit there, then run
  `./build-web.sh`. **Never hand-edit `public/`** — it is build output (plus the
  Matter bundle and 404.html, which `build-web.sh` preserves).
- Keep the all-source invariants intact when touching metrics (see architecture doc).
  The event pool in `web/src/lib/pool.ts` must keep reconciling exactly with the
  backend's headline numbers (verified against `analytics-api/tests/golden/`).
- After ANY backend change, run `analytics-api/tests/verify_golden.py` — backend
  behavior (metrics logic and output) is frozen by fixture.
- Commit/push only when asked.
