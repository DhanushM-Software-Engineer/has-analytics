# Dock Telemetry — what the dock hardware logs, and how it reaches BigQuery

This document explains the **dock-side telemetry** — the physical dock's own
button-press counters — and how it flows from a Google Sheet into BigQuery for
the fleet analytics pipeline. It covers the data model, the auto-sync mechanism,
the schema, and how it complements the app-side and hub-side telemetry.

Related: [`APP_TELEMETRY.md`](APP_TELEMETRY.md) (app-side pipeline),
[`HA_TELEMETRY.md`](HA_TELEMETRY.md) (hub-side pipeline) and
[`../Analytics/Schnell_Analytics_Architecture.md`](../Analytics/Schnell_Analytics_Architecture.md)
(the full analytics architecture).

---

## 1. What dock telemetry is

A dock is a physical button panel; each button ("docklet") controls a device.
The dock hardware keeps its **own internal press counters** — how many times
each docklet was pressed, how many presses succeeded, how many failed.

This is different from the other two pipelines:

- **app_logs** sees a dock press only if the app is open to observe the result
- **ha_logs** sees the press itself (a `call_service` tagged with `dock_id`)
  *and* the state change it caused — reliably, 24/7, whether or not the app
  is open. **This is the actual source of dock reliability and press counts
  on the dashboard** — see §5, and don't be misled by the table name below.
- **dock_logs** is the dock hardware's own internal counters, entered into a
  Google Sheet — used **only** for the action-type usage breakdown
  (toggle/increment/decrement mix), not for reliability or counts

Each `dock_logs` row is **one docklet × one action type × one date** with
aggregate counts — not one row per press.

> **Caveat (added 2026-07-09):** `dock_id`/`docklet_id` on an `ha_logs` row is
> an entity-hardware mapping from Custom Storage, not an origin signal — *any*
> command on a dock-bound device carries `dock_id`, including one sent from
> the app. The dashboard's dock-press counting requires true dock origin
> (`log_source LIKE 'dock:%'` + `is_trigger`) to avoid counting app-triggered
> commands on dock-bound devices as physical presses — see `HA_TELEMETRY.md`
> §3a and `Schnell_Analytics_Architecture.md` §5.7.

---

## 2. Data flow

```
Dock hardware press counters
      ↓  (entered / exported into the dock Google Sheet)
Google Sheet  "Schnell Dock Data"
      ↓  Apps Script inside the Sheet (Analytics/dock_sheet_apps_script.gs)
      ↓  fires on EVERY change → load job, WRITE_TRUNCATE
BigQuery:  schnell_analytics.dock_logs   (native table — always mirrors the Sheet)
      ↓
Analytics/analytics-api/main.py  →  dashboard (Dock Reliability, Dock Usage panels)
```

**Why Apps Script and not a BigQuery external table:** the Workspace policy
blocks Drive-scoped gcloud credentials, which external Sheets tables require.
The Apps Script runs *inside* the Sheet under the owner's own account, so no
Drive scope, service account, or admin action is needed. Every edit in the
Sheet lands in BigQuery within seconds.

**Sync semantics:** each sync fully replaces the table (`WRITE_TRUNCATE`), so
`dock_logs` always mirrors the Sheet exactly — adds, edits, and deletions all
propagate. Running it twice is harmless.

---

## 3. Schema (`dock_logs` columns)

| Field | Type | Meaning |
|---|---|---|
| `hub_id` | STRING | Hub MAC address — scopes dock data to its hub, joins to `app_logs.hub_id` / `ha_logs.hub_id` |
| `date` | STRING (YYYY-MM-DD) | Date the counters cover |
| `day_of_week` | STRING | e.g. "Monday" |
| `dock_id` | STRING | Physical dock ID (unique per dock unit) |
| `docklet_id` | STRING | Docklet entity ID — one dock has multiple docklets |
| `action` | STRING | Button action type: `toggle`, `increment`, `decrement` |
| `total_action_count` | INT64 | Total presses of this docklet+action on this date |
| `success_count` | INT64 | Presses that completed successfully |
| `failure_count` | INT64 | Presses that failed internally |

Invariant: `success_count + failure_count = total_action_count` on every row.

> **Every new row added in the Sheet must include the `hub_id`.** A second hub's
> dock simply uses that hub's MAC — the dashboard separates hubs automatically.

---

## 4. Where the data lives & how to read it

**Google Sheet:** the editable source of truth (one tab, headers in row 1,
same column order as the schema above).

**BigQuery:** `schnell-home-automation.schnell_analytics.dock_logs` — native
table, replaced on every Sheet change by the embedded Apps Script.

### 4.1 View the table in Sheet order

The BigQuery **Preview tab does not preserve row order** — always query with an
`ORDER BY` when eyeballing against the Sheet:

```sql
SELECT *
FROM `schnell-home-automation.schnell_analytics.dock_logs`
ORDER BY date, docklet_id,
  CASE action WHEN 'toggle' THEN 1 WHEN 'increment' THEN 2 ELSE 3 END;
```

### 4.2 Totals check (should always match the Sheet's SUM formulas)

```sql
SELECT
  COUNT(*)                 AS row_cnt,
  SUM(total_action_count)  AS total,
  SUM(success_count)       AS success,
  SUM(failure_count)       AS failure,
  ROUND(100 * SUM(success_count) / SUM(total_action_count), 2) AS reliability_pct
FROM `schnell-home-automation.schnell_analytics.dock_logs`;
```

Sheet-side equivalents: `=SUM(G2:G127)`, `=SUM(H2:H127)`, `=SUM(I2:I127)`.

### 4.3 Handy analytics queries

```sql
-- Per-docklet reliability, worst first
SELECT
  docklet_id,
  SUM(total_action_count) AS presses,
  SUM(failure_count)      AS failures,
  ROUND(100 * SUM(success_count) / NULLIF(SUM(total_action_count), 0), 2) AS reliability_pct
FROM `schnell-home-automation.schnell_analytics.dock_logs`
GROUP BY docklet_id
ORDER BY failures DESC, presses DESC;

-- Daily press volume and reliability
SELECT
  date, day_of_week,
  SUM(total_action_count) AS presses,
  ROUND(100 * SUM(success_count) / NULLIF(SUM(total_action_count), 0), 2) AS reliability_pct
FROM `schnell-home-automation.schnell_analytics.dock_logs`
GROUP BY date, day_of_week
ORDER BY date;

-- Action mix (toggle vs dimming)
SELECT action, SUM(total_action_count) AS presses
FROM `schnell-home-automation.schnell_analytics.dock_logs`
GROUP BY action
ORDER BY presses DESC;

-- Dock presses vs what the app observed, per hub
SELECT
  d.hub_id,
  SUM(d.total_action_count) AS dock_hardware_presses,
  (SELECT COUNT(*)
   FROM `schnell-home-automation.schnell_analytics.app_logs` a
   WHERE a.hub_id = d.hub_id
     AND a.use_case = 'Docklet Press (App)') AS app_observed_presses
FROM `schnell-home-automation.schnell_analytics.dock_logs` d
GROUP BY d.hub_id;
```

---

## 5. How the dashboard uses dock_logs — and what it actually uses ha_logs for

This is the part most likely to surprise you: **dock reliability and press
counts do not come from `dock_logs`.** They come from `ha_logs` — a dock
press is a `call_service` row with `dock_id` set, and it succeeds if that
press's `context_id` produced a device `state_changed` reaching `on`/`off`.
`dock_logs` (the Sheet) is usage-breakdown only.

| Dashboard panel | What it actually reads |
|---|---|
| Dock Trigger Reliability (Reliability tab) | `ha_logs` — dock press rows (true dock origin + outcome), **not** `dock_logs` |
| Dock Reliability table | `ha_logs` — same press list, grouped by `dock_id`/`docklet_id` |
| Dock Usage panel (Usage tab) | `dock_logs` — totals by action type (toggle/increment/decrement) and by docklet |
| Dock Usage Ratio | `ha_logs` dock press count vs `app_logs` app command count |

The backend (`Analytics/analytics-api/main.py`, `f_dock_ev`) queries
`ha_logs` for presses (`WHERE dock_id IS NOT NULL AND ha_event_type=
'call_service'`, requiring true dock origin once the Hub Logging Spec fields
are present — see the caveat in §1) and separately queries `dock_logs`
(`f_dock`) purely for the action-type breakdown, both scoped by
`hub_id` + the selected date range.

---

## 6. Dock vs App vs Hub telemetry — key differences

| | App (`app_logs`) | Hub (`ha_logs`) | Dock (`dock_logs`) |
|---|---|---|---|
| **Source** | Flutter app | HA Data Catcher add-on | Dock hardware counters via Google Sheet |
| **Granularity** | One row per event | One row per event | One row per docklet × action × date (aggregates) |
| **Coverage** | Only while app open | Always — 24/7 | Every press, counted at the hardware |
| **Latency data** | Full tap→confirm timeline | `ha_processing_latency_ms` | None (counts only) |
| **Transport** | Firestore → BQ extension | Firestore → BQ extension | Sheet → Apps Script load job |
| **Freshness** | Near-real-time | Near-real-time | Seconds after any Sheet edit |
| **`hub_id`** | Raw MAC (join key) | Raw MAC (join key) | Raw MAC (join key) |

---

## 7. Operations

- **Add / correct data:** edit the Google Sheet — that's it. The Apps Script's
  On-change trigger syncs automatically ("Synced N rows" in its execution log).
- **Sync failed?** The trigger's failure notification emails the Sheet owner
  daily. Manual re-sync: open Extensions → Apps Script → run `syncToBigQuery`.
- **Dashboard lag:** the API caches per hub+range for 5 minutes; restart the
  server to see a Sheet edit immediately.
- **Script source of truth:** `Analytics/dock_sheet_apps_script.gs` in this repo —
  if the Sheet's script is ever lost, re-paste from there.

---

## 8. Privacy

- Rows are keyed by raw MAC address as `hub_id` — consistent with the other tables.
- Only aggregate press counts are stored — no user identity, no timestamps of
  individual presses.
- The Google Sheet is access-controlled by its owner; the Apps Script runs under
  the owner's account and writes only to `schnell_analytics.dock_logs`.
