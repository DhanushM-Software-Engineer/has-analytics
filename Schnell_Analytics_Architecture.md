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
| **Usage** | How much is it used, and from where? | `app_logs.use_case`, `dock_logs` |

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
                        ├── ha_logs      (HA processing events)
                        └── dock_logs    (dock Google Sheet — auto-synced on every
                                          edit by its embedded Apps Script)
      │
      ▼
Analytics/analytics-api/main.py   FastAPI server (port 8080)
      │
      ├── GET /api/hubs            → list of hub IDs
      └── GET /api/hub/{hub_id}    → full hub telemetry JSON
                  │
                  ▼
      Analytics/dashboard.html + Analytics/dashboard_app.js
      (browser renders charts, tables, heatmaps — no page refresh)
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
venv/bin/uvicorn main:app --reload --host 0.0.0.0 --port 8080
```

Then open **http://localhost:8080** in a browser.

If port 8080 is already in use:
```bash
kill -9 $(lsof -ti :8080)
venv/bin/uvicorn main:app --reload --host 0.0.0.0 --port 8080
```

> Google Cloud credentials must be configured (`gcloud auth application-default login`)
> and the service account must have BigQuery read access to `schnell-home-automation`.

---

## 2. File & Directory Structure

```
Analytics/
├── dashboard.html                     Single-page dashboard UI
├── dashboard_app.js                   All rendering logic (vanilla JS + Chart.js)
├── Schnell_Analytics_Architecture.md  This document
├── FORMULAS.md                        Formula quick-reference
├── dock_sheet_apps_script.gs          Apps Script for the Google Sheet (auto-sync to BigQuery)
└── analytics-api/
    ├── main.py                        FastAPI backend — all data from BigQuery
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
| Observed Change | `Observed Change (App)` | Dock press or automation → HA → App observes | App logs a state change it did not initiate — includes physical dock button presses, automation-triggered changes, and scene activations |

> **Dock button presses are not app-initiated.** When a physical dock button is pressed,
> the state change propagates through HA and the app observes it, logging it as
> `Observed Change (App)`. The dock hardware's own press counts (total / success /
> failure) come from the dock sheet (`dock_logs` table), not from app_logs.

> **Scenes & automations** — the **Scene / Day** and **Automation / Day** tiles are
> counted from **ha_logs** (hub-recorded — the hub records every activation even when
> the app is closed, making it the reliable source). App-observed counts are kept only
> as reference fields (`scene_total`, `scene_per_day`, `observed_per_day`): the app
> misses events while closed and can log state-restore bursts as false activations.

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
| `event_timestamp` | STRING (ISO timestamp) | When the event was recorded |
| `date` | STRING (YYYY-MM-DD) | Event date (used for daily grouping) |
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
| `tap_ts` | STRING (ISO timestamp) | When user tapped in the app |
| `command_sent_ts` | STRING (ISO timestamp) | When REST command left the app |
| `rest_response_ts` | STRING (ISO timestamp) | When hub responded to the REST call |
| `ws_confirmation_ts` | STRING (ISO timestamp) | When WebSocket state confirmation arrived |

> All timestamp columns are stored as **STRING** in BigQuery — queries that do
> timestamp math must use `SAFE_CAST(... AS TIMESTAMP)` (see Hub→App in §5.2).

### B. BigQuery — `schnell_analytics.ha_logs`

Every row is one event processed by Home Assistant on the hub. Used for HA processing
latency, hub-recorded scene/automation counts, and dock-to-hub linking.

| Column | Type | Meaning |
|---|---|---|
| `hub_id` | STRING | Hub MAC address |
| `event_timestamp` | STRING (ISO timestamp) | When HA processed the event |
| `entity_id` | STRING | Device ID |
| `friendly_name` | STRING | Human-readable device name |
| `ha_event_type` | STRING | HA internal event type (`state_changed`, `call_service`, `automation_triggered`, …) |
| `ha_processing_latency_ms` | INT64 | Time from HA receipt to SNAP command — currently always 0 (hub-side gap) |
| `matter_command_ts` | STRING (ISO timestamp) | When HA issued the Matter command — currently identical to snap_state_change_ts (hub-side gap) |
| `snap_state_change_ts` | STRING (ISO timestamp) | When the SNAP state actually changed |
| `dock_id` | STRING | Dock ID — links ha_logs rows to the dock sheet |
| `room` | STRING | Physical room |

### C. BigQuery — `schnell_analytics.dock_logs` (the dock sheet)

The dashboard reads dock data from the `dock_logs` BigQuery table, which mirrors
the dock sheet. Contains the dock hardware's own internal press-count records.
Each row is one docklet's stats for one date.

| Column | Meaning |
|---|---|
| `hub_id` | Hub MAC address — scopes dock data to its hub (same as app_logs / ha_logs) |
| `date` | Date of the record (YYYY-MM-DD string) |
| `day_of_week` | e.g. "Monday" |
| `dock_id` | Physical dock ID (unique per dock unit) |
| `docklet_id` | Docklet ID (one dock has multiple docklets) |
| `action` | Button action type (`toggle`, `increment`, `decrement`) |
| `total_action_count` | Total times this docklet was pressed |
| `success_count` | Presses that completed successfully |
| `failure_count` | Presses that failed internally |

**Hub ↔ dock linking:** dock rows carry a `hub_id` column and are filtered by
`hub_id` + date range, exactly like app_logs and ha_logs.

**How dock_logs gets its data — Google Sheet + Apps Script auto-sync:**

The dock sheet lives in Google Sheets. An Apps Script inside the Sheet
(`Analytics/dock_sheet_apps_script.gs`) fires on every change and replaces the
`dock_logs` table with the sheet's current rows (WRITE_TRUNCATE) — BigQuery always
mirrors the Sheet within seconds of any edit. dock_logs stays a native table, so no
Drive scope or admin action is needed (the Workspace policy blocks Drive-scoped
gcloud credentials, which rules out the external-table approach).

---

## 5. Mathematical Formulas & Core KPIs

All time-windowed queries use `from_date` and `to_date` parameters:
```sql
WHERE hub_id = @hub_id
  AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
```
Default window: last 30 days. Maximum: 90 days. Both dates are ISO-8601 strings.

### 5.1 Top-Level KPIs  *(source: app_logs)*

| Field | Formula |
|---|---|
| `total` | `COUNT(*)` |
| `success` | `COUNTIF(success = true)` |
| `reliability` | `COALESCE(ROUND(100 × success / NULLIF(total, 0), 2), 0)` — safe for zero-event windows |

**Example:** 150 app triggers → 147 confirmations → 3 failures
→ Reliability = 147 / 150 × 100 = **98.0%**

### 5.2 Speed Segments

**Local E2E** — displayed as **App Control (Local)** — full round-trip from app tap to WebSocket confirmation
*(source: app_logs WHERE use_case IN ('Local App Control', 'Device Bind (App)') AND latency_ms IS NOT NULL)*

| Metric | Formula |
|---|---|
| avg | `ROUND(AVG(latency_ms))` |
| p50 | `APPROX_QUANTILES(latency_ms, 100)[OFFSET(50)]` |
| p95 | `APPROX_QUANTILES(latency_ms, 100)[OFFSET(95)]` |
| stddev | `ROUND(STDDEV(latency_ms))` |

**Example:** tap_ts = 08:15:32.100, ws_confirmation_ts = 08:15:32.580
→ latency_ms = **480 ms** ✅ under 1 second

**Hub → SNAP → Hub** — HA processing time from receipt to state change
*(source: ha_logs WHERE ha_processing_latency_ms IS NOT NULL)*

| Metric | Formula |
|---|---|
| avg | `ROUND(AVG(ha_processing_latency_ms))` |
| p50 | `APPROX_QUANTILES(ha_processing_latency_ms, 100)[OFFSET(50)]` |
| p95 | `APPROX_QUANTILES(ha_processing_latency_ms, 100)[OFFSET(95)]` |

> Currently shows "No data" because `ha_processing_latency_ms` is populated as 0 by
> the hub — the dashboard correctly suppresses the segment when avg = 0 and p50 = 0.
> Clicking a no-data segment opens an explanation modal (instead of misleading
> zero-latency sample events).

**Hub → App (WebSocket Push)** — time from hub REST response to WebSocket confirmation at app
*(source: app_logs, computed server-side over the FULL selected period)*

| Metric | Formula |
|---|---|
| Per-event latency | `TIMESTAMP_DIFF(ws_confirmation_ts, rest_response_ts, MILLISECOND)` |
| avg | `ROUND(AVG(diff))` over all local_e2e events with both timestamps |
| p50 / p95 | `APPROX_QUANTILES(diff, 100)[OFFSET(50/95)]` |

Rows where `diff < 0` (clock skew — ws_conf recorded before rest_resp) are excluded.
Timestamps are stored as STRING in BigQuery, so the query uses `SAFE_CAST(... AS TIMESTAMP)`.
The frontend still derives a per-event list from the local_e2e samples, but only for
the modal's sample table — the card's avg/p50/p95 come from the backend.

**Remote E2E** — displayed as **App Control (Remote)** — full round-trip via internet
*(source: app_logs WHERE use_case = 'Remote App Control')*

Returns avg/p50/p95 = 0 and is displayed as "Not tracked" until remote events exist.

**Per Use-Case Speed** — latency stats grouped by `use_case` with Std Dev
*(source: app_logs WHERE latency_ms IS NOT NULL)*

| Metric | Formula |
|---|---|
| avg | `ROUND(AVG(latency_ms))` |
| p50 | `APPROX_QUANTILES(latency_ms, 100)[OFFSET(50)]` |
| p95 | `APPROX_QUANTILES(latency_ms, 100)[OFFSET(95)]` |
| stddev | `ROUND(STDDEV(latency_ms))` |
| count | `COUNT(*)` |
| success | `COUNTIF(success = true)` |

### 5.3 Latency Buckets  *(source: app_logs)*

| Bucket label | Range | Color on chart |
|---|---|---|
| `<500ms` | latency_ms < 500 | Green |
| `500-1000ms` | 500 ≤ latency_ms < 1000 | Yellow |
| `1-2s` | 1000 ≤ latency_ms < 2000 | Orange |
| `2-5s` | 2000 ≤ latency_ms < 5000 | Red |
| `>5s` | latency_ms ≥ 5000 | Deep Red |

Count = `COUNT(*)` per bucket.

### 5.4 Daily Trend  *(source: app_logs, grouped by date)*

| Field | Formula |
|---|---|
| `total` | `COUNT(*)` |
| `rel` | `ROUND(100 × COUNTIF(success) / COUNT(*), 2)` |
| `p50` | `APPROX_QUANTILES(latency_ms, 100 IGNORE NULLS)[OFFSET(50)]` |
| `ns` (North Star) | `ROUND(100 × COUNTIF(latency_ms < 1000) / NULLIF(COUNTIF(latency_ms IS NOT NULL), 0), 2)` |

North Star target: ≥ 95% of events under 1 000 ms.
NS denominator excludes events with NULL latency (e.g. observed changes without timing).
The dashboard tile shows the **Period Average** — the unweighted mean of the daily NS values.

### 5.5 Activity Heatmap  *(source: app_logs, grouped by day_of_week × hour)*

| Breakdown key | Filter |
|---|---|
| `app` | use_case IN ('Local App Control', 'Device Bind (App)') |
| `dock` | use_case = 'Docklet Press (App)' |
| `remote` | use_case = 'Remote App Control' |
| `auto` | use_case = 'Observed Change (App)' |
| `events` | COUNT(*) — all use cases combined |

Key format: `"Monday_14"` (day + underscore + hour).
Tooltip shows: App · Dock · Remote · Observed counts for that cell.
Click → Log Center filtered to that hour.

### 5.6 Failures Heatmap  *(source: app_logs WHERE success = false, grouped by day_of_week × hour)*

Same grid structure as the Activity Heatmap. Cell value = `COUNT(*)` of failures in
that time slot. Red intensity scale — darker red = more failures.

| Field | Formula |
|---|---|
| `events` | `COUNT(*) WHERE success = false` |

Key format: `"Friday_12"` (same as Activity Heatmap keys).
Click → Log Center → Failures tab filtered to that hour.

### 5.7 Reliability Detail  *(source: app_logs + dock_logs)*

**App Trigger → Feedback**
- `a_rows` = src_rel rows where use_case contains "App Control"
- Numerator (`as_`): `sum(success)` across `a_rows`
- Denominator (`at`): `sum(total)` across `a_rows`
- Formula: `ROUND(100 × as_ / at, 2)`

**Dock Trigger Reliability** — sourced from `dock_logs`
- Numerator: `sum(success_count)` across all docklets for this hub in the date window
- Denominator: `sum(total_action_count)` same scope
- Formula: `ROUND(100 × numerator / denominator, 2)`
- Dashboard renders as: `dockRel = sum(dock_stats[].success) / sum(dock_stats[].total) × 100`

**Per-Source Reliability** — grouped by `use_case`:
- `total`, `success`, `fail` = COUNT per group
- `rel` = `ROUND(100 × success / total, 2)`
- Display names are remapped in the UI (both here and on the Speed by Use Case cards):
  `Local App Control` → **App Control (Local)**, `Remote App Control` →
  **App Control (Remote)**, `Docklet Press (App)` → **Docklet Press (Observed from App)**.
  Raw values are kept internally so filters and drill-downs keep working.

**Dock Reliability** — sourced entirely from `dock_logs`:
- Rows filtered by `hub_id` + date range (same scoping as app_logs / ha_logs)
- Grouped by `dock_id` — one entry per physical dock
- `total` = sum of `total_action_count` across all docklets in the dock
- `success` = sum of `success_count`
- `failure` = sum of `failure_count`
- `rel` = `ROUND(100 × success / total, 2)`
- `docklets[]` = per-docklet breakdown (same fields) with `actions[]` sub-array per action type

### 5.8 Usage (Source Breakdown)  *(source: app_logs + ha_logs for hub-recorded fields)*

| Field | Formula |
|---|---|
| `app` | `COUNTIF(use_case IN ('Local App Control', 'Device Bind (App)'))` |
| `docklet` | `COUNTIF(use_case = 'Docklet Press (App)')` |
| `remote` | `COUNTIF(use_case = 'Remote App Control')` |
| `direct` | `COUNTIF(use_case = 'Observed Change (App)')` — all observed changes |
| `scene_count` | `COUNTIF(entity_id LIKE 'scene.%' AND use_case = 'Observed Change (App)')` |
| `app_ratio` | `ROUND(100 × app / (app + docklet), 2)` |
| `dock_ratio` | `ROUND(100 × docklet / (app + docklet), 2)` |
| `observed_per_day` | `ROUND(direct / days_count, 2)` — app-observed, reference only |
| `scene_total` / `scene_per_day` | app-observed scene counts — reference only (app misses events while closed and can log state-restore bursts) |
| `hub_auto_total` / `hub_auto_per_day` | ha_logs `automation_triggered` count ÷ days — displayed as **Automation / Day** (hub-recorded = reliable source) |
| `hub_scene_total` / `hub_scene_per_day` | ha_logs scene `call_service` count ÷ days — displayed as **Scene / Day** (hub-recorded = reliable source) |
| `snap_devices` | `COUNT(DISTINCT entity_id) WHERE domain NOT IN (scene, automation, script, group)` |

**SNAP Devices domain filter** — physical devices only:
`SPLIT(entity_id, '.')[OFFSET(0)] NOT IN ('scene', 'automation', 'script', 'group')`
Counts only light.*, switch.*, fan.* domains — 18 distinct devices in production.

### 5.9 Device Activity  *(source: app_logs, grouped by entity_id)*

| Field | Formula |
|---|---|
| `total` | `COUNT(*)` |
| `success` | `COUNTIF(success = true)` |
| `rel` | `ROUND(100 × success / total, 2)` |
| `p50` | `APPROX_QUANTILES(latency_ms, 100 IGNORE NULLS)[OFFSET(50)]` |

**Domain filter applied** — only physical SNAP devices returned:
`SPLIT(entity_id, '.')[OFFSET(0)] NOT IN ('scene', 'automation', 'script', 'group')`

Top 50 devices by total event count.

### 5.10 Failures

**By reason** — `app_logs WHERE success = false AND failure_reason IS NOT NULL`, grouped by `failure_reason`
Known values: `TIMEOUT`, `NO_RESPONSE`, `DEVICE_OFFLINE`, `THREAD_MESH_FAIL`

**By device** — `app_logs WHERE success = false`, grouped by `entity_id` + `failure_reason`
- Domain filter applied: excludes scene, automation, script, group entities
- Frontend renders as a pivoted table: one column per reason, value = count (0 if none)
- Columns: Device | Total | NO_RESPONSE | TIMEOUT | DEVICE_OFFLINE | THREAD_MESH_FAIL | Action

### 5.11 Dock Usage  *(source: dock_logs)*

| Field | Formula |
|---|---|
| `total` | Sum of all `total_action_count` rows for this hub |
| `by_action` | Dict: action → sum of `total_action_count` |
| `by_docklet` | Dict: docklet_id → sum of `total_action_count` |
| `daily[]` | Per-date: total / success / failure / rel |

---

## 6. Backend Processing Logic (`analytics-api/main.py`)

The FastAPI backend runs all BigQuery queries in parallel per request and returns a
single JSON object that `dashboard_app.js` reads directly. All data — app_logs,
ha_logs, and dock_logs — comes from BigQuery; nothing is read from local files.

### Performance

- **Parallel execution:** All queries run concurrently via `ThreadPoolExecutor(max_workers=15)`.
  Wall-clock time ≈ slowest single query (~2–3 s) instead of sum of all queries.
- **In-memory cache:** Results are cached in `_HUB_CACHE` (dict) keyed by
  `hub_id:from_date:to_date` with a 5-minute TTL (`_CACHE_TTL = 300`). Repeated loads
  of the same hub+range are instant. Cache is cleared on server restart.

### Per-request flow (`GET /api/hub/{hub_id}?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD`)

1. Cache check — return cached result if still within TTL
2. **Top-level KPIs** (`f_kpi`) — single aggregation on app_logs (zero-event windows return reliability 0, not an error)
3. **Local E2E speed** (`f_le`, `f_le_ev`) — AVG/P50/P95 on `latency_ms` + 50 sample events
4. **Hub→SNAP→Hub speed** (`f_hs`, `f_hs_ev`) — same on `ha_processing_latency_ms` from ha_logs
5. **Per use-case speed** (`f_per_uc`, `f_per_uc_ev`) — grouped by `use_case`; samples = 100 most recent **per use case** (`ROW_NUMBER() OVER (PARTITION BY use_case)`)
6. **Latency buckets** (`f_bcount`, `f_bk`) — CASE-based bucketing (counts + 500 sample events)
7. **UC latency buckets** (`f_uc_bkt`) — per-use_case bucket breakdown
8. **Daily trend** (`f_daily`) — per-date reliability, p50, north star
9. **Activity heatmap** (`f_heat`) — day_of_week × hour event counts split by source
10. **Failures heatmap** (`f_heat_fail`) — day_of_week × hour failure counts
11. **Failures list** (`f_fail`) — last 100 failed events
12. **Per-source reliability** (`f_src`) — grouped by use_case
13. **HA event count** (`f_ha_cnt`) — COUNT(*) from ha_logs (informational)
14. **Failures by reason** (`f_fbr`, `f_fbr_ev`) — grouped + sample events per reason
15. **Failures by device** (`f_fbd`) — grouped by entity_id + reason (domain-filtered)
16. **Device activity** (`f_dev`) — top-50 devices with latency (domain-filtered)
17. **Usage counts** (`f_usage`) — source breakdown including scene_count
18. **SNAP device count** (`f_snap_count`) — distinct physical device count (domain-filtered)
19. **Hub→App WS push** (`f_hub_app`) — avg/p50/p95 of `ws_confirmation_ts − rest_response_ts` over the full window (negative diffs excluded)
20. **Observed Change events** (`f_obs_ev`) — last 200 Observed Change events (no latency filter — these rows have NULL latency and would otherwise never reach the Log Center)
21. **Hub-recorded observed events** (`f_hub_obs_ev`, `f_hub_obs_cnt`) — scene activations (`call_service` on scene.*) and automation runs (`automation_triggered`) from ha_logs; scene/automation `state_changed` rows are excluded (HA-restart state restores, not real activations)
22. **Dock rows** (`f_dock`) — dock sheet rows from `dock_logs`, filtered by `hub_id` + date range
23. Cache store — result saved to `_HUB_CACHE` with current timestamp

All steps 2–22 fire in parallel. Results are collected sequentially after all futures complete.

---

## 7. UI Logic (`dashboard_app.js`)

Vanilla JavaScript application. No framework dependencies beyond Chart.js.

### State

| Global | Purpose |
|---|---|
| `D` | Cache object — `D[hub_id]` holds the JSON returned by `/api/hub/{id}` |
| `activeHub` | Currently selected hub ID; `null` = fleet overview |
| `activeFrom` | ISO date string — start of current date range filter |
| `activeTo` | ISO date string — end of current date range filter |
| `lcState` | Log Center filter state: hub, tab, srcFilter, ucFilter, search, hourFilter, etc. |
| `_dockSortAsc` | Sort direction for the Dock Reliability table |
| `_lastDockStats` | Cached dock stats for sort re-render without re-fetch |

### Render functions

| Function | Tab / View |
|---|---|
| `renderLanding()` | Fleet overview — aggregates across all `D[hub]` entries |
| `renderDetail(hub)` | Hub drill-down entry point — calls all four render functions |
| `renderOverall(d)` | Overview tab — daily chart, NS chart, activity heatmap, failures heatmap |
| `renderSpeed(d)` | Speed tab — latency charts, buckets, per-UC cards with Avg/P50/P95/StdDev |
| `renderReliability(d)` | Reliability tab — per-source table, trend chart, dock table, failures |
| `renderUsage(d)` | Usage tab — KPI tiles, source doughnut, dock usage panel |
| `renderLogCenter(opts)` | Log Center — searchable raw event table with timing pipeline expand |
| `_renderDockTable(stats)` | Dock Reliability table — sorted by failure count |

### Reliability thresholds (applied as CSS tag classes)

| Range | Class | Colour |
|---|---|---|
| > 97% | `tag-green` | Green |
| 93% – 97% | `tag-yellow` | Yellow |
| < 93% | `tag-red` | Red |

### North Star colour thresholds (target ≥ 95%)

| Range | Colour |
|---|---|
| ≥ 95% | Green — on target |
| 80% – 95% | Yellow |
| < 80% | Red |

### Std Dev colour thresholds (Speed by Use Case cards)

| Range | Colour |
|---|---|
| < 200 ms | Green — consistent |
| 200–500 ms | Yellow — moderate variance |
| > 500 ms | Red — erratic |

---

## 8. Dashboard Panels

| Panel | Tab | Chart Type | Data Source |
|---|---|---|---|
| Top KPIs (5 tiles) | Overview | KPI tiles | app_logs |
| Daily Events & Reliability | Overview | Bar + Line chart | app_logs daily |
| North Star: Sub-1s Rate | Overview | KPI bar + Line chart (target 95%) | app_logs daily |
| Activity Heatmap | Overview | Heatmap (hour × day) | app_logs, blue scale |
| Failures Heatmap | Overview | Heatmap (hour × day) | app_logs failures, red scale |
| Speed Segments (Hub→SNAP→Hub, Hub→App, App Control Local/Remote) | Speed | Progress bars | app_logs + ha_logs |
| Latency Distribution | Speed | Bar chart | app_logs buckets |
| Speed by Use Case | Speed | Cards with Avg/P50/P95/StdDev | app_logs per use_case |
| Source Breakdown | Usage | Doughnut chart | app_logs use_case counts |
| Usage KPIs | Usage | KPI tiles | Automation/Day + Scene/Day from **ha_logs** (hub-recorded); Active Devices, App Ratio, Dock Ratio from app_logs |
| Dock Usage | Usage | KPI tiles + table | dock_logs |
| Per-Source Reliability | Reliability | Table (display names remapped) | app_logs per use_case |
| Reliability Trend | Reliability | Line chart | app_logs daily |
| Dock Reliability | Reliability | Sortable table | dock_logs |
| Failures by Reason | Reliability | Table | app_logs failures |
| Failures by Device | Reliability | Pivoted table (one col per reason) | app_logs failures |
| Device Activity | Reliability | Table | app_logs per entity_id |
| Log Center | Dedicated view | Searchable table + timing pipeline | All event pools incl. observed + hub-recorded events |

---

## 9. Unified Event Schema (`app_logs` row)

```json
{
  "event_id": "<uuid>",
  "hub_id": "<mac-address>",
  "event_timestamp": "2026-03-06T08:15:32.100",
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
  "tap_ts": "2026-03-06T08:15:32.100",
  "command_sent_ts": "2026-03-06T08:15:32.150",
  "rest_response_ts": "2026-03-06T08:15:32.420",
  "ws_confirmation_ts": "2026-03-06T08:15:32.580"
}
```

---

## 10. API Endpoints

| Endpoint | Returns |
|---|---|
| `GET /api/hubs` | `{ "hubs": ["<hub_id>", ...] }` |
| `GET /api/hub/{hub_id}?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD` | Full telemetry JSON (see §6) |
| `GET /` | Serves `dashboard.html` |
| `GET /<file>` | Serves any static file from the Analytics/ directory |

**Date range defaults:**
- `to_date` defaults to today (`date.today()`)
- `from_date` defaults to 30 days before `to_date`
- Maximum range: 90 days (larger ranges are clamped to 90 days from `to_date`)

**Full telemetry JSON shape** (values from live data):
```json
{
  "total": 1838,
  "success": 1829,
  "reliability": 99.51,
  "speed": {
    "hub_snap_hub": { "avg": 0, "p50": 0, "p95": 0, "events": [...] },
    "local_e2e":    { "avg": 686, "p50": 531, "p95": 1493, "events": [...] },
    "remote_e2e":   { "avg": 0, "p50": 0, "p95": 0, "events": [] },
    "hub_app":      { "avg": 463, "p50": 406, "p95": 1142, "events": [] },
    "buckets":       { "<500ms": 826, "500-1000ms": 543, "1-2s": 354, "2-5s": 24 },
    "bucket_events": { "<500ms": [...], ... },
    "per_uc":        { "Local App Control": { "avg": 686, "p50": 531, "p95": 1493, "stddev": 456, "count": 1717, "success": 1708, "buckets": {}, "events": [...] } }
  },
  "daily": [{ "date": "2026-07-01", "total": 13, "rel": 100.0, "p50": 480, "ns": 83.33 }],
  "heatmap": { "Monday_14": 45, ... },
  "heatmap_detail": { "Monday_14": { "app": 40, "dock": 2, "remote": 0, "auto": 3 } },
  "heatmap_fail": { "Friday_12": 9 },
  "failures": [...],
  "reliability_detail": {
    "app_trigger_feedback": 99.48,
    "dock_trigger_feedback": 100.0,
    "hub_to_app": 99.48,
    "app_triggers": 1717,
    "app_feedbacks": 1708,
    "dock_triggers": 30,
    "dock_feedbacks": 30,
    "hub_to_snap_count": 10824,
    "src_rel": { "Local App Control": { "total": 1717, "success": 1708, "fail": 9, "rel": 99.48 } },
    "dock_stats": [...]
  },
  "dock_usage": { "total": 134, "by_action": { "toggle": 72, "increment": 34, "decrement": 28 }, "by_docklet": {}, "daily": [] },
  "observed_events": [{ "ts": "...", "dev": "scene.meeting_mode", "uc": "Observed Change (App)", "src": "direct_thread", "success": true }],
  "hub_observed_events": [{ "ts": "...", "dev": "automation.mathi", "uc": "Automation Run (Hub)", "src": "direct_hub" }],
  "usage": {
    "app": 1717, "docklet": 30, "remote": 0, "direct": 91,
    "app_ratio": 98.28, "dock_ratio": 1.72,
    "observed_per_day": 2.94,
    "scene_total": 6, "scene_per_day": 0.19,
    "snap_devices": 18,
    "hub_scene_total": 7, "hub_scene_per_day": 0.23,
    "hub_auto_total": 7, "hub_auto_per_day": 0.23
  },
  "devices": [{ "id": "switch.firmware_test_switch_2", "room": "lab", "total": 364, "success": 362, "rel": 99.45, "p50": 520 }],
  "fail_by_reason": { "NO_RESPONSE": { "count": 9, "events": [...] } },
  "fail_by_device": { "fan.firmware_test": { "count": 2, "reasons": { "NO_RESPONSE": 2 } } }
}
```

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
venv/bin/uvicorn main:app --reload --host 0.0.0.0 --port 8080
```

Then open **http://localhost:8080** in the browser.
The `--reload` flag auto-restarts the server on every save to `main.py`.

To access from a mobile device on the same network, use the machine's LAN IP:
`http://<LAN-IP>:8080`

### Stop the server

Press **Ctrl + C** in the terminal.

### Restart (port already in use)

```bash
kill -9 $(lsof -ti :8080)
venv/bin/uvicorn main:app --reload --host 0.0.0.0 --port 8080
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
| `command not found: uvicorn` | venv not activated | Run `source venv/bin/activate` or use `venv/bin/uvicorn` directly |
| `[Errno 48] Address already in use` | Port 8080 taken by previous process | Run `kill -9 $(lsof -ti :8080)` then restart |
| Dashboard shows stale data after code change | In-memory cache TTL (5 min) | Restart the server — cache is cleared on startup |
| Dock numbers don't update after editing the sheet | Apps Script sync failed | Check the Sheet's Extensions → Apps Script → Executions log; run `syncToBigQuery` manually |
| Browser shows old UI after JS changes | Browser JS cache | A `?v=N` query string is appended to `dashboard_app.js` in `dashboard.html` — bump N after significant JS changes |
