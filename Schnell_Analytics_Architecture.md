# Schnell Fleet Analytics Architecture

This document is the authoritative reference for the live analytics system. It covers
the real data sources, the FastAPI backend, the BigQuery queries, and every formula
that drives the dashboard KPIs.

---

## The 3 Analytics Pillars

Every metric in the dashboard answers one of three questions:

| Pillar | Core Question | Primary Source |
|---|---|---|
| **Reliability** | Did it work? | `app_logs.success` |
| **Speed** | How fast was it? | `app_logs.latency_ms`, `ha_logs.ha_processing_latency_ms` |
| **Usage** | How much is it used, and from where? | `app_logs.use_case`, `dock_data.xlsx` |

---

## 1. High-Level Architecture

The analytics ecosystem is a **live, server-rendered pipeline** backed by real telemetry.

```
Flutter App / Hub
      │
      ▼
Firebase Firestore ──► BigQuery
                        schnell-home-automation.schnell_analytics
                        ├── app_logs     (app-initiated commands)
                        └── ha_logs      (HA processing events)

dock_data.xlsx           (dock hardware stats — loaded at server startup)
      │
      ▼
Analytics/analytics-api/main.py   FastAPI server (port 8080)
      │
      ├── GET /api/hubs            → list of hub IDs
      └── GET /api/hub/{hub_id}    → full hub telemetry JSON
                  │
                  ▼
      Analytics/dashboard.html + Analytics/dashboard_app.js
      (browser renders charts, tables, heatmap — no page refresh)
```

---

## Running the Dashboard Locally

```bash
# 1 — navigate to the API folder
cd Analytics/analytics-api

# 2 — create venv (first time only)
python3 -m venv venv
pip install fastapi "uvicorn[standard]" google-cloud-bigquery pyarrow openpyxl

# 3 — activate and start
source venv/bin/activate
uvicorn main:app --reload --port 8080
```

Then open **http://localhost:8080** in a browser.

If port 8080 is already in use:
```bash
lsof -ti:8080 | xargs kill -9
uvicorn main:app --reload --port 8080
```

> Google Cloud credentials must be configured (`gcloud auth application-default login`)
> and the service account must have BigQuery read access to `schnell-home-automation`.

---

## 2. File & Directory Structure

```
Analytics/
├── dashboard.html                     Single-page dashboard UI
├── dashboard_app.js                   All rendering logic (vanilla JS + Chart.js)
├── dock_data.xlsx                     Dock hardware stats — loaded once at startup
├── Schnell_Analytics_Architecture.md  This document
├── FORMULAS.md                        Formula quick-reference
└── analytics-api/
    ├── main.py                        FastAPI backend — queries BigQuery + xlsx
    ├── requirements.txt               Python dependencies
    ├── Dockerfile                     Cloud Run container definition
    └── venv/                          Local virtual environment (not committed)
```

---

## 3. Interaction Paths

Every user action falls into one of four tracked paths. These map directly to the
`use_case` column in `app_logs`.

| Path | `use_case` value | Flow | Description |
|---|---|---|---|
| Local App Control | `Local App Control` | App → Hub (HA) → SNAP → WebSocket → App | User taps a device tile in the app over local Wi-Fi; app receives state confirmation |
| Device Bind | `Device Bind (App)` | App → Hub (HA) → SNAP → WebSocket → App | User commissions or binds a device from the app |
| Remote App Control | `Remote App Control` | App → Hub (HA) → SNAP (remote path) | App controls a device over the internet when not on local Wi-Fi |
| Observed Change | `Observed Change (App)` | Dock press or automation → HA → App observes | App logs a state change it did not initiate — includes physical dock button presses and automation-triggered changes |

> **Dock button presses are not app-initiated.** When a physical dock button is pressed,
> the state change propagates through HA and the app observes it, logging it as
> `Observed Change (App)`. The dock hardware's own press counts (total / success /
> failure) come from `dock_data.xlsx`, not from app_logs.

### Speed Segment Breakdown (Local App Control path)

For every app-initiated command, four timestamps are captured:

```
┌──────────┬──────────────────┬──────────────────┬──────────────────────┐
│  App     │  REST to Hub     │  Hub → SNAP      │  WebSocket → App     │
│  (tap)   │  (command sent)  │  (HA processes)  │  (confirmation)      │
└──────────┴──────────────────┴──────────────────┴──────────────────────┘
 tap_ts    command_sent_ts    rest_response_ts    ws_confirmation_ts

Segment 1: command_sent_ts   − tap_ts             = App to Hub (REST dispatch)
Segment 2: rest_response_ts  − command_sent_ts    = Hub REST round-trip
Segment 3: ws_confirmation_ts − rest_response_ts  = Hub → SNAP → WebSocket push
Total:     ws_confirmation_ts − tap_ts            = latency_ms  (stored in app_logs)
```

North Star check: if `latency_ms < 1 000 ms` → ✅ thought-to-action under 1 second.

---

## 4. Data Sources

### A. BigQuery — `schnell_analytics.app_logs`

Every row is one command initiated from the Flutter app (or an observed state change
the app received). Primary table for all app-side KPIs.

| Column | Type | Meaning |
|---|---|---|
| `hub_id` | STRING | Hub MAC address |
| `event_timestamp` | TIMESTAMP | When the event was recorded |
| `date` | DATE | Event date (used for daily grouping) |
| `day_of_week` | STRING | e.g. "Monday" |
| `hour` | INT64 | 0–23 |
| `entity_id` | STRING | Device ID (e.g. `light.snap_living_room`) |
| `friendly_name` | STRING | Human-readable device name |
| `use_case` | STRING | Trigger category — see §3 |
| `trigger_method` | STRING | Internal trigger source field |
| `latency_ms` | INT64 | End-to-end app round-trip latency |
| `success` | BOOL | Whether the device state actually changed |
| `failure_reason` | STRING | `TIMEOUT`, `NO_RESPONSE`, `DEVICE_OFFLINE`, `THREAD_MESH_FAIL` |
| `room` | STRING | Physical room of the device |
| `network_type` | STRING | `local`, `remote` |
| `docklet_id` | STRING | Populated when a dock docklet is involved |
| `tap_ts` | TIMESTAMP | When user tapped in the app |
| `command_sent_ts` | TIMESTAMP | When REST command left the app |
| `rest_response_ts` | TIMESTAMP | When hub responded to the REST call |
| `ws_confirmation_ts` | TIMESTAMP | When WebSocket state confirmation arrived |

### B. BigQuery — `schnell_analytics.ha_logs`

Every row is one event processed by Home Assistant on the hub. Used for HA processing
latency and dock-to-hub linking.

| Column | Type | Meaning |
|---|---|---|
| `hub_id` | STRING | Hub MAC address |
| `event_timestamp` | TIMESTAMP | When HA processed the event |
| `entity_id` | STRING | Device ID |
| `friendly_name` | STRING | Human-readable device name |
| `ha_event_type` | STRING | HA internal event type |
| `ha_processing_latency_ms` | INT64 | Time from HA receipt to SNAP command |
| `matter_command_ts` | TIMESTAMP | When HA issued the Matter command |
| `snap_state_change_ts` | TIMESTAMP | When the SNAP state actually changed |
| `dock_id` | STRING | Dock ID — used to link ha_logs rows to dock_data.xlsx |
| `room` | STRING | Physical room |

### C. `dock_data.xlsx`

Loaded once at server startup into `_DOCK_ROWS`. Contains the dock hardware's own
internal press-count records. Each row is one docklet's stats for one date.

| Column | Meaning |
|---|---|
| `dock_id` | Physical dock ID (unique per dock unit) |
| `docklet_id` | Docklet ID (one dock has multiple docklets) |
| `date` | Date of the record |
| `day_of_week` | e.g. "Monday" |
| `action` | Button action type (`toggle`, `increment`, `decrement`) |
| `total_action_count` | Total times this docklet was pressed |
| `success_count` | Presses that completed successfully |
| `failure_count` | Presses that failed internally |

**Hub ↔ dock linking:** `ha_logs.dock_id` is used to find which dock IDs belong to
a given hub. Rows in `dock_data.xlsx` whose `dock_id` appears in that hub's `ha_logs`
are included in the hub's dock stats.

---

## 5. Mathematical Formulas & Core KPIs

All time-windowed queries use:
```sql
WHERE hub_id = @hub_id
  AND DATE(event_timestamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
```

### 5.1 Top-Level KPIs  *(source: app_logs)*

| Field | Formula |
|---|---|
| `total` | `COUNT(*)` |
| `success` | `COUNTIF(success = true)` |
| `reliability` | `ROUND(100 × success / total, 2)` |

**Example:** 150 app triggers → 147 confirmations → 3 failures
→ Reliability = 147 / 150 × 100 = **98.0%**

### 5.2 Speed Segments

**Local E2E** — full round-trip from app tap to WebSocket confirmation
*(source: app_logs, latency_ms IS NOT NULL)*

| Metric | Formula |
|---|---|
| avg | `ROUND(AVG(latency_ms))` |
| p50 | `APPROX_QUANTILES(latency_ms, 100)[OFFSET(50)]` |
| p95 | `APPROX_QUANTILES(latency_ms, 100)[OFFSET(95)]` |

**Example:** tap_ts = 08:15:32.100, ws_confirmation_ts = 08:15:32.580
→ latency_ms = **480 ms** ✅ under 1 second

**Hub → SNAP → Hub** — HA processing time from receipt to state change
*(source: ha_logs, ha_processing_latency_ms IS NOT NULL)*

| Metric | Formula |
|---|---|
| avg | `ROUND(AVG(ha_processing_latency_ms))` |
| p50 | `APPROX_QUANTILES(ha_processing_latency_ms, 100)[OFFSET(50)]` |
| p95 | `APPROX_QUANTILES(ha_processing_latency_ms, 100)[OFFSET(95)]` |

**Hub → App (WebSocket Push)** — time from hub confirming state to app reflecting it
*(source: derived client-side from local_e2e events)*

| Metric | How it's computed |
|---|---|
| P50 (server-side proxy) | Approximated as `hub_snap_hub.p50` (no dedicated field yet) |
| Per-event | `ws_confirmation_ts − rest_response_ts` derived from each local_e2e event |

**Remote E2E** — full round-trip via internet: App send → Hub → SNAP → state back to App
*(source: app_logs WHERE use_case = 'Remote App Control')*

| Metric | Formula |
|---|---|
| avg | `ROUND(AVG(latency_ms))` |
| p50 | `APPROX_QUANTILES(latency_ms, 100)[OFFSET(50)]` |
| p95 | `APPROX_QUANTILES(latency_ms, 100)[OFFSET(95)]` |

*(Returns 0,0,0 until remote events are available in the window.)*

**Per Use-Case Speed** — same latency stats grouped by `use_case`
*(source: app_logs)*

### 5.3 Latency Buckets  *(source: app_logs)*

| Bucket | Range |
|---|---|
| `<500ms` | latency_ms < 500 |
| `500-1000ms` | 500 ≤ latency_ms < 1000 |
| `1-2s` | 1000 ≤ latency_ms < 2000 |
| `2-5s` | 2000 ≤ latency_ms < 5000 |
| `>5s` | latency_ms ≥ 5000 |

Count = `COUNT(*)` per bucket.

### 5.4 Daily Trend  *(source: app_logs, grouped by date)*

| Field | Formula |
|---|---|
| `total` | `COUNT(*)` |
| `rel` | `ROUND(100 × COUNTIF(success) / COUNT(*), 2)` |
| `p50` | `APPROX_QUANTILES(latency_ms, 100 IGNORE NULLS)[OFFSET(50)]` |
| `ns` (North Star) | `ROUND(100 × COUNTIF(latency_ms < 1000) / NULLIF(COUNTIF(latency_ms IS NOT NULL), 0), 2)` |

North Star target: ≥ 85% of events under 1 000 ms.

### 5.5 Activity Heatmap  *(source: app_logs, grouped by day_of_week × hour)*

| Breakdown key | Filter |
|---|---|
| `app` | use_case IN ('Local App Control', 'Device Bind (App)') |
| `remote` | use_case = 'Remote App Control' |
| `auto` | use_case = 'Observed Change (App)' |
| `events` | COUNT(*) — all use cases combined |

Key format: `"Monday_14"` (day + underscore + hour).

### 5.6 Reliability Detail  *(source: app_logs + dock_data.xlsx)*

**App Trigger → Feedback**
- Numerator: `COUNTIF(success = true)` where use_case contains "App Control" (covers Local + Remote)
- Denominator: `COUNT(*)` same filter
- Formula: `ROUND(100 × numerator / denominator, 2)`

**Dock Trigger → Feedback** — sourced from `dock_data.xlsx`
- Numerator: `sum(success_count)` across all docklets for this hub in the days window
- Denominator: `sum(total_action_count)` same scope
- Formula: `ROUND(100 × numerator / denominator, 2)`
- Dashboard renders as: `dockRel = sum(dock_stats[].success) / sum(dock_stats[].total) × 100`

**Dock → Hub Transit** — physical presses that reached Home Assistant
- Numerator: `COUNT(*)` from ha_logs WHERE dock_id IS NOT NULL for this hub in window
- Denominator: `sum(total_action_count)` from dock_data.xlsx for this hub
- Formula: `ROUND(100 × numerator / denominator, 2)`
- Measures Thread mesh delivery rate (what % of button presses HA actually processed)

**Hub → App Confirm** — HA-issued commands that resulted in confirmed app feedback
- Numerator: `app_feedbacks` (successful app-triggered events from app_logs)
- Denominator: `hub_to_snap_count` = `COUNT(*)` from ha_logs for hub in window
- Formula: `ROUND(100 × app_feedbacks / hub_to_snap_count, 2)`

**Per-Source Reliability** — grouped by `use_case`:
- `total`, `success`, `fail` = COUNT per group
- `rel` = `ROUND(100 × success / total, 2)`

**Dock Reliability** — sourced entirely from `dock_data.xlsx` (not app_logs):
- Rows filtered to this hub via `ha_logs.dock_id` lookup
- Grouped by `dock_id` — one entry per physical dock
- `total` = sum of `total_action_count` across all docklets in the dock
- `success` = sum of `success_count`
- `failure` = sum of `failure_count`
- `rel` = `ROUND(100 × success / total, 2)`
- `docklets[]` = per-docklet breakdown (same fields) with `actions[]` sub-array per action type

### 5.7 Usage (Source Breakdown)  *(source: app_logs)*

| Field | Formula |
|---|---|
| `app` | `COUNTIF(use_case IN ('Local App Control', 'Device Bind (App)'))` |
| `remote` | `COUNTIF(use_case = 'Remote App Control')` |
| `direct` | `COUNTIF(use_case = 'Observed Change (App)')` |
| `app_ratio` | `ROUND(100 × app / (app + docklet), 2)` |
| `dock_ratio` | `ROUND(100 × docklet / (app + docklet), 2)` |
| `scene_per_day` | `ROUND(direct / days, 2)` |

### 5.8 Device Activity  *(source: app_logs, grouped by entity_id)*

| Field | Formula |
|---|---|
| `total` | `COUNT(*)` |
| `success` | `COUNTIF(success = true)` |
| `rel` | `ROUND(100 × success / total, 2)` |
| `p50` | `APPROX_QUANTILES(latency_ms, 100 IGNORE NULLS)[OFFSET(50)]` |

Top 50 devices by total event count.

### 5.9 Failures

**By reason** — `app_logs WHERE success = false AND failure_reason IS NOT NULL`, grouped by `failure_reason`
Known values: `TIMEOUT`, `NO_RESPONSE`, `DEVICE_OFFLINE`, `THREAD_MESH_FAIL`

**By device** — `app_logs WHERE success = false`, grouped by `entity_id` + `failure_reason`

### 5.10 Dock Usage  *(source: dock_data.xlsx)*

| Field | Formula |
|---|---|
| `total` | Sum of all `total_action_count` rows for this hub |
| `by_action` | Dict: action → sum of `total_action_count` |
| `by_docklet` | Dict: docklet_id → sum of `total_action_count` |
| `daily[]` | Per-date: total / success / failure / rel |

---

## 6. Backend Processing Logic (`analytics-api/main.py`)

The FastAPI backend runs a set of BigQuery queries per request and returns a single
JSON object that `dashboard_app.js` reads directly. No state is held between requests.

### Startup
- `_DOCK_ROWS` is populated once from `dock_data.xlsx` using `openpyxl`.
- `_dock_rows_for_hub(hub_id, days)` filters `_DOCK_ROWS` to rows whose `dock_id`
  appears in `ha_logs` for that hub and whose `date` falls within the window.

### Per-request flow (`GET /api/hub/{hub_id}?days=30`)

1. **Top-level KPIs** — single aggregation query on app_logs
2. **Local E2E speed** — AVG/P50/P95 on `latency_ms` + sample events
3. **Hub→SNAP→Hub speed** — same on `ha_processing_latency_ms` from ha_logs
4. **Per use-case speed** — grouped by `use_case` + sample events per group
5. **Latency buckets** — CASE-based bucketing for bar chart (counts + sample events)
6. **Daily trend** — per-date reliability, p50, north star
7. **Heatmap** — day_of_week × hour event counts split by use case
8. **Failures** — last 100 failed events; grouped by reason; grouped by device
9. **Reliability detail** — per-source reliability; app trigger feedback; dock stats from xlsx
10. **Per-device activity** — top-50 devices by event count with latency
11. **Usage** — use-case source breakdown counts and ratios
12. **Dock usage** — xlsx aggregation by action / docklet / date

---

## 7. UI Logic (`dashboard_app.js`)

Vanilla JavaScript application. No framework dependencies beyond Chart.js.

### State

| Global | Purpose |
|---|---|
| `D` | Cache object — `D[hub_id]` holds the JSON returned by `/api/hub/{id}` |
| `activeHub` | Currently selected hub ID; `null` = fleet overview |
| `_dockSortAsc` | Sort direction for the Dock Reliability table |
| `_lastDockStats` | Cached dock stats for sort re-render without re-fetch |

### Render functions

| Function | Tab / View |
|---|---|
| `renderLanding()` | Fleet overview — aggregates across all `D[hub]` entries |
| `renderDetail(hub)` | Hub drill-down entry point |
| `renderSpeed(d)` | Speed tab — latency charts, buckets, per-UC table |
| `renderReliability(d)` | Reliability tab — per-source table, trend chart, dock table, failures |
| `renderUsage(d)` | Usage tab — source doughnut, dock usage panel |
| `renderLogCenter(opts)` | Log Center — searchable raw event table |
| `_renderDockTable(stats)` | Dock Reliability table — sorted by failure count |

### Reliability thresholds (applied as CSS tag classes)

| Range | Class | Colour |
|---|---|---|
| > 97% | `tag-green` | Green |
| 93% – 97% | `tag-yellow` | Yellow |
| < 93% | `tag-red` | Red |

---

## 8. Dashboard Panels

| Panel | Chart Type | Data |
|---|---|---|
| Reliability Trend | Line chart (daily) | Reliability % per day |
| Speed Distribution | Bar chart | Latency bucket event counts |
| North Star | Single KPI | % events completing < 1 000 ms |
| Activity Heatmap | Heatmap (hour × day) | Event count per hour block |
| Source Breakdown | Doughnut chart | App vs Observed vs Remote |
| Per Use-Case Speed | Grouped bar + table | Avg / P50 / P95 per use case |
| Per-Source Reliability | Table | Reliability by use_case value |
| Dock Reliability | Sortable table | Per dock: total / success / failure / rel / docklets |
| Device Activity | Table | Top 50 devices by event count with P50 latency |
| Failures by Reason | Table | Failure counts + sample events per reason |
| Failures by Device | Table | Devices ranked by failure count with reasons |
| Log Center | Searchable table | Raw event rows from app_logs with filters |

---

## 9. Unified Event Schema (`app_logs` row)

```json
{
  "event_id": "<uuid>",
  "hub_id": "<mac-address>",
  "event_timestamp": "2026-03-06T08:15:32.100Z",
  "date": "2026-03-06",
  "day_of_week": "Friday",
  "hour": 8,
  "use_case": "Local App Control",
  "entity_id": "light.snap_living_room",
  "friendly_name": "Living Room Light",
  "trigger_method": "app",
  "latency_ms": 480,
  "success": true,
  "failure_reason": null,
  "room": "living_room",
  "network_type": "local",
  "docklet_id": null,
  "tap_ts": "2026-03-06T08:15:32.100Z",
  "command_sent_ts": "2026-03-06T08:15:32.150Z",
  "rest_response_ts": "2026-03-06T08:15:32.420Z",
  "ws_confirmation_ts": "2026-03-06T08:15:32.580Z"
}
```

---

## 10. API Endpoints

| Endpoint | Returns |
|---|---|
| `GET /api/hubs` | `{ "hubs": ["<hub_id>", ...] }` |
| `GET /api/hub/{hub_id}?days=N` | Full telemetry JSON (see §6); days 1–90, default 30 |
| `GET /` | Serves `dashboard.html` |
| `GET /<file>` | Serves any static file from the Analytics/ directory |

---

## 11. Running the Server

### First-time setup (once only)

```bash
cd Analytics/analytics-api

# Create virtual environment
python3 -m venv venv

# Activate it
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Authenticate with Google Cloud (opens browser)
gcloud auth application-default login \
  --scopes=https://www.googleapis.com/auth/cloud-platform
```

### Every time you want to run the dashboard

```bash
cd Analytics/analytics-api
source venv/bin/activate
uvicorn main:app --reload --port 8080
```

Then open **http://localhost:8080** in the browser.
The `--reload` flag auto-restarts the server on every save to `main.py`.

### Stop the server

Press **Ctrl + C** in the terminal.

### Restart (port already in use)

```bash
kill -9 $(lsof -ti :8080)
uvicorn main:app --reload --port 8080
```

### VSCode — remove import errors in `main.py`

1. **Cmd + Shift + P** → `Python: Select Interpreter`
2. Click **Enter interpreter path...**
3. Paste: `Analytics/analytics-api/venv/bin/python3`
4. **Cmd + Shift + P** → `Developer: Reload Window`

---

## 12. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `DefaultCredentialsError` on startup | GCP credentials expired | Run `gcloud auth application-default login --scopes=https://www.googleapis.com/auth/cloud-platform` |
| `Internal Server Error` on `/api/hub/{id}` | BigQuery SQL issue or missing column | Check uvicorn terminal for the full Python traceback |
| Dashboard opens but shows no data | JS error or fetch failure | Open browser DevTools → Console tab |
| `command not found: uvicorn` | venv not activated | Run `source venv/bin/activate` first |
| `[Errno 48] Address already in use` | Port 8080 taken by previous process | Run `kill -9 $(lsof -ti :8080)` then restart |
