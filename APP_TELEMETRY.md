# App Telemetry — what the mobile app logs, and what it can't

This document explains the **app-side telemetry** that streams device/usage
events from the Schnell mobile app into BigQuery for the fleet analytics
pipeline. It covers exactly which events the app can and cannot capture, the
event schema, where the data lands, and why some things are impossible to log
from the app alone.

Related: [`HA_TELEMETRY.md`](HA_TELEMETRY.md) (the hub-side pipeline),
[`DOCK_TELEMETRY.md`](DOCK_TELEMETRY.md) (the dock-side pipeline) and
[`../Analytics/Schnell_Analytics_Architecture.md`](../Analytics/Schnell_Analytics_Architecture.md)
(the full analytics architecture).

---

## 1. The one rule that governs everything

The app can log an event **only if one of these is true**:

1. **The app initiated it** — the user did something in the app, so the app
   sent the command and records it.
2. **The app observed it** — the app is **open and connected** to Home
   Assistant's WebSocket, so it sees the `state_changed` event.

If neither holds (app closed, or the action happened entirely on the hub /
hardware), **the app sees nothing → no log.**

> There is **no hub-side logging** in this pipeline yet — only the phone.
> Everything depends on the app either doing the action or being awake to
> watch it.

---

## 2. Data flow

```
Flutter app
  → AppEventTracker records an AppEvent
  → Hive offline queue (survives offline / app kill)
  → batched flush (every ~20s, or at 20 events)
        ↓
  Firestore:  smash_db/<hub_mac>/app_events/<event_id>
        ↓  firestore-bigquery-export extension
  BigQuery:   schnell_analytics.app_logs_raw_changelog   (+ _raw_latest view)
```

- Each event is grouped per hub by `hub_id` — the raw hub MAC address stored in
  SharedPreferences. Matches the `hub_id` in `ha_logs`, enabling cross-table joins.
- `event_id` is the shared key for a future join to the hub-side
  `unified_event_log`.

Code: `lib/features/analytics/`
- `models/app_event.dart` — the event schema (Freezed).
- `services/app_event_queue.dart` — Hive offline buffer.
- `services/app_event_sink.dart` — batched Firestore writer.
- `providers/app_event_tracker.dart` — capture, correlation, observe-only,
  flush.

---

## 3. What the app captures

| What happens | Who starts it | Logged? | `use_case` | `trigger_method` | Condition |
|---|---|---|---|---|---|
| Tap device on/off in app | App (user) | ✅ | `Local App Control` | `tile_tap` | always |
| Brightness / fan slider in app | App (user) | ✅ | `Local App Control` | `slider` | always |
| Trigger automation from app button | App (user) | ✅ | `Local App Control` | `automation_trigger` | always |
| Bind a docklet → device in app | App (user) | ✅ | `Device Bind (App)` | `bind` | always |
| **Physical docklet button press** → device toggle | Hardware, app bridges | ✅ | `Docklet Press (App)` | `docklet` | only while app open + connected |
| **Physical docklet press** → scene activate | Hardware, app bridges | ✅ | `Docklet Press (App)` | `docklet` | only while app open + connected |
| **Physical docklet press** → automation trigger | Hardware, app bridges | ✅ | `Docklet Press (App)` | `docklet` | only while app open + connected |
| Device changes from a hub-side automation/schedule | HA hub | ✅ *as effect* | `Observed Change (App)` | `observed` | only while app open + connected |
| Device changed by another phone / HA dashboard | External | ✅ *as effect* | `Observed Change (App)` | `observed` | only while app open + connected |
| The automation/scene *itself* firing on a schedule | HA hub | ❌ | — | — | app can't see the trigger, only effects, and only if open |
| Direct Thread/Matter mesh control (UC4) | Hardware mesh | ❌ | — | — | app not involved |
| Anything at all while the app is **closed** | — | ❌ | — | — | WebSocket disconnected |

### Use-case values

The `use_case` field stores a **plain-readable** label (not a `UC#` code):

| `use_case` value | Meaning |
|---|---|
| `Local App Control` | The user acted in the app. Reliable, always logged. |
| `Docklet Press (App)` | A physical dock button press the app executed on the user's behalf (`docklet_trigger_logic`). Logged only while the app is open. |
| `Device Bind (App)` | Associating a docklet to a device. |
| `Remote App Control` | Remote control. *Not produced yet* — the app only talks to the hub on the local network. Reserved. |
| `Observed Change (App)` | A state change the app witnessed but did not cause (effect of a hub-side automation, an external dashboard, etc.). |

The "(App)" tag marks events whose origin could otherwise be ambiguous — every
row in this table is app-side. The mapping lives in
`AppEventTracker._useCaseLabel`.

---

## 4. Observe-only logging (effects of automations & external changes)

Beyond actions the app performs, the tracker also records **unsolicited**
`state_changed` events it sees on the WebSocket as `OBSERVED` telemetry. This
is how the *effects* of automatic automations and external controls get
captured. Important properties:

- **Foreground only.** The app must be open and WebSocket-connected. While the
  app is closed it sees nothing — so a 2 a.m. scheduled automation is **not**
  logged.
- **Effects, not causes.** We log "light X turned on", not "automation Y ran".
  The app cannot tell *who* caused a change, only that it happened.
- **Noise filter.** Only controllable domains are recorded
  (`light, fan, switch, climate, cover, lock, scene, automation, media_player`).
  Sensor spam (`sensor`, `binary_sensor`, `device_tracker`, `sun`, `weather`)
  is skipped.
- **Echo de-duplication.** A state change for an entity the app *just acted on*
  (within a 5s window) is treated as our own action's result and is **not**
  double-logged as `OBSERVED`.
- A physical docklet press therefore typically yields **two** rows: the `UC2`
  bridged action (the bound device) plus an `OBSERVED` row for the docklet
  switch's own state change.

Toggle in code: `AppEventTracker._observeUnsolicited` (currently `true`).

---

## 5. Event schema (`app_logs` columns)

Each event is one row. Fields mirror `Analytics`'s `app_logs.csv` contract,
plus `hub_id`. (Stored as document fields; the BigQuery extension wraps them
in a JSON `data` column — query with `JSON_VALUE(data, '$.field')`.)

| Field | Meaning |
|---|---|
| `hub_id` | Raw hub MAC address (from SharedPreferences) — grouping key, joins to `ha_logs.hub_id` |
| `log_source` | constant `flutter_app` |
| `event_id` | unique id / Firestore doc id / future join key |
| `timestamp`, `date`, `time`, `hour`, `day_of_week` | when it started |
| `use_case` | `UC1` / `UC2` / `UC3` / `UC5` / `OBSERVED` |
| `entity_id`, `action` | what changed (`turn_on`/`turn_off`/`toggle`/`bind`/`trigger`/`activate`/`state_changed`) |
| `room`, `floor`, `device_type` | device context (resolved for all device entities — see §6.1) |
| `friendly_name` | human-readable device name (e.g. "Balcony Table Lamp 1") resolved from Custom Storage snap sub-devices and docklet labels |
| `network_type` | `local` (always, today) |
| `tap_timestamp` | when the action started |
| `command_sent_timestamp` | when the REST command left the app |
| `rest_response_timestamp` | when HA's REST call returned |
| `ws_confirmation_timestamp` | when the matching `state_changed` arrived (UC1 only) |
| `end_to_end_latency_ms` | tap → confirmation (or tap → result) |
| `success`, `failure_reason` | outcome — failure codes: `TIMEOUT`, `NO_RESPONSE`, `DEVICE_OFFLINE`, `THREAD_MESH_FAIL` |
| `trigger_method`, `app_screen`, `riverpod_provider` | UI/source context |
| `docklet_id`, `dock_id` | set for bind / docklet-bridged events |

**Timeline by use case:**
- **UC1** captures the full `tap → command_sent → rest_response →
  ws_confirmation` timeline (real end-to-end latency).
- **UC2 / UC3** finalise on the call result (`tap → rest_response`); there is no
  single clean state echo to wait for, so `ws_confirmation_timestamp` is empty.
- **OBSERVED** has no latency — there was no command, only a witnessed change.

---

## 6. Where the data lives & how to read it

**Firestore:** `smash_db/<hub_mac>/app_events/<event_id>` — one document per
event, under the hub's existing document.

**BigQuery dataset:** `schnell-home-automation.schnell_analytics`. It contains
three objects — think **history → snapshot → readable**:

| Object | Type | What it is | When to use |
|---|---|---|---|
| `app_logs_raw_changelog` | table | The full append-only ledger — every create/update/delete is a row, event stored in a JSON `data` column. Created by the extension. | Full history / audit. |
| `app_logs_raw_latest` | view | Latest version of each document, deletes excluded. Created by the extension. Still raw JSON. | Current state, deduped. |
| `app_logs` | view | **Flattened, human-readable.** Reads from `app_logs_raw_latest` and expands the JSON `data` into named columns. Created by us (see §6.2). | Everyday reading / dashboards. |

Because our events are **written once and never updated**, all three contain the
same events (no dups). `app_logs` is the one to use day-to-day.

### 6.1 View it two ways

**Raw / JSON:** click `app_logs_raw_changelog` or `app_logs_raw_latest` →
**Preview** tab → see the raw `data` JSON blob.

**Clean columns:** query the flattened view (note the backticks wrap the
**whole** `project.dataset.table`):
```sql
SELECT *
FROM `schnell-home-automation.schnell_analytics.app_logs`
ORDER BY event_timestamp DESC
LIMIT 200;
```
Tip: a view has no Preview tab, but you don't need to retype — click the
`app_logs` view → **QUERY** button (auto-fills the SELECT), or run the query
once and **Save / ⭐** it for one-click reuse.

Same row, both ways:
- `raw_latest` → one big `data` JSON blob you must parse with `JSON_VALUE`.
- `app_logs` → ready-to-read columns (`use_case`, `room`, `latency_ms`, …). Same
  data, just pre-flattened so you never write `JSON_VALUE` again.

### 6.2 The flattened view definition

Run once in the BigQuery query editor to (re)create the readable view:
```sql
CREATE OR REPLACE VIEW `schnell-home-automation.schnell_analytics.app_logs` AS
SELECT
  JSON_VALUE(data, '$.timestamp')                    AS event_timestamp,
  JSON_VALUE(data, '$.use_case')                     AS use_case,
  JSON_VALUE(data, '$.entity_id')                    AS entity_id,
  JSON_VALUE(data, '$.action')                       AS action,
  JSON_VALUE(data, '$.room')                         AS room,
  JSON_VALUE(data, '$.floor')                        AS floor,
  JSON_VALUE(data, '$.device_type')                  AS device_type,
  JSON_VALUE(data, '$.friendly_name')                AS friendly_name,
  JSON_VALUE(data, '$.network_type')                 AS network_type,
  CAST(JSON_VALUE(data, '$.end_to_end_latency_ms') AS INT64) AS latency_ms,
  CAST(JSON_VALUE(data, '$.success') AS BOOL)        AS success,
  JSON_VALUE(data, '$.failure_reason')               AS failure_reason,
  JSON_VALUE(data, '$.trigger_method')               AS trigger_method,
  JSON_VALUE(data, '$.app_screen')                   AS app_screen,
  JSON_VALUE(data, '$.tap_timestamp')                AS tap_ts,
  JSON_VALUE(data, '$.command_sent_timestamp')       AS command_sent_ts,
  JSON_VALUE(data, '$.rest_response_timestamp')      AS rest_response_ts,
  JSON_VALUE(data, '$.ws_confirmation_timestamp')    AS ws_confirmation_ts,
  JSON_VALUE(data, '$.docklet_id')                   AS docklet_id,
  JSON_VALUE(data, '$.dock_id')                      AS dock_id,
  JSON_VALUE(data, '$.hub_id')                       AS hub_id,
  JSON_VALUE(data, '$.event_id')                     AS event_id,
  CAST(JSON_VALUE(data, '$.hour') AS INT64)          AS hour,
  JSON_VALUE(data, '$.day_of_week')                  AS day_of_week,
  JSON_VALUE(data, '$.date')                         AS date
FROM `schnell-home-automation.schnell_analytics.app_logs_raw_latest`
WHERE data IS NOT NULL;
```
(Swap the `FROM` to `app_logs_raw_changelog` if you want every change incl. dups.)

### 6.3 Handy analytics queries (run against `app_logs`)

```sql
-- Reliability % and latency percentiles, per hub
SELECT
  hub_id,
  COUNT(*)                                              AS events,
  ROUND(100 * COUNTIF(success) / COUNT(*), 2)           AS reliability_pct,
  APPROX_QUANTILES(latency_ms, 100)[OFFSET(50)]         AS p50_ms,
  APPROX_QUANTILES(latency_ms, 100)[OFFSET(95)]         AS p95_ms,
  ROUND(100 * COUNTIF(latency_ms < 1000) / COUNTIF(latency_ms IS NOT NULL), 2)
                                                        AS sub_1s_pct
FROM `schnell-home-automation.schnell_analytics.app_logs`
GROUP BY hub_id;

-- Breakdown by use case
SELECT use_case, COUNT(*) AS events, ROUND(AVG(latency_ms)) AS avg_ms
FROM `schnell-home-automation.schnell_analytics.app_logs`
GROUP BY use_case ORDER BY events DESC;

-- Usage heatmap (day x hour)
SELECT day_of_week, hour, COUNT(*) AS events
FROM `schnell-home-automation.schnell_analytics.app_logs`
GROUP BY day_of_week, hour ORDER BY day_of_week, hour;

-- Failures only
SELECT event_timestamp, entity_id, action, failure_reason, room, floor
FROM `schnell-home-automation.schnell_analytics.app_logs`
WHERE success = false
ORDER BY event_timestamp DESC;
```

### 6.4 Cost

Effectively **$0** at telemetry volume:
- The **view** costs nothing to exist (no storage; just a saved query).
- **Queries** are billed per data scanned, but the free tier is **1 TB/month** —
  our events are kilobytes.
- **Storage** (the changelog table) free tier is **10 GB/month**; we use KB.
- The **extension's** Cloud Functions sit inside the **2M invocations/month**
  free tier.
- The project is on the **Blaze (pay-as-you-go)** plan (required to install the
  extension), but the free tiers above still apply — charges only begin past
  them, which this volume will not reach.
- If the table ever reaches millions of rows, add **date partitioning** so
  queries only scan recent days. Not needed now.

---

### Room / floor enrichment

`room` and `floor` are populated for **every device entity**, regardless of how
the event arose:
- **UC1** device taps carry room/floor inline from the controls screen.
- **UC2 (docklet-bridged), automation/scene effects, and OBSERVED** events are
  enriched by `DeviceLocationResolver`, which looks up the entity's room/floor
  from the same home-setup + device-setup data the app already stores (cached,
  60s TTL).

So when an automation or scene changes a device, the resulting event is tagged
with that device's room and floor. Only the **automation/scene entity itself**
(`automation.*`, `scene.*`) has no room/floor — it isn't a physical device.

## 7. What the app **cannot** log (and why)

| Not captured | Why |
|---|---|
| Automations/scenes that fire on a **schedule or condition** | They run on the HA hub. The app didn't start them and is usually closed; it can't see the trigger. (At most, their *effects* are caught as `OBSERVED` if the app happens to be open.) |
| **Anything while the app is closed/backgrounded** | The WebSocket is disconnected — the app is blind. |
| **Who** caused an observed change | `state_changed` carries no actor; we log the effect only. |
| Direct **Thread/Matter mesh** control (UC4) | Bypasses the app entirely. |
| Docklet presses when the app is closed | The hub-side Matter binding still toggles the device, but no app is there to log it. |

**To capture these, logging must move to the hub.** The
`Production_Analytics_Architecture.md` design has the hub stream its own
`unified_event_log` / `ha_logs` into BigQuery — that is the only way to record
events that happen while the phone is asleep. It is future work, separate from
this app-side telemetry.

---

## 8. Privacy

- Events are keyed by `hub_id` — the raw hub MAC address (matches the hub-side pipeline for BigQuery joins).
- No user name, email, token, or IP is written into an event.
- Firestore access is scoped per the rules in
  [`../firestore.rules`](../firestore.rules); the BigQuery extension reads via a
  service account.
