# Schnell Fleet Analytics Architecture

This document is the authoritative reference for the live analytics system. It covers
the real data sources, the FastAPI backend, the BigQuery queries, and every formula
that drives the dashboard KPIs.

---

## The 3 Analytics Pillars

Every metric in the dashboard answers one of three questions:

| Pillar | Core Question | Source |
|---|---|---|
| **Reliability** | Did it work? | all-source: `app_logs.success` + dock/SNAP outcome (`ha_logs`) |
| **Speed** | How fast was it? | `app_logs` timestamps only (see the app-only note below) |
| **Usage / Activity** | How much is it used, and from where? | all reliable sources: `app_logs`, `ha_logs`, `dock_logs` |

---

## Data Sourcing Model (authoritative — current state)

The dashboard has **two scopes**, on purpose:

- **Activity & Reliability = ALL reliable sources.** "Total Events", "Reliability", "Failures", the Daily chart, the Activity heatmap, the Source Breakdown, the per-source table and the Log Center all count **every reliable event, whoever triggered it**.
- **Speed / Latency = app commands only.** Only `app_logs` rows carry the four timestamps needed to measure end-to-end time, so Speed segments, Latency distribution, North Star (sub-1s) and per-use-case speed are **app-command-only** and labelled as such. This is a data limitation, not a scoping choice.

### What counts as an event, and where each number comes from

| Source | What it is | How it's identified | Counted in Total / Reliability? |
|---|---|---|---|
| **App commands** | Genuine app-initiated control | `app_logs` `use_case IN ('Local App Control','Device Bind (App)','Remote App Control')` | ✅ Yes. Success = `app_logs.success`. Also the **only** source with latency. |
| **Dock presses** | Physical dock button → device | `ha_logs` `call_service` where `dock_id` is set **and** true dock origin | ✅ Yes. Success = the press's `context_id` produced a device `state_changed` reaching `on`/`off`; else fail. **`dock_id` alone is not enough** — see the Hub Logging Spec note below. |
| **Scene activations** | A scene fired | `ha_logs` `call_service` on `scene.*` | ✅ Counted as successful activity (the hub recorded it ran). |
| **Automation runs** | An automation fired | `ha_logs` `ha_event_type='automation_triggered'` | ✅ Counted as successful activity. |
| **Observed Change (App)** | Passive state the app noticed | `app_logs` `use_case='Observed Change (App)'` | ❌ **Never shown.** Unreliable (only seen while the app is open). Kept internally as `usage.direct`. |
| **SNAP-board actuation** | The SNAP hardware physically flipping a device | `ha_logs` `log_source LIKE 'snap:%'` | ❌ **Not counted** — this is the *device-layer* of an action already counted via its trigger (app / dock / automation). Counting it would double-count. The SNAP timestamps still feed the Hub → SNAP → Hub *latency* (timing, not a count). |
| **Direct hub control** | Someone controls a device from the hub's own HA screen | A **controllable actuator** (light/switch/fan/cover/lock/…) reaching a **concrete state** with `actuation_source LIKE 'ha:%'` (excluding `ha:automation`) | ✅ **Counted in Total Events / Reliability**, grouped under the consolidated **"Hub"** source (= direct + automations + scenes). Every counted event is a confirmed actuation → success. Replaces the earlier `trigger_id` anti-join, which mis-counted HA *system* noise (registry updates, unavailable transitions, notify/tts) — ~2,800 bogus vs ~16 genuine rows on the reference hub. |

**All-source reliability** = `(app successes + dock successes + scenes + automations + direct hub control) ÷ Total Events`.
`Total Events = app + dock + scenes + automations + direct hub control`, and always `Total = Success + Failures`.
**"Hub" is one consolidated source** = direct hub control + automation runs + scene activations
(shown as just "Hub" in usage share, reliability-by-source and trends).

**dock_logs is used only for the Usage-tab action breakdown** (increment / decrement / toggle). Dock *reliability and counts* come from `ha_logs`. *dock_logs is currently mock; ha_logs is real.* The two are keyed by `dock_id` + `docklet_id`. A dock contains multiple docklets; each docklet's presses are tracked separately and sum to the dock total.

### The Hub Logging Spec (2026-07-09) — true origin, one row per action

`ha_logs` gained four fields that make every source above attributable and
countable exactly once:

| Field | Meaning |
|---|---|
| `log_source` | **True origin** — `app:command` / `ha_ui:command` / `automation:<id>` / `scene:<id>`, or the hardware-layer fallback `dock:<id>` / `snap:<id>` / `ha:<domain>` when origin can't be determined from context alone |
| `actuation_source` | Which hardware physically carried it out — always populated; `log_source` falls back to this |
| `trigger_id` | HA's own context id, shared by every row one action produces — the same value `app_logs.trigger_id` carries for that action, so the two tables join per-action |
| `is_trigger` | `true` on exactly the initiating row per action; `false` on fan-out. **Count `WHERE is_trigger`, not every row**, or fan-out inflates counts |

Full detail (including *why* account comparison alone can't separate app vs
hub-UI on this product, and how the app's own HA account id is learned
automatically with zero config) lives in `HA_TELEMETRY.md` §3a — this section
just covers what it changes for counting:

- **Dock press counts were inflated** before this fix: `dock_id` is an
  entity-hardware mapping, not an origin signal, so an app command on a
  dock-bound device also carried `dock_id` and was being counted as a
  physical press. Fixed in `main.py`'s `f_dock_ev` — new rows require
  `is_trigger AND log_source LIKE 'dock:%'`; rows from before this fix
  (`is_trigger IS NULL`) keep the old `dock_id`-only heuristic so historical
  counts don't shift underfoot.
- **Direct hub control became countable** — previously a permanent "Known
  data gap" (see below). First resolved via a `trigger_id` anti-join, which
  turned out to mis-count HA *system* noise; now detected from
  **`actuation_source LIKE 'ha:%'`** on controllable actuator domains reaching
  a concrete state (see the table above), and folded into the totals.

Rows written before 2026-07-09 have `NULL` for all four fields — this is
expected, not an error; they simply predate the spec.

### Count reconciliation (card ↔ drill-down)

The backend returns **complete, unsampled** event lists — `all_events` (app), `dock_events`, `hub_observed_events` (scene/automation), `hub_ha_ui_events` (direct HA-UI control). The Log Center, heatmap and Daily chart are all built from these same lists, so every summary-card number equals its drill-down (e.g. a heatmap cell filters the Log Center to that exact **day + hour** and the counts match; the Failures tile equals the Failures-by-Reason sum).

### Known data gaps (not dashboard bugs)

- **App Control (Remote) = "Not tracked"** — no `Remote App Control` events exist yet.

*(Resolved: Hub → SNAP → Hub latency is now live — the hub records distinct
`matter_command_ts` / `snap_state_change_ts`, so the segment shows the real device
round-trip. See §5.2. Resolved 2026-07-09: Direct HA control is now countable —
see the Hub Logging Spec note above.)*

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
      Analytics/public/  (built React app from Analytics/web/)
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
├── README.md                          Project overview & quick start
├── CLAUDE.md                          Guidance for Claude Code (whole project)
├── web/                               DASHBOARD UI SOURCE — React + TypeScript (Vite, Chart.js)
│   └── src/                           types/ api/ lib/ charts/ state/ components/ modals/ views/
├── public/                            BUILT output — what is served (never hand-edit)
│   ├── index.html + assets/           Built React dashboard (from web/, via ./build-web.sh)
│   ├── 404.html
│   └── matter/                        BUILT Matter Node/Thread UI bundle (served at /matter)
├── matter-ui/                         Matter UI build SOURCE (trimmed: dashboard + ws-client + custom-clusters)
├── build-web.sh                       Rebuild web/ → refresh public/ (preserves matter/ + 404.html)
├── build-matter.sh                    Rebuild matter-ui → refresh public/matter/
├── deploy.sh                          One-command deploy (Cloud Run + Firebase Hosting)
├── firebase.json / .firebaserc        Firebase Hosting config (rewrites /api/** → Cloud Run)
├── Dockerfile                         Cloud Run container definition
├── .gcloudignore / .dockerignore      Keep the deploy lean (exclude matter-ui/ source, venv, node_modules)
├── dock_sheet_apps_script.gs          Apps Script for the Google Sheet (auto-sync to BigQuery)
├── docs/                              Reference documentation
│   ├── Schnell_Analytics_Architecture.md  This document
│   ├── FORMULAS.md                    Formula quick-reference
│   └── APP_TELEMETRY.md / HA_TELEMETRY.md / DOCK_TELEMETRY.md   Raw BigQuery column references
└── analytics-api/
    ├── main.py                        FastAPI backend — all data from BigQuery
    ├── requirements.txt               Python dependencies
    ├── run-local.sh                   Start the dashboard locally on :8080
    └── venv/                          Local virtual environment (not committed)
```

> **Deploying:** run `./deploy.sh` (backend + UI) or `./deploy.sh --web-only`
> (UI only — skips the Cloud Run rebuild). The UI has one copy (`public/`), and
> Firebase serves it with a `no-cache` header, so there is no copy step and no
> manual cache-busting to remember. The built `public/matter/` bundle deploys to both
> Cloud Run and Firebase; the `matter-ui/` **source** is excluded (it's a build input).

### Node & Thread tabs — embedded Matter UI

The **Node** and **Thread** detail tabs embed the Matter server's own dashboard,
**trimmed to just those two views** and **served by this app** at `/matter` (built from
`matter-ui/` into `public/matter/` via `build-matter.sh`). They load
`/matter/index.html?ac=1&ip=192.168.0.41:8123&user=dhanush` (Thread adds `#thread`):
`?ac=1` makes the Matter UI auto-connect to the hub's Matter WebSocket
(`ws://192.168.0.41:5580/ws`) — skipping its login — and hide its own header/nav bar.
The hardcoded connection lives in `web/src/lib/constants.ts` (`MATTER_UI`).
The Matter server itself (controller + WebSocket) runs on the **hub**, separate from
this project.

> **Live (HTTPS) limitation:** the embedded Matter UI connects to the hub over `ws://`
> (insecure), which browsers block from an HTTPS page. On the live Firebase URL the
> Matter tabs load but can't fetch live data unless the hub is served over `wss://`.
> Over local HTTP everything works.

---

## 3. Interaction Paths

Every user action falls into one of four tracked paths. These map directly to the
`use_case` column in `app_logs`.

| Path | `use_case` value | Flow | Description |
|---|---|---|---|
| Local App Control | `Local App Control` | App → Hub (HA) → SNAP → WebSocket → App | User taps a device tile in the app over local Wi-Fi; app receives state confirmation |
| Device Bind | `Device Bind (App)` | App → Hub (HA) → SNAP → WebSocket → App | User commissions or binds a device from the app |
| Remote App Control | `Remote App Control` | App → Hub (HA) → SNAP (remote path) | App controls a device over the internet when not on local Wi-Fi |
| Observed Change | `Observed Change (App)` | Dock press or automation → HA → App observes | App logs a state change it did not initiate. **No longer shown anywhere in the dashboard** — it's unreliable (only recorded while the app is open). Dock/scene/automation activity now comes from `ha_logs` instead (see the Data Sourcing Model). Kept internally as `usage.direct`. |

> **Dock button presses are not app-initiated.** When a physical dock button is pressed,
> the state change propagates through HA and the app observes it, logging it as
> `Observed Change (App)`. But that app-side observation is **not** what the dashboard
> uses — dock press counts and reliability come from `ha_logs` (§5.7); `dock_logs` (the
> Sheet) is usage-breakdown only.

> **Scenes & automations** — the **Scene / Day** and **Automation / Day** tiles are
> counted from **ha_logs** (hub-recorded — the hub records every activation even when
> the app is closed, making it the reliable source). The app's own observed
> scene/automation counts aren't kept anywhere, reference or otherwise — the app
> misses events while closed and can log state-restore bursts as false activations,
> so there's nothing worth keeping from that side.

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
| `trigger_id` | STRING | HA's context id, captured off the confirming WebSocket `state_changed` event (fixed 2026-07-10 — the REST command response is empty for async Matter/Thread devices, see `APP_TELEMETRY.md`) — joins to `ha_logs.trigger_id` for the same action. Added 2026-07-09 |

> All timestamp columns are stored as **STRING** in BigQuery — queries that do
> timestamp math must use `SAFE_CAST(... AS TIMESTAMP)` (see Hub→App in §5.2).

### B. BigQuery — `schnell_analytics.ha_logs`

Every row is one event processed by Home Assistant on the hub. Used for HA processing
latency, hub-recorded scene/automation counts, dock reliability, and (as of
2026-07-09) true-origin attribution — see `HA_TELEMETRY.md` §3a for full detail.

| Column | Type | Meaning |
|---|---|---|
| `hub_id` | STRING | Hub MAC address |
| `event_timestamp` | STRING (ISO timestamp) | When HA processed the event |
| `entity_id` | STRING | Device ID |
| `friendly_name` | STRING | Human-readable device name |
| `ha_event_type` | STRING | HA internal event type (`state_changed`, `call_service`, `automation_triggered`, …) |
| `ha_processing_latency_ms` | INT64 | HA's internal handling time only (~0–6ms). **Not** used for Hub→SNAP→Hub — that uses the `matter_command_ts`→`snap_state_change_ts` gap instead |
| `matter_command_ts` | STRING (ISO timestamp) | When HA issued the Matter command — currently identical to snap_state_change_ts (hub-side gap) |
| `snap_state_change_ts` | STRING (ISO timestamp) | When the SNAP state actually changed |
| `dock_id` | STRING | Which dock's hardware this entity is mapped to (Custom Storage). **Not an origin signal** — any command on a dock-bound device carries this, including app commands. Use `log_source`/`is_trigger` to know who actually triggered it |
| `room` | STRING | Physical room |
| `log_source` | STRING | True origin — `app:command` / `ha_ui:command` / `automation:<id>` / `scene:<id>` / hardware fallback `dock:<id>` / `snap:<id>` / `ha:<domain>`. Added 2026-07-09 |
| `actuation_source` | STRING | Hardware that carried out the action — `dock:<id>` / `snap:<id>` / `ha:<domain>`. Added 2026-07-09 |
| `trigger_id` | STRING | HA's own context id, shared by every row one action produces — joins to `app_logs.trigger_id`. Added 2026-07-09 |
| `is_trigger` | BOOL | `true` on the one initiating row per action; `false` on fan-out. Added 2026-07-09 |

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

### 5.1 Top-Level KPIs  *(all-source)*

The headline tiles are **all-source** (app + dock + scene + automation + direct hub control). The
app-only `total` / `success` / `reliability` fields still exist for the app-command
detail (per-source table), but the tiles use the `activity_*` fields:

| Field | Formula |
|---|---|
| `total_activity` | `app_total + dock_presses + hub_scene + hub_auto` — the **Total Events** tile |
| `activity_success` | `app_success + dock_success + hub_scene + hub_auto` |
| `activity_fail` | `(app_total − app_success) + dock_fail` |
| `activity_reliability` | `ROUND(100 × activity_success / total_activity, 2)` — the **Reliability** tile |
| `total`, `success`, `reliability` | app-command-only (kept for the per-source breakdown) |

Invariant: `total_activity = activity_success + activity_fail`. When `total = 0`
(no app commands) the Reliability tile shows **"—"**, not 0%.

**Example:** app 1717 (9 fail) + dock 384 (164 fail) + scene 8 + auto 8
→ Total 2117, Failures 173, Success 1944 → Reliability = 1944 / 2117 ≈ **91.8%**.
(Numbers drift with live data; the invariant `Total = Success + Failures` always holds.)

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

**Hub → SNAP → Hub** — real device-actuation latency: hub sends the Matter command → device confirms its new state
*(source: ha_logs — the gap between `matter_command_ts` and `snap_state_change_ts`)*

| Metric | Formula |
|---|---|
| per-event latency | `TIMESTAMP_DIFF(snap_state_change_ts, matter_command_ts, MILLISECOND)` |
| avg | `ROUND(AVG(gap))` over rows with `gap > 0` |
| p50 / p95 | `APPROX_QUANTILES(gap, 100)[OFFSET(50 / 95)]` |

> **Now live.** The hub records `matter_command_ts` (command sent) and
> `snap_state_change_ts` (device confirmed) as distinct moments, so the gap is the real
> actuation time (currently avg ≈ 425ms, p50 ≈ 325ms on early data).
> `gap > 0` excludes any legacy rows where the two are still stamped identically.
> **Note:** this uses the timestamp gap, **not** `ha_processing_latency_ms` — that field
> is ~0–6ms (HA's internal handling only) and does not represent the device round-trip.
> Sample events (with `matter_ts` / `snap_ts` / latency) are shown in the segment's
> drill-down modal.

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

### 5.7 Reliability Detail  *(source: app_logs + ha_logs)*

**App Trigger → Feedback**
- `a_rows` = src_rel rows where use_case contains "App Control"
- Numerator (`as_`): `sum(success)` across `a_rows`
- Denominator (`at`): `sum(total)` across `a_rows`
- Formula: `ROUND(100 × as_ / at, 2)`

**Dock Trigger Reliability** — sourced from `ha_logs` (**not** `dock_logs` —
`dock_logs` is usage-breakdown only, see §4.C)
- A press = `ha_logs` `call_service` row with `dock_id` set and true dock
  origin (`is_trigger AND log_source LIKE 'dock:%'` once the Hub Logging Spec
  fields are present on that row; rows from before 2026-07-09 fall back to
  the plain `dock_id`-set heuristic — see the Hub Logging Spec note in the
  Data Sourcing Model section)
- Success = that press's `context_id` produced a `state_changed` reaching
  `on`/`off`
- Dashboard renders as: `dockRel = sum(dock_stats[].success) / sum(dock_stats[].total) × 100`
- This is the **same** press list (`f_dock_ev` / `dock_ev`) the Log Center and
  Dock Usage Ratio use, so they always reconcile

**Per-Source Reliability** — grouped by `use_case` (app_logs) plus a synthetic
`Dock Control` row (from the `ha_logs` press list above):
- `total`, `success`, `fail` = COUNT per group
- `rel` = `ROUND(100 × success / total, 2)`
- Display names are remapped in the UI (both here and on the Speed by Use Case cards):
  `Local App Control` → **App Control (Local)**, `Remote App Control` →
  **App Control (Remote)**, `Docklet Press (App)` → **Docklet Press (Observed from App)**.
  Raw values are kept internally so filters and drill-downs keep working.

**Dock Reliability** — sourced from the same `ha_logs` press list as Dock
Trigger Reliability above:
- Rows filtered by `hub_id` + date range (same scoping as app_logs / ha_logs)
- Grouped by `dock_id` — one entry per physical dock
- `total`/`success`/`failure` = counted directly from the press list (not
  summed from `dock_logs` action counts)
- `rel` = `ROUND(100 × success / total, 2)`
- `docklets[]` = per-docklet breakdown (same fields), with an `actions[]`
  sub-array per action type merged in from `dock_logs` (usage detail only —
  doesn't affect the reliability numbers)

### 5.8 Usage (Source Breakdown)  *(source: app_logs + ha_logs)*

| Field | Formula |
|---|---|
| `app` | app_logs `COUNTIF(use_case IN ('Local App Control', 'Device Bind (App)'))` |
| `remote` | app_logs `COUNTIF(use_case = 'Remote App Control')` |
| `docklet` | **ha_logs** dock press count (the same list §5.7 uses) — *not* app-observed |
| `direct` | app_logs `COUNTIF(use_case = 'Observed Change (App)')` — internal reference only, never displayed |
| `app_ratio` | `ROUND(100 × app / (app + docklet), 2)` |
| `dock_ratio` | `ROUND(100 × docklet / (app + docklet), 2)` |
| `hub_auto_total` / `hub_auto_per_day` | ha_logs `automation_triggered` count ÷ days — displayed as **Automation / Day** (hub-recorded = reliable source) |
| `hub_scene_total` / `hub_scene_per_day` | ha_logs scene `call_service` count ÷ days — displayed as **Scene / Day** (hub-recorded = reliable source) |
| `snap_devices` | `COUNT(DISTINCT entity_id) WHERE domain NOT IN (scene, automation, script, group)` |
| `hub_direct_total` / `hub_direct_per_day` | Direct hub control count ÷ days (`actuation_source LIKE 'ha:%'`, controllable actuators, concrete state) — displayed as **Direct Hub Control**; folded into `total_activity` |
| `hub_total` / `hub_per_day` / `hub_ratio` | Consolidated **Hub** source = direct + automations + scenes; `hub_ratio` completes the 3-way App/Dock/Hub split (sums to 100%) |
| `direct_ha_ui_total` / `direct_ha_ui_per_day` | Deprecated aliases of `hub_direct_*`, kept for older UI builds |

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
single JSON object that the React app (`web/src/api/client.ts`) reads directly. All data — app_logs,
ha_logs, and dock_logs — comes from BigQuery; nothing is read from local files.

> **For which source feeds which number, the authoritative reference is the
> "Data Sourcing Model" section near the top of this document.** Key points that
> supersede older step-by-step notes below: headline tiles are all-source
> (`total_activity` / `activity_reliability` / `activity_fail`); the backend returns
> complete unsampled event lists (`all_events`, `dock_events`, `hub_observed_events`);
> dock reliability comes from `ha_logs` (dock_logs is usage-breakdown only); SNAP-board
> actuations are the device-layer of already-counted triggers and are **not** counted
> again; and heatmaps are built **client-side from the event pool** (no backend heatmap
> query), so cell counts equal their drill-downs.

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
4. **Hub→SNAP→Hub speed** (`f_hs`, `f_hs_ev`) — `snap_state_change_ts − matter_command_ts` gap (ms) from ha_logs, `gap > 0`; samples also carry `log_source` (true origin) for context, since this segment is origin-agnostic by design
5. **Per use-case speed** (`f_per_uc`, `f_per_uc_ev`) — grouped by `use_case`; samples = 100 most recent **per use case** (`ROW_NUMBER() OVER (PARTITION BY use_case)`)
6. **Latency buckets** (`f_uc_bkt`, `f_bcount`, `f_bk`) — CASE-based bucketing, per-use_case + overall (counts + 500 sample events)
7. **Daily trend** (`f_daily`) — per-date reliability, p50, north star
8. **Failures list** (`f_fail`) — last 100 failed events
9. **Per-source reliability** (`f_src`) — grouped by use_case
10. **HA event count** (`f_ha_cnt`) — COUNT(*) from ha_logs (informational)
11. **Failures by reason** (`f_fbr`, `f_fbr_ev`) — grouped + sample events per reason
12. **Failures by device** (`f_fbd`) — grouped by entity_id + reason (domain-filtered)
13. **Device activity** (`f_dev`) — top-50 devices with latency (domain-filtered)
14. **Usage counts** (`f_usage`) — app/remote/observed counts from app_logs
15. **SNAP device count** (`f_snap_count`) — distinct physical device count (domain-filtered)
16. **Hub→App WS push** (`f_hub_app`) — avg/p50/p95 of `ws_confirmation_ts − rest_response_ts` over the full window (negative diffs excluded)
17. **Complete app-triggered event list** (`f_all_ev`) — up to 20,000 rows, Log Center source of truth for app commands
18. **Observed Change count** (`f_obs_cnt`) — internal reference only, never displayed
19. **Hub-recorded scene/automation** (`f_hub_obs_ev`, `f_hub_obs_cnt`) — scene activations (`call_service` on scene.*) and automation runs (`automation_triggered`) from ha_logs; scene/automation `state_changed` rows are excluded (HA-restart state restores, not real activations)
20. **Dock usage rows** (`f_dock`) — dock sheet rows from `dock_logs`, filtered by `hub_id` + date range — action-type breakdown only
21. **Dock press events** (`f_dock_ev`) — the real reliability source, from ha_logs; requires true dock origin (`is_trigger AND log_source LIKE 'dock:%'`) on rows written after 2026-07-09, falls back to the plain `dock_id`-set heuristic on older rows — see the Hub Logging Spec note
22. **Direct hub control** (`f_ha_ui_cnt`, `f_ha_ui_ev`) — a controllable actuator (light/switch/fan/…) reaching a concrete state with `actuation_source LIKE 'ha:%'` (excluding `ha:automation`); every counted event is a confirmed actuation. Replaced the trigger_id anti-join, which mis-counted HA system noise
23. Cache store — result saved to `_HUB_CACHE` with current timestamp

All steps 2–22 fire in parallel via `ThreadPoolExecutor`. Results are collected sequentially after all futures complete. (Heatmaps are **not** a backend query — built client-side from the event pool so cell counts always equal their drill-downs.)

---

## 7. UI Logic (`web/` — React + TypeScript)

> The UI was migrated from a single vanilla-JS file to a typed React app in `web/`
> with **identical behavior and visuals** (verified: the event pool reproduces the
> backend's headline numbers exactly for every golden fixture). The logic described
> below is unchanged — only where it lives moved:
>
> | Concern | Module |
> |---|---|
> | API types (frozen contract) | `web/src/types/api.ts` (+ `contract.check.ts` compile-time check) |
> | Event pool / reconciliation | `web/src/lib/pool.ts` (`buildEventPool`, `allSourceDaily`, `srcPred`, `failuresFor`) |
> | Targets, Matter config, labels | `web/src/lib/constants.ts` |
> | ⓘ info texts | `web/src/lib/info.ts` |
> | Views & tabs | `web/src/views/` (Landing, HubDetail, LogCenter, tabs/) |
> | Drill-down modals | `web/src/modals/` |
>
> Log Center rows are **virtualized** (`@tanstack/react-virtual`) for fleet scale.

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
| Usage KPIs | Usage | KPI tiles | Automation/Day + Scene/Day + Direct Hub Control from **ha_logs** (hub-recorded); Active Devices, App/Dock/Hub Ratios from app_logs + ha_logs |
| Dock Usage | Usage | KPI tiles + table | dock_logs (action-type breakdown only — see §5.7 for why reliability isn't here) |
| Per-Source Reliability | Reliability | Table (display names remapped) | app_logs per use_case + ha_logs Dock Control |
| Reliability Trend | Reliability | Line chart | app_logs daily |
| Dock Reliability | Reliability | Sortable table | **ha_logs** (not dock_logs — see §5.7) |
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
| `GET /` | Serves `public/index.html` |
| `GET /<file>` | Serves any static file from the Analytics/ directory |

**Date range defaults:**
- `to_date` defaults to today (`date.today()`)
- `from_date` defaults to 30 days before `to_date`
- Maximum range: 90 days (larger ranges are clamped to 90 days from `to_date`)

**Full telemetry JSON shape** (values illustrative; drift with live data):
```json
{
  "total": 1717,              // app-triggered count (reliability denominator / detail)
  "success": 1708,            // app-triggered successes
  "reliability": 99.48,       // app-command reliability (per-source detail)

  "total_activity": 2120,     // ALL-SOURCE — the "Total Events" tile
  "activity_success": 1934,   // all-source successes
  "activity_fail": 187,       // all-source failures (app + dock)
  "activity_reliability": 91.2,  // ALL-SOURCE — the "Reliability" tile

  "speed": {                  // app-command latency only (see §5.2)
    "hub_snap_hub": { "avg": 425, "p50": 325, "p95": 1245, "events": [...] },  // matter_ts→snap_ts gap
    "local_e2e":    { "avg": 686, "p50": 531, "p95": 1493, "events": [...] },
    "remote_e2e":   { "avg": 0, "p50": 0, "p95": 0, "events": [] },       // "Not tracked"
    "hub_app":      { "avg": 463, "p50": 406, "p95": 1142, "events": [] },
    "buckets": {...}, "bucket_events": {...}, "per_uc": {...}
  },
  "daily": [{ "date": "2026-07-01", "total": 13, "rel": 100.0, "p50": 480, "ns": 83.33 }],
                              // app-only; the frontend rebuilds an ALL-SOURCE daily
                              // series from the event pool for the charts
  "reliability_detail": {
    "app_trigger_feedback": 99.48, "app_triggers": 1717, "app_feedbacks": 1708,
    "dock_trigger_feedback": 57.22,  // ha_logs dock press reliability
    "dock_triggers": 384, "dock_feedbacks": 220,
    "hub_to_snap_count": 7559,       // ha_logs device-processing events (call_service+state_changed)
    "src_rel": {                     // per-source reliability table (app + dock)
      "Local App Control": { "total": 1717, "success": 1708, "fail": 9, "rel": 99.48 },
      "Dock Control":      { "total": 384,  "success": 220,  "fail": 164, "rel": 57.29 }
    },
    "dock_stats": [{ "dock_id": "...", "total": 384, "success": 220, "failure": 164, "rel": 57.29,
                     "docklets": [{ "docklet_id": "...", "total": 88, "success": 47, "failure": 41,
                                    "rel": 53.41, "actions": [...] }] }]
  },
  "all_events":    [ /* COMPLETE app-triggered list — Log Center source of truth */ ],
  "dock_events":   [{ "ts": "...", "dev": "switch....", "dock_id": "...", "docklet_id": "...",
                      "action": "light.turn_on", "success": true }],
                   // ha_logs presses — true dock origin required on rows after 2026-07-09
  "hub_observed_events": [{ "ts": "...", "dev": "automation.mathi", "uc": "Automation Run (Hub)" }],
  "hub_ha_ui_events": [{ "ts": "...", "dev": "switch.test_product_switch_4", "friendly_name": "...",
                         "room": "Balcony" }],
                   // added 2026-07-09 — direct HA-UI control, see Hub Logging Spec note
  "dock_usage":    { "total": 134, "by_action": { "toggle": 72, "increment": 34, "decrement": 28 },
                     "by_docklet": {}, "daily": [] },   // from dock_logs — usage breakdown only
  "usage": {
    "app": 1717, "remote": 0,
    "docklet": 384,            // dock presses (ha_logs, true dock origin)
    "direct": 91,              // Observed Change (App) — INTERNAL only, never displayed
    "app_ratio": 81.7, "dock_ratio": 18.3, "snap_devices": 12,
    "hub_scene_total": 8, "hub_scene_per_day": 0.26,
    "hub_auto_total": 8,  "hub_auto_per_day": 0.26,
    "hub_direct_total": 16, "hub_direct_per_day": 0.36, "hub_total": 46, "hub_ratio": 1.89
  },
  "devices": [{ "id": "switch....", "room": "lab", "total": 364, "success": 362, "rel": 99.45, "p50": 520 }],
  "fail_by_reason": { "NO_RESPONSE": { "count": 9, "events": [...] },
                      "DEVICE_UNAVAILABLE": { "count": 166, "events": [...] } },  // incl. dock/SNAP
  "fail_by_device": { "light....": { "count": 41, "reasons": { "DEVICE_UNAVAILABLE": 41 } } }
}
```
Removed vs older versions: `observed_events`, `heatmap`/`heatmap_detail`/`heatmap_fail`
(the frontend now builds heatmaps from the event pool), and the app-observed
`scene_total`/`scene_per_day`/`observed_per_day` usage fields.

Added 2026-07-09 (Hub Logging Spec): `ha_logs` rows (and `hub_snap_hub` speed
samples) now also carry `log_source` (true origin), `actuation_source`
(hardware layer), `trigger_id` (join key to `app_logs.trigger_id`), and
`is_trigger` (one row per action) — not shown in this app_logs-shaped example
since they live on `ha_logs`; see `HA_TELEMETRY.md` §3a for the full schema.

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
| Browser shows old UI after changes | Forgot to rebuild | The served UI is the **built** app in `public/` — run `./build-web.sh` after editing `web/src/`. Firebase serves HTML with `no-cache` and Vite assets are content-hashed, so a normal reload then picks up the new build. |
