# Analytics Dashboard — Formula Reference

All formulas are computed in `analytics-api/main.py` from BigQuery tables
`schnell_analytics.app_logs` (app-initiated events) and
`schnell_analytics.ha_logs` (Home Assistant processing events).
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
| avg | `AVG(latency_ms)` for hub_id, days window |
| p50 | `APPROX_QUANTILES(latency_ms, 100)[OFFSET(50)]` |
| p95 | `APPROX_QUANTILES(latency_ms, 100)[OFFSET(95)]` |

### Hub → SNAP → Hub (`speed.hub_snap_hub`)
Hub issues Matter command over Thread mesh → SNAP device activates → state reflected back to hub.

| Metric | Formula |
|--------|---------|
| avg / p50 / p95 | Same quantile formula on `ha_processing_latency_ms` from ha_logs |

### Hub → App (`speed.hub_app`)
State confirmed at hub (snap_ts) → WebSocket push → App reflects state.
Currently returns `p50` derived from `hs_kpi.p50` as an approximation (no dedicated field yet).

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

## Heatmap

Grouped from `app_logs` by `day_of_week` (e.g. "Monday") and `hour` (0–23).
Key format: `"Monday_14"`.

| Field | Formula |
|-------|---------|
| `events` | `COUNT(*)` |
| `app` | `COUNTIF(use_case IN ('Local App Control', 'Device Bind (App)'))` |
| `dock` | `COUNTIF(use_case = 'Docklet Press (App)')` |
| `remote` | `COUNTIF(use_case = 'Remote App Control')` |
| `auto` | `COUNTIF(use_case = 'Observed Change (App)')` |

---

## Reliability Detail

### App Trigger Feedback (`reliability_detail.app_trigger_feedback`)
Formula: **App Feedbacks ÷ App Triggers**

| Field | Definition |
|-------|-----------|
| `app_triggers` | COUNT of rows where use_case IN ('Local App Control', 'Device Bind (App)', 'Remote App Control') |
| `app_feedbacks` | COUNT of those rows where success = true |
| `app_trigger_feedback` | `ROUND(100 × app_feedbacks / app_triggers, 2)` |

### Dock Trigger Reliability (`reliability_detail.dock_trigger_feedback`)
Formula: **Dock Feedbacks ÷ Dock Triggers**

| Field | Definition |
|-------|-----------|
| `dock_triggers` | COUNT of rows where use_case LIKE '%Docklet%' |
| `dock_feedbacks` | COUNT of those rows where success = true |
| `dock_trigger_feedback` | `ROUND(100 × dock_feedbacks / dock_triggers, 2)` |

### Hub → SNAP Count
`hub_to_snap_count` = `COUNT(*)` from ha_logs for hub_id in window.
Used by hub→app formula: **App Feedbacks ÷ Hub SNAP Commands** (KPI removed from UI; field kept for reference).

### Per-Source Reliability (`reliability_detail.src_rel`)
Grouped by `use_case`:
- `total`, `success`, `fail` = COUNT per group
- `rel` = `ROUND(100 × success / total, 2)`

### Dock Stats (`reliability_detail.dock_stats`)
Sourced from `dock_data.xlsx` (not BigQuery). Mapped to hub via `ha_logs.dock_id`.
Per docklet:
- `total` / `success` / `failure` = sum of xlsx columns `total_action_count` / `success_count` / `failure_count`
- `rel` = `ROUND(100 × success / total, 2)`
- `actions[]` = per-action breakdown with same fields

---

## Usage (Source Breakdown)

Computed from `app_logs` for hub_id in window:

| Field | Formula |
|-------|---------|
| `app` | `COUNTIF(use_case IN ('Local App Control', 'Device Bind (App)'))` |
| `docklet` | `COUNTIF(use_case = 'Docklet Press (App)')` |
| `remote` | `COUNTIF(use_case = 'Remote App Control')` |
| `direct` | `COUNTIF(use_case = 'Observed Change (App)')` |
| `app_ratio` | `ROUND(100 × app / (app + docklet), 2)` |
| `dock_ratio` | `ROUND(100 × docklet / (app + docklet), 2)` |
| `scene_per_day` | `ROUND(direct / days, 2)` |

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

## Failures

### All Failures (`failures[]`)
Last 100 failed events from `app_logs` WHERE success = false, ordered by event_timestamp DESC.

### Failures by Reason (`fail_by_reason`)
Grouped from `app_logs` WHERE success = false AND failure_reason IS NOT NULL:

| Field | Formula |
|-------|---------|
| `count` | `COUNT(*)` per `failure_reason` |
| `events[]` | Sample events for that reason (up to 300 most recent, shared across all reasons) |

### Failures by Device (`fail_by_device`)
Grouped from `app_logs` WHERE success = false, by entity_id + failure_reason:

| Field | Formula |
|-------|---------|
| `count` | Total failures for this device across all reasons |
| `reasons{}` | Dict: reason → count |

---

## North Star (Sub-1s Rate)

`ns` = percentage of events with `latency_ms < 1000`, computed per day.
Fleet-level = average of all hubs' daily `ns` values.
Target: ≥ 85%.

---

## Reliability Thresholds (UI color coding)

| Range | Color |
|-------|-------|
| > 97% | Green |
| 93%–97% | Yellow |
| < 93% | Red |
