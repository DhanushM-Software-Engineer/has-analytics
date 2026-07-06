# Schnell Analytics — Formula Reference

Every number on the dashboard, explained in plain language.
Data sources: **app_logs** (commands from the app), **ha_logs** (events the hub recorded),
**dock_logs** (physical dock button counts, mirrored from the dock sheet).

All formulas only count events inside the **selected date range** (default: last 30 days).

---

## 1. Top KPIs (Overview)

### Total Events
```
Total Events = count of all rows in app_logs for this hub
```
Every command or observed change the app logged — app taps, dock presses, remote controls, observed changes.

### Reliability
```
Reliability % = (successful events ÷ total events) × 100
```
**Example:** 1,829 succeeded out of 1,838 total → 1829 ÷ 1838 × 100 = **99.51%**

| Colour | Range |
|---|---|
| 🟢 Green | above 97% |
| 🟡 Yellow | 93% – 97% |
| 🔴 Red | below 93% |

### Failures
```
Failures = total events − successful events
```

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
= ha_processing_latency_ms from ha_logs
```
How long the hub takes to command the device and get the state back.
Currently shows **"No data"** because the hub reports 0ms for every event
(hub-side recording gap — will fill in automatically once fixed in firmware).

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
= (sum of success_count ÷ sum of total_action_count) × 100    [from dock_logs]
```
Comes from the dock hardware's own press counters, not from the app.
**Example:** 132 successful presses of 134 total → **98.51%**

### Per-Source Reliability (table)
```
per source: reliability % = (success ÷ total) × 100
```
Same formula, grouped by how the command was triggered:
App Control (Local), App Control (Remote), Docklet Press (Observed from App), Observed Change.

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
Reasons: `TIMEOUT`, `NO_RESPONSE`, `DEVICE_OFFLINE`, `THREAD_MESH_FAIL`.

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
Of all *manual* controls, what share came from the phone app?
**Example:** 1717 ÷ (1717 + 30) = **98.28%**

### Dock Usage Ratio
```
= dock events ÷ (app events + dock events) × 100
```
The other half of the same split. App Ratio + Dock Ratio = 100%.

### Source Breakdown (doughnut)
```
counts of: App (Local) · Remote App · Dock Control · Observed Change
```
These four counts always add up exactly to Total Events.

### Dock Usage (panel)
```
Total Actions   = sum of total_action_count           [dock_logs]
per action      = sum grouped by action (toggle / increment / decrement)
per docklet     = sum grouped by docklet_id
daily reliability = success ÷ total per date
```

---

## 5. Charts

### Daily Events & Reliability
```
per day: total = event count · reliability % = success ÷ total × 100
```

### North Star trend
```
per day: NS % = events < 1000ms ÷ events with latency × 100
```
Target line drawn at **95%**.

### Activity Heatmap
```
cell value = event count for that (day of week, hour)
```
Darker blue = more activity. Hover shows the App/Dock/Remote/Observed split.

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
