# Analytics Dashboard — Formula Reference

All formulas are computed in `analytics-api/main.py` from BigQuery tables
`schnell_analytics.app_logs` (app-initiated events) and
`schnell_analytics.ha_logs` (Home Assistant processing events), plus
`dock_data.xlsx` for dock hardware stats.
Dashboard JS reads the output of `GET /api/hub/{hub_id}?days=30`.

---

## Top-Level KPIs

| Field | Formula | Source |
|-------|---------|--------|
| `total` | `COUNT(*)` | app_logs |
| `success` | `COUNTIF(success = true)` | app_logs |
| `reliability` | `ROUND(100 × success / total, 2)` | app_logs |

---

## Speed Segments

### Local E2E (`speed.local_e2e`)
Full round-trip: App tap → REST to Hub → SNAP device activates → WebSocket push back to App.

| Metric | Formula |
|--------|---------|
| avg | `ROUND(AVG(latency_ms))` |
| p50 | `APPROX_QUANTILES(latency_ms, 100)[OFFSET(50)]` |
| p95 | `APPROX_QUANTILES(latency_ms, 100)[OFFSET(95)]` |

### Hub → SNAP → Hub (`speed.hub_snap_hub`)
Hub issues Matter command over Thread mesh → SNAP device activates → state reflected back to hub.

| Metric | Formula |
|--------|---------|
| avg / p50 / p95 | Same quantile formula on `ha_processing_latency_ms` from ha_logs |

### Hub → App (`speed.hub_app`) — WebSocket Push
State confirmed at hub (`snap_state_change_ts`) → hub pushes via WebSocket → app reflects new state.

| Metric | How it's computed |
|--------|------------------|
| P50 (server) | Approximated as `hub_snap_hub.p50` (no dedicated field yet) |
| Per-event (client) | `ws_confirmation_ts − rest_response_ts` derived from each `local_e2e` event |

### Remote E2E (`speed.remote_e2e`)
Full round-trip via the internet: App sends cmd remotely → Hub receives → SNAP activates → state pushed back to app.
Same AVG / P50 / P95 formulas as Local E2E, scoped to `use_case = 'Remote App Control'`.
*(Currently returns 0,0,0 — computed once remote events are available.)*

### Per Use-Case Speed (`speed.per_uc`)
Same AVG / P50 / P95 formulas on `latency_ms`, grouped by `use_case`.

---

## Latency Buckets

| Bucket | Range |
|--------|-------|
| `<500ms` | latency_ms < 500 |
| `500-1000ms` | 500 ≤ latency_ms < 1000 |
| `1-2s` | 1000 ≤ latency_ms < 2000 |
| `2-5s` | 2000 ≤ latency_ms < 5000 |
| `>5s` | latency_ms ≥ 5000 |

Count = `COUNT(*)` per bucket, grouped per hub and days window.

---

## Daily Trend

Per-day aggregation from `app_logs` grouped by `date`:

| Field | Formula |
|-------|---------|
| `total` | `COUNT(*)` |
| `rel` | `ROUND(100 × COUNTIF(success) / COUNT(*), 2)` |
| `p50` | `APPROX_QUANTILES(latency_ms, 100 IGNORE NULLS)[OFFSET(50)]` |
| `ns` (North Star) | `ROUND(100 × COUNTIF(latency_ms < 1000) / NULLIF(COUNTIF(latency_ms IS NOT NULL), 0), 2)` |

---

## Activity Heatmap

From `app_logs`, grouped by `day_of_week` × `hour`. Key format: `"Monday_14"`.

| Field | Formula |
|-------|---------|
| `events` | `COUNT(*)` — all use cases |
| `app` | `COUNTIF(use_case IN ('Local App Control', 'Device Bind (App)'))` |
| `remote` | `COUNTIF(use_case = 'Remote App Control')` |
| `auto` | `COUNTIF(use_case = 'Observed Change (App)')` |

---

## Reliability Detail

### App Trigger → Feedback (`reliability_detail.app_trigger_feedback`)
Formula: **App Feedbacks ÷ App Triggers**

| Field | Definition |
|-------|-----------|
| `app_triggers` | COUNT of rows where use_case contains "App Control" (Local + Remote) |
| `app_feedbacks` | COUNT of those rows where success = true |
| `app_trigger_feedback` | `ROUND(100 × app_feedbacks / app_triggers, 2)` |

### Dock Trigger → Feedback (`reliability_detail.dock_trigger_feedback`)
Formula: **Dock Successes ÷ Total Dock Actions** — sourced from `dock_data.xlsx`, not app_logs.

| Field | Definition |
|-------|-----------|
| Numerator | `sum(success_count)` across all docklets for this hub in the days window |
| Denominator | `sum(total_action_count)` same scope |
| `dock_trigger_feedback` | `ROUND(100 × numerator / denominator, 2)` |

Dashboard display: `dockRel = sum(dock_stats[].success) / sum(dock_stats[].total) × 100`

### Dock → Hub Transit (`reliability_detail.dock_to_hub`)
Formula: **Dock events that reached HA ÷ Total physical dock presses**
Measures what percentage of physical button presses successfully traversed the Thread mesh and were processed by Home Assistant.

| Field | Definition |
|-------|-----------|
| Numerator | `COUNT(*)` from ha_logs WHERE `dock_id IS NOT NULL` for this hub in window |
| Denominator | `sum(total_action_count)` from `dock_data.xlsx` for this hub |
| `dock_to_hub` | `ROUND(100 × numerator / denominator, 2)` |

### Hub → App Confirm (`reliability_detail.hub_to_app`)
Formula: **App Feedbacks ÷ Hub → SNAP Commands**
Measures how many HA-issued SNAP commands ultimately resulted in confirmed app feedback.

| Field | Definition |
|-------|-----------|
| Numerator | `app_feedbacks` (successful app-triggered events from app_logs) |
| Denominator | `hub_to_snap_count` = `COUNT(*)` from ha_logs for this hub in window |
| `hub_to_app` | `ROUND(100 × app_feedbacks / hub_to_snap_count, 2)` |

### Hub → SNAP Count
`hub_to_snap_count` = `COUNT(*)` from ha_logs for hub_id in window.

### Per-Source Reliability (`reliability_detail.src_rel`)
Grouped by `use_case`:
- `total`, `success`, `fail` = COUNT per group
- `rel` = `ROUND(100 × success / total, 2)`

### Dock Stats (`reliability_detail.dock_stats`)
Sourced from `dock_data.xlsx` (not BigQuery). Linked to hub via `ha_logs.dock_id`.
Grouped by `dock_id` — one entry per physical dock:

| Field | Formula |
|-------|---------|
| `total` | Sum of `total_action_count` across all docklets in the dock |
| `success` | Sum of `success_count` |
| `failure` | Sum of `failure_count` |
| `rel` | `ROUND(100 × success / total, 2)` |
| `docklets[]` | Per-docklet breakdown with the same fields + `actions[]` per action type |

---

## Usage (Source Breakdown)

Computed from `app_logs` for hub_id in window:

| Field | Formula |
|-------|---------|
| `app` | `COUNTIF(use_case IN ('Local App Control', 'Device Bind (App)'))` |
| `remote` | `COUNTIF(use_case = 'Remote App Control')` |
| `direct` (Automation) | `COUNTIF(use_case = 'Observed Change (App)' AND device_type != 'scene')` |
| `scene` | `COUNTIF(device_type = 'scene')` |
| `app_ratio` | `ROUND(100 × app / (app + docklet), 2)` |
| `dock_ratio` | `ROUND(100 × docklet / (app + docklet), 2)` |
| `auto_ratio` | `ROUND(100 × direct / total_usage, 2)` |
| `scene_ratio` | `ROUND(100 × scene / total_usage, 2)` |
| `auto_per_day` | `ROUND(direct / days, 2)` |
| `scene_per_day` | `ROUND(scene / days, 2)` |

> There is no `Docklet Press (App)` use case. Dock button presses are observed by
> the app as `Observed Change (App)`. Physical dock press counts come from
> `dock_data.xlsx` via the Dock Stats and Dock Usage sections below.

---

## Dock Usage (`dock_usage`)

Sourced from `dock_data.xlsx`. Aggregated from rows filtered to this hub:

| Field | Formula |
|-------|---------|
| `total` | Sum of all `total_action_count` |
| `by_action` | Dict: action → sum of `total_action_count` |
| `by_docklet` | Dict: docklet_id → sum of `total_action_count` |
| `daily[]` | Per-date: total / success / failure / rel |

---

## Device Activity

From `app_logs`, grouped by `entity_id`. Top 50 devices by total event count.

| Field | Formula |
|-------|---------|
| `total` | `COUNT(*)` |
| `success` | `COUNTIF(success = true)` |
| `rel` | `ROUND(100 × success / total, 2)` |
| `p50` | `APPROX_QUANTILES(latency_ms, 100 IGNORE NULLS)[OFFSET(50)]` |

---

## Failures

### All Failures (`failures[]`)
Last 100 failed events from `app_logs` WHERE `success = false`, ordered by `event_timestamp DESC`.

### Failures by Reason (`fail_by_reason`)
Grouped from `app_logs` WHERE `success = false AND failure_reason IS NOT NULL`:

| Field | Formula |
|-------|---------|
| `count` | `COUNT(*)` per `failure_reason` |
| `events[]` | Up to 300 most recent sample events across all reasons |

Known failure reason values: `TIMEOUT`, `NO_RESPONSE`, `DEVICE_OFFLINE`, `THREAD_MESH_FAIL`

### Failures by Device (`fail_by_device`)
Grouped from `app_logs` WHERE `success = false`, by `entity_id` + `failure_reason`:

| Field | Formula |
|-------|---------|
| `count` | Total failures for this device across all reasons |
| `reasons{}` | Dict: reason → count |

---

## North Star (Sub-1s Rate)

`ns` = percentage of events with `latency_ms < 1 000`, computed per day.
Fleet-level = average of all hubs' daily `ns` values.
Target: ≥ 85%.

---

## Reliability Thresholds (UI colour coding)

| Range | Colour |
|-------|--------|
| > 97% | Green |
| 93%–97% | Yellow |
| < 93% | Red |
