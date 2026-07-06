# HA Telemetry — what the hub logs, and how it reaches BigQuery

This document explains the **hub-side telemetry** that streams device events
from the Home Assistant hub into BigQuery for the fleet analytics pipeline.
It covers which events are captured, the event schema, where the data lands,
and how it complements the app-side telemetry.

Related: [`APP_TELEMETRY.md`](APP_TELEMETRY.md) (the app-side pipeline),
[`DOCK_TELEMETRY.md`](DOCK_TELEMETRY.md) (the dock-side pipeline) and
[`../Analytics/Schnell_Analytics_Architecture.md`](../Analytics/Schnell_Analytics_Architecture.md)
(the full analytics architecture).

---

## 1. The one rule that governs everything

The hub logs an event **any time a device state changes in Home Assistant**,
regardless of what caused it:

- App command → hub → device → **logged**
- Physical docklet button press → device → **logged**
- Hub-side automation / schedule → device → **logged**
- Direct Thread/Matter mesh action → device → **logged**
- App closed, app open, doesn't matter — **always logged**

This is the key difference from app-side telemetry, which only captures events
the app initiated or witnessed while open. The hub sees everything.

---

## 2. Data flow

```
Home Assistant WebSocket (state_changed, call_service, automation_triggered, …)
  → HA Data Catcher add-on
      EventParser      — generates event_id, timestamps, context fields
      EventEnricher    — resolves room, floor, device_type from Custom Storage
                       — computes ha_processing_latency_ms
      FirestoreWriter
            ↓
  Firestore:  smash_db/<hub_mac>/ha_events/<event_id>
            ↓  Firebase "Stream Firestore to BigQuery" extension
  BigQuery:   schnell_analytics.ha_logs_raw_changelog   (append-only table)
              schnell_analytics.ha_logs_raw_latest       (view — latest state)
              schnell_analytics.ha_logs                  (flattened view — use this)
```

- Events are grouped by `hub_id` (the hub's raw MAC address).
- `event_id` is a UUID — the Firestore doc ID and future join key to `app_events`.
- `hub_id` on the hub side matches `hub_id` on the app side, enabling cross-table
  joins in BigQuery.

Add-on code: `ha_data_catcher/app/`
- `processors/event_parser.py` — parses raw HA events, generates `event_id`.
- `processors/event_enricher.py` — adds room/floor/device context.
- `processors/metrics_fields.py` — computes `ha_processing_latency_ms`.
- `firebase/firestore_writer.py` — batched Firestore writer.

---

## 3. What the hub captures

| What happens | Logged? | `use_case` | Condition |
|---|---|---|---|
| App turns device on/off | ✅ | `Hub Observed` | always |
| Physical docklet button press | ✅ | `Hub Observed` | always |
| Hub-side automation fires on schedule | ✅ | `Hub Observed` | always |
| Scene activated (any source) | ✅ | `Hub Observed` | always |
| Direct Thread/Matter mesh action | ✅ | `Hub Observed` | always |
| External HA dashboard control | ✅ | `Hub Observed` | always |
| App closed, nobody home | ✅ | `Hub Observed` | always |

All hub-side events share the same `use_case` value — `Hub Observed` — because
from the hub's perspective it can't distinguish who triggered the change, only
that it happened. Cross-referencing `context_user_id` can help identify
user-triggered vs automated events.

---

## 4. Noise filtering

The following are automatically dropped and never written to Firestore:

**Event types dropped:**
`time_changed`, `themes_updated`, `component_loaded`, `core_config_updated`,
`recorder_5min_statistics_generated`, `recorder_hourly_statistics_generated`

**Domains dropped:**
`device_tracker`, `upnp`, `sun`, `zone`, `weather`

**Entity prefixes dropped:**
Router sensors, network sensors, WiFi sensors, ping, bandwidth, uptime entities

**Rapid duplicates:**
Identical state changes on the same entity within 500ms are deduplicated.

---

## 5. Event schema (`ha_logs` columns)

Each event is one row. Stored as Firestore document fields; the BigQuery
extension wraps them in a JSON `data` column — the `ha_logs` view pre-flattens
everything so you never write `JSON_VALUE` manually.

| Field | Meaning |
|---|---|
| `hub_id` | Raw hub MAC address — grouping key, joins to `app_logs.hub_id` |
| `event_id` | UUID — Firestore doc ID and future join key to `app_events` |
| `event_timestamp` | ISO-8601 event time (local timezone) |
| `date`, `time`, `hour`, `day_of_week` | Analytics-friendly time splits |
| `log_source` | `snap:<id>`, `dock:<id>`, or `ha:<domain>` — identifies hardware source |
| `friendly_name` | human-readable device name (e.g. "Balcony Table Lamp 1") resolved from Custom Storage snap sub-devices and docklet labels |
| `use_case` | Always `Hub Observed` |
| `ha_event_type` | HA internal event type (`state_changed`, `call_service`, …) |
| `entity_id` | HA entity that changed |
| `action` | `turn_on` / `turn_off` / `state_transition` / `trigger` / etc. |
| `old_state` | Device state before the change |
| `new_state` | Device state after the change |
| `room` | Room resolved from Custom Storage metadata |
| `floor` | Floor resolved from Custom Storage metadata |
| `device_type` | Load type (`Light`, `Fan`, `docklet`, `snap`, …) |
| `origin` | `LOCAL` or `REMOTE` |
| `context_id` | HA internal transaction token |
| `context_user_id` | HA user who triggered the change (null for automations) |
| `docklet_id` | Docklet entity ID (dock events only) |
| `dock_id` | Dock hardware ID (dock events only) |
| `docklet_state_change_ts` | Timestamp of docklet state acknowledgement |
| `matter_command_ts` | Timestamp of Matter-level command |
| `snap_state_change_ts` | Timestamp of Snap device state acknowledgement |
| `ha_processing_latency_ms` | `snap_state_change_ts − event_timestamp` in ms |
| `thread_node_id` | Matter/Thread node ID |
| `network_type` | Always `local` |

---

## 6. Where the data lives & how to read it

**Firestore:** `smash_db/<hub_mac>/ha_events/<event_id>` — one document per event.

**BigQuery dataset:** `schnell-home-automation.schnell_analytics`. Three objects:

| Object | Type | What it is | When to use |
|---|---|---|---|
| `ha_logs_raw_changelog` | table | Full append-only ledger. Every Firestore write is a row, event in JSON `data` column. | Full history / audit. |
| `ha_logs_raw_latest` | view | Latest version of each document, deletes excluded. Raw JSON. | Current state, deduped. |
| `ha_logs` | view | **Flattened, human-readable.** JSON expanded into named columns. | Everyday queries / dashboards. |

### 6.1 Query the flattened view

```sql
SELECT *
FROM `schnell-home-automation.schnell_analytics.ha_logs`
ORDER BY event_timestamp DESC
LIMIT 200;
```

### 6.2 The flattened view definition

Run once in the BigQuery query editor to (re)create the readable view:

```sql
CREATE OR REPLACE VIEW `schnell-home-automation.schnell_analytics.ha_logs` AS
SELECT
  JSON_VALUE(data, '$.hub_id')                                    AS hub_id,
  JSON_VALUE(data, '$.event_id')                                  AS event_id,
  JSON_VALUE(data, '$.timestamp')                                 AS event_timestamp,
  JSON_VALUE(data, '$.date')                                      AS date,
  JSON_VALUE(data, '$.time')                                      AS time,
  CAST(JSON_VALUE(data, '$.hour') AS INT64)                       AS hour,
  JSON_VALUE(data, '$.day_of_week')                               AS day_of_week,
  JSON_VALUE(data, '$.log_source')                                AS log_source,
  JSON_VALUE(data, '$.friendly_name')                             AS friendly_name,
  JSON_VALUE(data, '$.use_case')                                  AS use_case,
  JSON_VALUE(data, '$.ha_event_type')                             AS ha_event_type,
  JSON_VALUE(data, '$.entity_id')                                 AS entity_id,
  JSON_VALUE(data, '$.action')                                    AS action,
  JSON_VALUE(data, '$.old_state')                                 AS old_state,
  JSON_VALUE(data, '$.new_state')                                 AS new_state,
  JSON_VALUE(data, '$.room')                                      AS room,
  JSON_VALUE(data, '$.floor')                                     AS floor,
  JSON_VALUE(data, '$.device_type')                               AS device_type,
  JSON_VALUE(data, '$.origin')                                    AS origin,
  JSON_VALUE(data, '$.context_id')                                AS context_id,
  JSON_VALUE(data, '$.context_user_id')                           AS context_user_id,
  JSON_VALUE(data, '$.docklet_id')                                AS docklet_id,
  JSON_VALUE(data, '$.dock_id')                                   AS dock_id,
  JSON_VALUE(data, '$.docklet_state_change_ts')                   AS docklet_state_change_ts,
  JSON_VALUE(data, '$.matter_command_ts')                         AS matter_command_ts,
  JSON_VALUE(data, '$.snap_state_change_ts')                      AS snap_state_change_ts,
  CAST(JSON_VALUE(data, '$.ha_processing_latency_ms') AS INT64)   AS ha_processing_latency_ms,
  JSON_VALUE(data, '$.thread_node_id')                            AS thread_node_id,
  JSON_VALUE(data, '$.network_type')                              AS network_type
FROM `schnell-home-automation.schnell_analytics.ha_logs_raw_latest`
WHERE data IS NOT NULL;
```

### 6.3 Handy analytics queries

```sql
-- All events per hub, ordered by time
SELECT hub_id, event_timestamp, entity_id, action, room, floor, device_type
FROM `schnell-home-automation.schnell_analytics.ha_logs`
ORDER BY event_timestamp DESC
LIMIT 200;

-- Hub processing latency percentiles
SELECT
  hub_id,
  COUNT(*)                                                        AS events,
  APPROX_QUANTILES(ha_processing_latency_ms, 100)[OFFSET(50)]    AS p50_ms,
  APPROX_QUANTILES(ha_processing_latency_ms, 100)[OFFSET(95)]    AS p95_ms
FROM `schnell-home-automation.schnell_analytics.ha_logs`
WHERE ha_processing_latency_ms IS NOT NULL
GROUP BY hub_id;

-- Usage heatmap (day x hour)
SELECT day_of_week, hour, COUNT(*) AS events
FROM `schnell-home-automation.schnell_analytics.ha_logs`
GROUP BY day_of_week, hour
ORDER BY day_of_week, hour;

-- Automation-triggered events only (no user context)
SELECT event_timestamp, entity_id, action, room, floor, ha_event_type
FROM `schnell-home-automation.schnell_analytics.ha_logs`
WHERE context_user_id IS NULL
  AND ha_event_type = 'automation_triggered'
ORDER BY event_timestamp DESC;

-- Join app and hub events for the same hub
SELECT
  h.event_timestamp   AS hub_ts,
  a.event_timestamp   AS app_ts,
  h.entity_id,
  h.action            AS hub_action,
  a.action            AS app_action,
  h.room
FROM `schnell-home-automation.schnell_analytics.ha_logs` h
JOIN `schnell-home-automation.schnell_analytics.app_logs` a
  ON h.hub_id = a.hub_id
 AND h.entity_id = a.entity_id
ORDER BY h.event_timestamp DESC
LIMIT 100;
```

---

## 7. Hub vs App telemetry — key differences

| | App (`app_logs`) | Hub (`ha_logs`) |
|---|---|---|
| **Coverage** | Only while app is open + connected | Always — 24/7 |
| **Who caused it** | Known (app user) | Unknown (use `context_user_id` to infer) |
| **Latency data** | Full tap→confirm timeline | `ha_processing_latency_ms` only |
| **Automations** | ❌ Missed when app closed | ✅ Always captured |
| **`hub_id`** | Raw MAC address | Raw MAC address (join key) |
| **`use_case`** | `Local App Control`, `Docklet Press (App)`, etc. | `Hub Observed` |

---

## 8. Privacy

- Events are keyed by raw MAC address as `hub_id` — consistent with the app side.
- No user name, email, or passwords are written into any event field.
- `context_user_id` is a HA internal user ID, not a personal identifier.
- Firestore access is scoped per `firestore.rules`; the BigQuery extension reads
  via its own service account.
