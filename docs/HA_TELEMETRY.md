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
                       — classifies true origin: log_source, trigger_id,
                         is_trigger, actuation_source (see §3a)
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

Add-on code: `ha_data_catcher/app/` (folder name has changed a couple of
times during development — always check the repo root for the current one;
the internal structure below hasn't changed):
- `processors/event_parser.py` — parses raw HA events, generates `event_id`.
- `processors/event_enricher.py` — adds room/floor/device context, and runs
  the trigger classification described in §3a (`_classify_trigger`).
- `processors/metrics_fields.py` — computes `ha_processing_latency_ms`.
- `collectors/custom_storage_collector.py` — also polls the app's
  self-reported HA account id (`app_identity`, see §3a) every 30s.
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
from the hub's perspective it can't distinguish who triggered the change by
`use_case` alone. **True origin is resolved separately, via `log_source` —
see §3a.**

---

## 3a. True origin: `log_source`, `trigger_id`, `is_trigger`, `actuation_source`

Added 2026-07-09 (the "Hub Logging Spec"). One user action fans out into
several `ha_logs` rows (the triggering `call_service`/`automation_triggered`
event, plus the `state_changed` rows it causes). These four fields turn that
fan-out into something countable and attributable:

| Field | Meaning |
|---|---|
| `log_source` | **True origin** — who/what caused the action: `app:command`, `ha_ui:command`, `automation:<entity_id>`, `scene:<entity_id>`, or the hardware-layer fallback `dock:<id>` / `snap:<id>` / `ha:<domain>` when origin can't be determined from context alone |
| `actuation_source` | Which hardware physically carried it out — `dock:<id>` / `snap:<id>` / `ha:<domain>`. Always populated; `log_source` falls back to this when true origin is unknown |
| `trigger_id` | HA's own `context.id` — shared by every row one action produces. The same value the app captures off the confirming WebSocket `state_changed` event (not the REST command response — that's empty for async Matter/Thread devices) and stores as `app_logs.trigger_id`, so the two tables can be joined per-action. See `APP_TELEMETRY.md` for the full fix history |
| `is_trigger` | `true` on exactly the first (initiating) row for a given `trigger_id`; `false` on every later fan-out row. **Count `WHERE is_trigger` to get one row per action, not one row per fan-out event** |

**How `log_source` is decided** (in priority order, computed once per
`trigger_id` on its `is_trigger` row):
1. If the context belongs to a known `automation_triggered` or scene
   `call_service` event → `automation:<id>` / `scene:<id>`.
2. Else if `context_user_id` is set: compare it to the app's own HA account id
   (learned automatically — see below) → `app:command` if it matches,
   `ha_ui:command` if it doesn't.
3. Else (no `context_user_id` at all — e.g. a physical dock button press, or
   `app_ha_user_id` hasn't been learned yet) → fall back to `actuation_source`.

**Why not just compare HA user accounts everywhere?** This product only ever
has *one* Home Assistant account per hub — the mobile app and anyone using
the hub's own dashboard share it. So `context_user_id` alone can't always
tell them apart (confirmed 2026-07-09: toggling a device from the HA
dashboard produced the *same* `context_user_id` as an app command). The
dashboard backend (`analytics-api/main.py`) resolves this properly at query
time instead: an `is_trigger` row that isn't `automation:`/`scene:`/`dock:`/
`snap:`, and has **no matching `app_logs.trigger_id`**, can only be a direct
HA-UI action — see `Schnell_Analytics_Architecture.md` §5 ("Direct HA-UI
Control").

**How the app's own account id is learned (no config, no manual entry):**
the app captures its own `context.user_id` off any command response and
writes it once into Custom Storage (`app_identity` category/key). This
add-on's existing 30-second Custom Storage poll (`CustomStorageCollector`)
picks it up automatically and feeds it to the enricher — no add-on
restart, no admin permission, no config field.

**Known limitation:** `dock_id`/`docklet_id` are entity-hardware mappings
(from Custom Storage), not origin signals — *any* command on a dock-bound
device carries `dock_id`, including one sent from the app. Don't infer
"this was a physical dock press" from `dock_id` alone; use `log_source` /
`is_trigger` instead (the dashboard's dock-press counting does this — see
`DOCK_TELEMETRY.md`).

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
| `log_source` | True origin — `app:command` / `ha_ui:command` / `automation:<id>` / `scene:<id>`, or the hardware fallback `snap:<id>` / `dock:<id>` / `ha:<domain>` — see §3a |
| `actuation_source` | Hardware that carried out the action — `snap:<id>` / `dock:<id>` / `ha:<domain>` — see §3a |
| `trigger_id` | HA's context id, shared across one action's fan-out — join key to `app_logs.trigger_id` — see §3a |
| `is_trigger` | `true` on the one initiating row per action; `false` on fan-out — see §3a |
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
  SAFE_CAST(JSON_VALUE(data, '$.hour') AS INT64)                  AS hour,
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
  SAFE_CAST(JSON_VALUE(data, '$.ha_processing_latency_ms') AS INT64) AS ha_processing_latency_ms,
  JSON_VALUE(data, '$.thread_node_id')                            AS thread_node_id,
  JSON_VALUE(data, '$.network_type')                              AS network_type,
  JSON_VALUE(data, '$.actuation_source')                          AS actuation_source,
  JSON_VALUE(data, '$.trigger_id')                                AS trigger_id,
  SAFE_CAST(JSON_VALUE(data, '$.is_trigger') AS BOOL)             AS is_trigger
FROM `schnell-home-automation.schnell_analytics.ha_logs_raw_latest`
WHERE data IS NOT NULL;
```

> Ran and confirmed live 2026-07-09. The last three columns (`actuation_source`,
> `trigger_id`, `is_trigger`) are `NULL` on any row written before this view
> update — that's expected, not an error; older rows simply predate the Hub
> Logging Spec fields.
>
> **`hour` and `ha_processing_latency_ms` use `SAFE_CAST`, not `CAST`**
> (fixed 2026-07-10) — a plain `CAST` throws `Bad int64 value` and kills the
> *entire* query the moment it hits one historical row with a malformed
> value in either field (confirmed: some early rows have a decimal string
> like `"3.77"` where an integer was expected). `SAFE_CAST` just returns
> `NULL` for that one row and keeps going.

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

-- Automation-triggered events only
SELECT event_timestamp, entity_id, action, room, floor, ha_event_type
FROM `schnell-home-automation.schnell_analytics.ha_logs`
WHERE log_source LIKE 'automation:%' AND is_trigger
ORDER BY event_timestamp DESC;

-- Count activity by true origin (one row per action, not per fan-out event)
SELECT log_source, COUNT(*) AS actions
FROM `schnell-home-automation.schnell_analytics.ha_logs`
WHERE hub_id = @hub_id AND is_trigger
GROUP BY log_source
ORDER BY actions DESC;

-- Sanity check: is_trigger must be true on exactly one row per trigger_id
-- (should return zero rows)
SELECT trigger_id, COUNTIF(is_trigger) AS trigger_rows, COUNT(*) AS total_rows
FROM `schnell-home-automation.schnell_analytics.ha_logs`
WHERE trigger_id IS NOT NULL
GROUP BY trigger_id
HAVING trigger_rows <> 1;

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
| **Who caused it** | Known (it's the app) | Resolved via `log_source` — see §3a |
| **Latency data** | Full tap→confirm timeline | `ha_processing_latency_ms` only |
| **Automations** | ❌ Missed when app closed | ✅ Always captured |
| **`hub_id`** | Raw MAC address | Raw MAC address (join key) |
| **`use_case`** | `Local App Control`, `Docklet Press (App)`, etc. | `Hub Observed` |
| **`trigger_id`** | HA context id captured off the confirming WebSocket event | HA's own context id (native) — same value, joins the two tables |

---

## 8. Privacy

- Events are keyed by raw MAC address as `hub_id` — consistent with the app side.
- No user name, email, or passwords are written into any event field.
- `context_user_id` is a HA internal user ID, not a personal identifier.
- Firestore access is scoped per `firestore.rules`; the BigQuery extension reads
  via its own service account.
