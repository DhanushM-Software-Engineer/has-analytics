# Schnell Fleet Analytics Dashboard

A live, BigQuery-backed analytics dashboard for the Schnell / Home-Assistant smart-home
fleet — with the Matter server's **Node** and **Thread** views embedded directly in it.

One project, two parts:

1. **Analytics dashboard** — FastAPI backend + vanilla-JS (Chart.js) single-page UI.
   Reliability, speed, usage and per-device telemetry, all read live from BigQuery
   (`schnell-home-automation.schnell_analytics`).
2. **Embedded Matter UI** — the Node (device list) and Thread (mesh) views from the
   Matter server dashboard, trimmed to just those two features and **served by this app**
   at `/matter`. The dashboard's Node/Thread tabs embed it; it connects to the hub's
   Matter WebSocket for live data.

---

## Quick start (local)

```bash
# Run the dashboard on http://localhost:8080
./analytics-api/run-local.sh          # Ctrl+C to stop
```

Then open **http://localhost:8080**. Requires Google Cloud credentials with BigQuery
read access (`gcloud auth application-default login`).

> If you changed anything under `matter-ui/`, rebuild the embedded Matter bundle first:
> `./build-matter.sh`

---

## Project structure

```
Analytics/
├── analytics-api/            FastAPI backend (main.py) — all BigQuery queries; serves public/
│   └── run-local.sh          start locally on :8080
├── public/                   UI (single source of truth — served locally and by Firebase)
│   ├── index.html
│   ├── dashboard_app.js      all rendering logic (vanilla JS + Chart.js)
│   └── matter/               BUILT Matter Node/Thread UI (served at /matter)
├── matter-ui/                Matter UI build source (trimmed to Node/Thread)
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
- The connection (hub IP / user) is hardcoded in `public/dashboard_app.js`
  (`const MATTER_UI = {...}`).

---

## Deploy

```bash
git push                 # optional
./build-matter.sh        # only if you changed matter-ui/
./deploy.sh              # Cloud Run (API) + Firebase Hosting (UI, incl. /matter)
# ./deploy.sh --web-only # UI-only changes (skips the Cloud Run rebuild)
```

- Cloud Run service: `schnell-analytics-dashboard` (region `asia-south1`).
- Firebase Hosting serves `public/` and rewrites `/api/**` to Cloud Run.
- The `matter-ui/` **source** is excluded from the deploy; the built `public/matter/`
  bundle **is** deployed to both.

> **Live (HTTPS) note:** the embedded Matter UI connects to the hub over `ws://`
> (insecure), which browsers block from an HTTPS page. On the live Firebase URL the
> Node/Thread tabs load but can't pull live data unless the hub is served over `wss://`.
> Over local HTTP (localhost / LAN IP) everything works. The Matter tabs also require the
> viewing browser to be on the same LAN as the hub.
