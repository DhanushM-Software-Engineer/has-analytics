# Schnell Fleet Analytics Dashboard

A live, BigQuery-backed analytics dashboard for the Schnell / Home-Assistant smart-home
fleet — with the Matter server's **Node** and **Thread** views embedded directly in it.

One project, two parts:

1. **Analytics dashboard** — FastAPI backend + **React + TypeScript** (Vite, Chart.js)
   single-page UI. Reliability, speed, usage and per-device telemetry, all read live
   from BigQuery (`schnell-home-automation.schnell_analytics`).
2. **Embedded Matter UI** — the Node (device list) and Thread (mesh) views from the
   Matter server dashboard, trimmed to just those two features and **served by this app**
   at `/matter`. The dashboard's Node/Thread tabs embed it; it connects to the hub's
   Matter WebSocket for live data.

---

## Quick start (local)

```bash
# Serve the built dashboard on http://localhost:8080
./analytics-api/run-local.sh          # Ctrl+C to stop

# OR, for UI development with hot reload (backend must be running on :8080):
cd web && npm run dev                 # http://localhost:5173
```

Requires Google Cloud credentials with BigQuery read access
(`gcloud auth application-default login`).

> Changed UI code under `web/src/`? Rebuild what's served: `./build-web.sh`
> Changed anything under `matter-ui/`? Rebuild the Matter bundle: `./build-matter.sh`

---

## Project structure

```
Analytics/
├── analytics-api/            FastAPI backend (main.py) — all BigQuery queries; serves public/
│   ├── run-local.sh          start locally on :8080
│   └── tests/                golden API fixtures + verify_golden.py (backend behavior guardrail)
├── web/                      DASHBOARD UI SOURCE — React + TypeScript (see web/README.md)
├── public/                   BUILT output — what is served (never hand-edit)
│   ├── index.html, assets/   built React dashboard (from web/, via ./build-web.sh)
│   ├── matter/               built Matter Node/Thread UI (served at /matter)
│   └── 404.html
├── matter-ui/                Matter UI build source (trimmed to Node/Thread)
├── build-web.sh              rebuild web/ → refresh public/ (preserves matter/ + 404.html)
├── build-matter.sh           rebuild matter-ui → refresh public/matter/
├── deploy.sh                 deploy to Cloud Run + Firebase Hosting
├── Dockerfile, firebase.json, .firebaserc
├── CLAUDE.md                 guidance for Claude Code (kept at root so it auto-loads)
└── docs/                     all reference documentation
    ├── Schnell_Analytics_Architecture.md   authoritative data-model & backend reference
    ├── FORMULAS.md                         plain-language formula reference
    └── APP_TELEMETRY.md / HA_TELEMETRY.md / DOCK_TELEMETRY.md   raw column references
```

---

## The dashboard

Per hub, six tabs:

| Tab | Shows |
|---|---|
| **Overall** | Daily events + reliability, North Star (sub-1s), activity & failure heatmaps |
| **Speed** | Speed segments (App→Hub, Hub→SNAP→Hub, Hub→App), latency distribution, per-use-case |
| **Reliability** | Per-source reliability, trend, dock reliability, failures by reason/device, device activity |
| **Usage** | Source breakdown, automation/scene per day, dock usage, active devices |
| **Node** | Matter device list (embedded Matter UI) |
| **Thread** | Matter Thread network mesh (embedded Matter UI) |

**All counts are all-source** (app + dock + scene + automation) and every summary card
reconciles with its Log Center / heatmap drill-down. See `docs/Schnell_Analytics_Architecture.md`
and `docs/FORMULAS.md` for the exact sourcing and formulas.

---

## The embedded Matter UI

- The **Node** and **Thread** tabs load `/matter` (served from `public/matter/`), which
  auto-connects to the hub's Matter server WebSocket (`ws://192.168.0.41:5580/ws`) and
  shows the device list / Thread mesh with the Matter header hidden.
- Source lives in `matter-ui/` (trimmed monorepo: `dashboard` + `ws-client` +
  `custom-clusters`). Rebuild with `./build-matter.sh`.
- The connection (hub IP / user) is hardcoded in `web/src/lib/constants.ts`
  (`MATTER_UI`).

---

## Deploy

```bash
./build-web.sh           # only if you changed web/src/ (dashboard UI)
./build-matter.sh        # only if you changed matter-ui/
git push                 # optional
./deploy.sh              # Cloud Run (API) + Firebase Hosting (UI, incl. /matter)
# ./deploy.sh --web-only # UI-only changes (skips the Cloud Run rebuild)
```

- Cloud Run service: `schnell-analytics-dashboard` (region `asia-south1`).
- Firebase Hosting serves `public/` and rewrites `/api/**` to Cloud Run.
- The `web/` and `matter-ui/` **sources** are excluded from the deploy; the built
  `public/` (dashboard + `matter/`) **is** deployed to both.

> **Live (HTTPS) note:** the embedded Matter UI connects to the hub over `ws://`
> (insecure), which browsers block from an HTTPS page. On the live Firebase URL the
> Node/Thread tabs load but can't pull live data unless the hub is served over `wss://`.
> Over local HTTP (localhost / LAN IP) everything works. The Matter tabs also require the
> viewing browser to be on the same LAN as the hub.
