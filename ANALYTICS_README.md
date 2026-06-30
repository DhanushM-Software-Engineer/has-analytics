# Schnell Analytics Dashboard

## What This Is

A live analytics dashboard for the Schnell Home Automation system. It pulls real telemetry from BigQuery and displays latency, reliability, heatmaps, failure logs, and per-use-case breakdowns per hub.

---

## Architecture

```
Flutter App / Hub
      │
      ▼
Firebase Firestore  ──►  BigQuery
                          schnell-home-automation
                          └── schnell_analytics
                               ├── app_logs      (app-initiated commands)
                               └── ha_logs       (HA processing events)
                                        │
                                        ▼
                               analytics-api/main.py
                               FastAPI server (port 8080)
                               │
                               ├── GET /api/hubs           → list of hub IDs
                               └── GET /api/hub/{hub_id}   → full hub telemetry JSON
                                        │
                                        ▼
                               dashboard.html + dashboard_app.js
                               (browser renders charts, tables, heatmap)
```

### Key files

| File | Purpose |
|------|---------|
| `dashboard.html` | Single-page dashboard UI |
| `dashboard_app.js` | All rendering logic — reads data from `/api/hub/{id}` |
| `analytics-api/main.py` | FastAPI backend — queries BigQuery, shapes response |
| `analytics-api/requirements.txt` | Python dependencies |
| `analytics-api/venv/` | Python virtual environment (not committed) |

### Data flow

1. Hub sends telemetry to Firestore via the HA→Firestore→BigQuery pipeline
2. `main.py` queries BigQuery on-demand when the dashboard loads
3. `dashboard_app.js` calls `/api/hubs` to get all hub IDs, then `/api/hub/{id}?days=30` for each
4. All charts and tables render from that JSON — no mock data

---

## Running the Server

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

# Activate the venv
source venv/bin/activate

# Start the server
uvicorn main:app --reload --port 8080
```

Then open **http://localhost:8080** in your browser.

The `--reload` flag auto-restarts the server whenever you save changes to `main.py`.

### Stop the server

Press **Ctrl + C** in the terminal.

### Restart the server (port already in use)

If you see `[Errno 48] Address already in use`, kill the occupying process first:

```bash
kill -9 $(lsof -ti :8080)
```

Then start again (assuming you're already in `Analytics/analytics-api` with venv active):

```bash
uvicorn main:app --reload --port 8080
```

---

## API Endpoints

### `GET /api/hubs`
Returns all hub IDs found in BigQuery.

```json
{ "hubs": ["2C:CF:67:6E:11:52", "..."] }
```

### `GET /api/hub/{hub_id}?days=30`
Returns full telemetry for one hub over the last N days (1–90).

Key fields in the response:

| Field | Description |
|-------|-------------|
| `total` / `success` / `reliability` | Top-level KPIs |
| `speed.local_e2e` | App-to-device latency (avg, p50, p95 + events) |
| `speed.hub_snap_hub` | HA processing latency |
| `speed.buckets` | Event count per latency bucket (`<500ms`, `500-1000ms`, etc.) |
| `speed.bucket_events` | Sample events per bucket |
| `speed.per_uc` | Stats broken down by use case |
| `daily` | Day-by-day reliability and latency trend |
| `heatmap` | Event count by day-of-week × hour |
| `failures` | Last 100 failed events |
| `reliability_detail` | App vs docklet reliability breakdown |

---

## BigQuery Tables

**`schnell_analytics.app_logs`** — app-initiated commands

Key columns: `hub_id`, `event_timestamp`, `entity_id`, `friendly_name`, `use_case`, `latency_ms`, `success`, `failure_reason`, `trigger_method`, `room`, `network_type`, `docklet_id`

**`schnell_analytics.ha_logs`** — Home Assistant processing events

Key columns: `hub_id`, `event_timestamp`, `entity_id`, `friendly_name`, `ha_event_type`, `ha_processing_latency_ms`, `matter_command_ts`, `snap_state_change_ts`

---

## VSCode Setup

To remove import errors in `main.py`, point VSCode to the venv interpreter:

1. **Cmd + Shift + P** → `Python: Select Interpreter`
2. Click **Enter interpreter path...**
3. Paste: `Analytics/analytics-api/venv/bin/python3`
4. **Cmd + Shift + P** → `Developer: Reload Window`

---

## Troubleshooting

**`DefaultCredentialsError` on startup**
Run the gcloud auth command again:
```bash
gcloud auth application-default login \
  --scopes=https://www.googleapis.com/auth/cloud-platform
```

**`Internal Server Error` on `/api/hub/{id}`**
Check the uvicorn terminal output — it shows the full Python traceback. Usually a BigQuery SQL syntax issue or a missing column.

**Dashboard opens but shows no data**
Open browser DevTools (F12) → Console tab. Any fetch errors or JS crashes will appear there.

**`command not found: uvicorn`**
The venv is not activated. Run `source venv/bin/activate` first.
