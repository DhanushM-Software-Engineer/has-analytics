# Schnell Analytics — Formula Reference

Every number on the dashboard, explained in plain language.
Data sources: **app_logs** (commands from the app), **ha_logs** (events the hub recorded),
**dock_logs** (physical dock button counts, mirrored from the dock sheet).

All formulas only count events inside the **selected date range** (default: last 30 days).

---

> **Scope:** counts and reliability are **all-source** (app + dock + SNAP + scene +
> automation). Latency/speed is **app-command only** (only app events carry timestamps).
> App-*observed* changes are never shown (unreliable). Direct HA-screen control isn't
> counted yet (can't be separated from app commands — pending a hub-side fix).

## 1. Top KPIs (Overview)

### Total Events  (all sources)
```
Total Events = app commands + dock presses + scene activations + automation runs
```
Every reliable event, whoever triggered it. The tile's sub-line shows the App / Dock / Hub split.
App commands come from **app_logs**; dock, SNAP, scene and automation come from **ha_logs**.

### Reliability  (all sources)
```
Reliability % = (all successful events ÷ Total Events) × 100
```
Success spans app + dock + SNAP (each has a real pass/fail); scene and automation
runs count as successful activity. **Example:** 1,934 of 2,120 → **91.2%**.
When there are no app commands in range, the tile shows **"—"** (app-command detail undefined).

| Colour | Range |
|---|---|
| 🟢 Green | above 97% |
| 🟡 Yellow | 93% – 97% |
| 🔴 Red | below 93% |

### Failures
```
Failures = Total Events − successful events   (app + dock + SNAP failures)
```
Always reconciles: Total = Success + Failures, and equals the Failures-by-Reason sum.

### P50 Latency (median)
```
P50 = the middle value when all latencies are sorted
```
Half of all commands were faster than this, half were slower.
This is what a *typical* command feels like. Target: **under 1000ms**.

### North Star (Sub-1s Rate)
```
North Star % = (events faster than 1000ms ÷ events that have a latency value) × 100
```
Percentage of commands that finished in **under 1 second** — the single most user-facing quality number.
Events without a latency value (observed changes) are left out of this calculation.
Target: **≥ 95%**.

The tile shows the **Period Average** = the average of each day's North Star value.

---

## 2. Speed

Every app command records 4 timestamps:

```
tap_ts ──► command_sent_ts ──► rest_response_ts ──► ws_confirmation_ts
(user      (app sent REST       (hub replied /       (app received state
 tapped)    command)             ACK'd)               confirmation)
```

### Total latency (stored as latency_ms)
```
latency_ms = ws_confirmation_ts − tap_ts
```
The full journey: finger tap → device changed → app shows the new state.

### App Control (Local)
```
Avg  = average of latency_ms          (local Wi-Fi commands only)
P50  = median latency
P95  = 95% of commands were faster than this (worst-case experience)
```
Target: P50 **< 1000ms**.

### App Control (Remote)
Same formulas, but only for commands sent over the Internet.
Shows "Not tracked" until remote events exist.

### Hub → App (WebSocket Push)
```
push time = ws_confirmation_ts − rest_response_ts   (per event)
Avg / P50 / P95 computed over ALL events in the period
```
How long the hub takes to push the new device state to the phone.
Events with backwards timestamps (clock skew) are skipped. Target: **< 200ms**.

### Hub → SNAP → Hub
```
= snap_state_change_ts − matter_command_ts   (per event, from ha_logs; gap > 0)
Avg / P50 / P95 over those gaps
```
The real device round-trip: hub sends the Matter command → device confirms its new state.
Now **live** (early data ≈ 325ms p50). Uses the timestamp gap, **not**
`ha_processing_latency_ms` (that field is ~0–6ms, just HA's internal handling). Target: **< 300ms**.

### Std Dev (Standard Deviation) — on Speed by Use Case cards
```
Std Dev = how spread out the latencies are
```
Low = consistent, predictable speed. High = erratic (some fast, some very slow).

| Colour | Range |
|---|---|
| 🟢 Green | under 200ms — consistent |
| 🟡 Yellow | 200 – 500ms — moderate |
| 🔴 Red | over 500ms — erratic |

### Latency Buckets (distribution chart)
Each event lands in exactly one bucket based on its latency:

| Bucket | Range |
|---|---|
| `<500ms` | feels instant |
| `500ms–1s` | acceptable |
| `1–2s` | getting slow |
| `2–5s` | sluggish |
| `>5s` | investigate |

---

## 3. Reliability

### App Trigger → Feedback
```
= (successful app commands ÷ all app commands) × 100
```
When a user taps in the app, how often does the app get confirmation it worked?
Only counts "App Control" use cases. Target: **≥ 97%**.

### Dock Trigger Reliability
```
= (dock presses that activated the device ÷ all dock presses) × 100    [from ha_logs]
```
A dock press = a `call_service` tagged with `dock_id`; it **succeeds** if its `context_id`
produced a device state change to `on`/`off`, else it failed. Computed from **ha_logs**
(reliable, always-on), *not* from dock_logs. dock_logs is used only for the usage breakdown.

### Per-Source Reliability (table)
```
per source: reliability % = (success ÷ total) × 100
```
Grouped by how the command was triggered — the sources that have a real pass/fail:
**App Control (Local)**, **App Control (Remote)**, **Dock Control**.
(Observed Change is not shown; scene/automation are activations without a pass/fail.)

### Per-Device Reliability (Device Activity table)
```
per device: reliability % = (success ÷ total) × 100
P50 = median latency for that device only
```
Only physical SNAP devices are listed (light.*, switch.*, fan.*) —
virtual entities (scene.*, automation.*, script.*, group.*) are excluded.

### Failures by Reason
```
count of failed events grouped by failure_reason
```
Reasons: `TIMEOUT`, `NO_RESPONSE`, `DEVICE_OFFLINE`, `THREAD_MESH_FAIL` (app), and
`DEVICE_UNAVAILABLE` (dock / SNAP presses whose device didn't reach on/off).

### Failures by Device
```
count of failed events grouped by device, one column per reason
```
A device showing repeated failures likely has a power, Thread-mesh, or firmware issue.

---

## 4. Usage

### Automation / Day  ⭐ hub-recorded
```
= hub-recorded automation runs ÷ days in period
```
Counted from **ha_logs** (`automation_triggered` events). The hub records every run
even when the app is closed, so this is the reliable source.
**Example:** 7 runs ÷ 31 days = **0.23**

### Scene / Day  ⭐ hub-recorded
```
= hub-recorded scene activations ÷ days in period
```
Counted from **ha_logs** (scene `call_service` events). Same reasoning — the app only
observes scenes while it is open, so its counts are not used here.
**Example:** 7 activations ÷ 31 days = **0.23**

> Why not app-observed? The app missed runs while it was closed, and logged
> state-refresh bursts as false activations. Hub logs are the truth.

### Active SNAP Devices
```
= count of distinct physical devices with at least one event in the period
```
Only light.*, switch.*, fan.* — scenes/automations/scripts/groups excluded.

### App Usage Ratio
```
= app events ÷ (app events + dock events) × 100
```
Of all *manual* controls, what share came from the phone app? Dock events here are the
real dock presses from **ha_logs**. **Example:** 1717 ÷ (1717 + 384) = **81.7%**

### Dock Usage Ratio
```
= dock events ÷ (app events + dock events) × 100
```
The other half of the same split. App Ratio + Dock Ratio = 100%.

### Source Breakdown (doughnut)
```
counts of: App (Local) · Remote App · Dock Control · Hub (Scene/Auto)
```
These slices always add up exactly to Total Events. (Observed Change is excluded.)

### Dock Usage (panel)  — usage breakdown only, from dock_logs
```
Total Actions   = sum of total_action_count           [dock_logs]
per action      = sum grouped by action (toggle / increment / decrement)
```
This panel is **usage only**. Dock *reliability* is on the Reliability tab (from ha_logs).
*dock_logs is currently mock; ha_logs is real.*

---

## 5. Charts

### Daily Events & Reliability  (all sources)
```
per day: total = all-source event count · reliability % = success ÷ total × 100
```
Built from the complete event pool, so the bars sum to Total Events.

### North Star trend  (app commands)
```
per day: NS % = app events < 1000ms ÷ app events with latency × 100
```
App-only (latency exists only for app commands). Target line at **95%**.

### Activity Heatmap  (all sources)
```
cell value = event count for that (day of week, hour), across all sources
```
Darker blue = more activity. Hover shows the App / Remote / Dock / Hub split.
Built from the same event pool as the Log Center, so **clicking a cell filters the
Log Center to that exact day + hour and the counts match**.

### Failures Heatmap
```
cell value = failed-event count for that (day of week, hour)
```
Darker red = more failures in that time slot.

---

## 6. Quick reference — all targets

| Metric | Target |
|---|---|
| Reliability | ≥ 97% |
| North Star (Sub-1s) | ≥ 95% |
| App Control (Local) P50 | < 1000ms |
| App Control (Remote) P50 | < 3000ms |
| Hub → SNAP → Hub P50 | < 300ms |
| Hub → App (WS Push) P50 | < 200ms |
| App Trigger → Feedback | ≥ 97% |
| Dock Reliability | ≥ 97% |
| Std Dev (consistency) | < 200ms |
