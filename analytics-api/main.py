from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from google.cloud import bigquery
from datetime import date, timedelta
import openpyxl
import os

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["GET"], allow_headers=["*"])

PROJECT = "schnell-home-automation"
client  = bigquery.Client(project=PROJECT)

# ── Dock data — loaded once from xlsx at startup ──────────────────────────────
_DOCK_XLSX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dock_data.xlsx")

def _load_dock_rows():
    wb = openpyxl.load_workbook(_DOCK_XLSX)
    ws = wb.active
    headers = [cell.value for cell in ws[1]]
    rows = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        row = dict(zip(headers, r))
        row["total_action_count"] = int(row["total_action_count"] or 0)
        row["success_count"]      = int(row["success_count"]      or 0)
        row["failure_count"]      = int(row["failure_count"]       or 0)
        rows.append(row)
    return rows

_DOCK_ROWS = _load_dock_rows()

def _dock_rows_for_hub(hub_id: str, days: int):
    """Return xlsx rows that belong to this hub (via ha_logs dock_id mapping) within the day window."""
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    # get dock_ids associated with this hub from ha_logs
    dock_ids = {r["dock_id"] for r in q(f"""
        SELECT DISTINCT dock_id
        FROM `{PROJECT}.schnell_analytics.ha_logs`
        WHERE hub_id = @hub_id AND dock_id IS NOT NULL
    """, [bigquery.ScalarQueryParameter("hub_id", "STRING", hub_id)])}
    return [
        r for r in _DOCK_ROWS
        if r["dock_id"] in dock_ids and r["date"] >= cutoff
    ]

def _build_dock_stats(rows):
    """Aggregate xlsx rows into per-docklet dock_stats list."""
    from collections import defaultdict
    by_docklet = defaultdict(lambda: {"total": 0, "success": 0, "failure": 0, "actions": defaultdict(lambda: {"total": 0, "success": 0, "failure": 0})})
    dock_id_map = {}
    for r in rows:
        key = r["docklet_id"]
        dock_id_map[key] = r["dock_id"]
        by_docklet[key]["total"]   += r["total_action_count"]
        by_docklet[key]["success"] += r["success_count"]
        by_docklet[key]["failure"] += r["failure_count"]
        a = by_docklet[key]["actions"][r["action"]]
        a["total"]   += r["total_action_count"]
        a["success"] += r["success_count"]
        a["failure"] += r["failure_count"]
    stats = []
    for docklet_id, d in by_docklet.items():
        rel = round(100 * d["success"] / d["total"], 2) if d["total"] else 0
        actions = [
            {"action": act, **v,
             "rel": round(100 * v["success"] / v["total"], 2) if v["total"] else 0}
            for act, v in d["actions"].items()
        ]
        stats.append({
            "dock_id":    dock_id_map[docklet_id],
            "docklet_id": docklet_id,
            "total":      d["total"],
            "success":    d["success"],
            "failure":    d["failure"],
            "rel":        rel,
            "actions":    actions,
        })
    return stats

def _build_dock_usage(rows):
    """Aggregate xlsx rows into dock_usage summary."""
    from collections import defaultdict
    by_action  = defaultdict(int)
    by_docklet = defaultdict(int)
    by_date    = defaultdict(lambda: {"total": 0, "success": 0, "failure": 0})
    for r in rows:
        by_action[r["action"]]    += r["total_action_count"]
        by_docklet[r["docklet_id"]] += r["total_action_count"]
        by_date[r["date"]]["total"]   += r["total_action_count"]
        by_date[r["date"]]["success"] += r["success_count"]
        by_date[r["date"]]["failure"] += r["failure_count"]
    total = sum(by_action.values())
    daily = [
        {"date": d, "day": rows[[r["date"] for r in rows].index(d)]["day_of_week"],
         **v, "rel": round(100 * v["success"] / v["total"], 2) if v["total"] else 0}
        for d, v in sorted(by_date.items())
    ]
    return {
        "total":      total,
        "by_action":  dict(by_action),
        "by_docklet": dict(by_docklet),
        "daily":      daily,
    }

def q(sql, params):
    job = client.query(sql, job_config=bigquery.QueryJobConfig(
        query_parameters=params))
    return [dict(row) for row in job.result()]

def hp(hub_id, days):
    return [
        bigquery.ScalarQueryParameter("hub_id", "STRING", hub_id),
        bigquery.ScalarQueryParameter("days",   "INT64",  days),
    ]

def uc_src(use_case):
    # maps use_case label → src value that dashboard srcPred() understands
    uc = (use_case or "").lower()
    if "docklet" in uc or "dock" in uc: return "docklet"
    if "remote" in uc:                  return "app_remote"
    if "observ" in uc:                  return "direct_thread"
    return "app"


@app.get("/api/hubs")
def list_hubs():
    rows = q("""
        SELECT DISTINCT hub_id
        FROM `schnell-home-automation.schnell_analytics.app_logs`
        ORDER BY hub_id
    """, [])
    return {"hubs": [r["hub_id"] for r in rows]}


@app.get("/api/hub/{hub_id}")
def hub_detail(hub_id: str, days: int = Query(default=30, ge=1, le=90)):
    p  = hp(hub_id, days)
    AL = "`schnell-home-automation.schnell_analytics.app_logs`"
    HL = "`schnell-home-automation.schnell_analytics.ha_logs`"

    # ── Top-level KPIs ────────────────────────────────────────────────────
    kpi = q(f"""
        SELECT COUNT(*) AS total, COUNTIF(success) AS success,
               ROUND(100*COUNTIF(success)/COUNT(*),2) AS reliability
        FROM {AL}
        WHERE hub_id=@hub_id
          AND DATE(event_timestamp)>=DATE_SUB(CURRENT_DATE(),INTERVAL @days DAY)
    """, p)[0]

    # ── speed.local_e2e  (app-initiated latency) ─────────────────────────
    le = q(f"""
        SELECT ROUND(AVG(latency_ms)) AS avg,
               APPROX_QUANTILES(latency_ms,100)[OFFSET(50)] AS p50,
               APPROX_QUANTILES(latency_ms,100)[OFFSET(95)] AS p95
        FROM {AL}
        WHERE hub_id=@hub_id AND latency_ms IS NOT NULL
          AND DATE(event_timestamp)>=DATE_SUB(CURRENT_DATE(),INTERVAL @days DAY)
    """, p)
    le_kpi = le[0] if le else {"avg":0,"p50":0,"p95":0}

    le_events = q(f"""
        SELECT event_timestamp AS ts, entity_id AS dev, friendly_name,
               use_case AS uc, latency_ms AS lat, room, network_type AS net,
               tap_ts AS tap, command_sent_ts AS cmd_sent,
               rest_response_ts AS rest_resp, ws_confirmation_ts AS ws_conf,
               trigger_method AS src, success, failure_reason
        FROM {AL}
        WHERE hub_id=@hub_id AND latency_ms IS NOT NULL
          AND DATE(event_timestamp)>=DATE_SUB(CURRENT_DATE(),INTERVAL @days DAY)
        ORDER BY event_timestamp DESC LIMIT 50
    """, p)
    for e in le_events:
        e["src"] = uc_src(e.get("uc"))

    # ── speed.hub_snap_hub  (HA processing latency) ──────────────────────
    hs = q(f"""
        SELECT ROUND(AVG(ha_processing_latency_ms)) AS avg,
               APPROX_QUANTILES(ha_processing_latency_ms,100)[OFFSET(50)] AS p50,
               APPROX_QUANTILES(ha_processing_latency_ms,100)[OFFSET(95)] AS p95
        FROM {HL}
        WHERE hub_id=@hub_id AND ha_processing_latency_ms IS NOT NULL
          AND DATE(event_timestamp)>=DATE_SUB(CURRENT_DATE(),INTERVAL @days DAY)
    """, p)
    hs_kpi = hs[0] if hs else {"avg":0,"p50":0,"p95":0}

    hs_events = q(f"""
        SELECT event_timestamp AS ts, entity_id AS dev, friendly_name,
               ha_event_type AS uc, ha_processing_latency_ms AS lat, room,
               matter_command_ts AS matter_ts, snap_state_change_ts AS snap_ts
        FROM {HL}
        WHERE hub_id=@hub_id AND ha_processing_latency_ms IS NOT NULL
          AND DATE(event_timestamp)>=DATE_SUB(CURRENT_DATE(),INTERVAL @days DAY)
        ORDER BY event_timestamp DESC LIMIT 50
    """, p)

    # ── speed.per_uc  (per use-case stats + sample events) ──────────────
    per_uc_rows = q(f"""
        SELECT use_case, ROUND(AVG(latency_ms)) AS avg,
               APPROX_QUANTILES(latency_ms,100)[OFFSET(50)] AS p50,
               APPROX_QUANTILES(latency_ms,100)[OFFSET(95)] AS p95,
               COUNT(*) AS count, COUNTIF(success) AS success
        FROM {AL}
        WHERE hub_id=@hub_id AND latency_ms IS NOT NULL
          AND DATE(event_timestamp)>=DATE_SUB(CURRENT_DATE(),INTERVAL @days DAY)
        GROUP BY use_case
    """, p)
    per_uc_ev = q(f"""
        SELECT use_case, event_timestamp AS ts, entity_id AS dev, friendly_name,
               latency_ms AS lat, trigger_method AS src, room
        FROM {AL}
        WHERE hub_id=@hub_id AND latency_ms IS NOT NULL
          AND DATE(event_timestamp)>=DATE_SUB(CURRENT_DATE(),INTERVAL @days DAY)
        ORDER BY event_timestamp DESC LIMIT 200
    """, p)
    per_uc_map = {}
    for e in per_uc_ev:
        uc = e.pop("use_case")
        e["src"] = uc_src(uc)
        per_uc_map.setdefault(uc, []).append(e)
    per_uc = {r["use_case"]: {"avg":r["avg"],"p50":r["p50"],"p95":r["p95"],
              "count":r["count"],"success":r["success"],
              "events":per_uc_map.get(r["use_case"],[])}
              for r in per_uc_rows}

    # ── speed.buckets (count per bucket for chart) ──────────────────────
    bcount_rows = q(f"""
        SELECT
          CASE WHEN latency_ms<500  THEN '<500ms'
               WHEN latency_ms<1000 THEN '500-1000ms'
               WHEN latency_ms<2000 THEN '1-2s'
               WHEN latency_ms<5000 THEN '2-5s'
               ELSE '>5s' END AS bucket,
          COUNT(*) AS cnt
        FROM {AL}
        WHERE hub_id=@hub_id AND latency_ms IS NOT NULL
          AND DATE(event_timestamp)>=DATE_SUB(CURRENT_DATE(),INTERVAL @days DAY)
        GROUP BY bucket
        ORDER BY MIN(latency_ms)
    """, p)
    buckets = {r["bucket"]: r["cnt"] for r in bcount_rows}

    # ── speed.bucket_events ─────────────────────────────────────────────
    bk_rows = q(f"""
        SELECT
          CASE WHEN latency_ms<500  THEN '<500ms'
               WHEN latency_ms<1000 THEN '500-1000ms'
               WHEN latency_ms<2000 THEN '1-2s'
               WHEN latency_ms<5000 THEN '2-5s'
               ELSE '>5s' END AS bucket,
          event_timestamp AS ts, entity_id AS dev, friendly_name,
          use_case AS uc, latency_ms AS lat, trigger_method AS src,
          room, success
        FROM {AL}
        WHERE hub_id=@hub_id AND latency_ms IS NOT NULL
          AND DATE(event_timestamp)>=DATE_SUB(CURRENT_DATE(),INTERVAL @days DAY)
        LIMIT 500
    """, p)
    bucket_events = {}
    for r in bk_rows:
        bk = r.pop("bucket")
        r["src"] = uc_src(r.get("uc"))
        bucket_events.setdefault(bk, []).append(r)

    # ── Daily trend ─────────────────────────────────────────────────────
    daily = q(f"""
        SELECT date, COUNT(*) AS total,
               ROUND(100*COUNTIF(success)/COUNT(*),2) AS rel,
               APPROX_QUANTILES(latency_ms,100 IGNORE NULLS)[OFFSET(50)] AS p50,
               ROUND(100*COUNTIF(latency_ms<1000)/
                     NULLIF(COUNTIF(latency_ms IS NOT NULL),0),2) AS ns
        FROM {AL}
        WHERE hub_id=@hub_id
          AND DATE(event_timestamp)>=DATE_SUB(CURRENT_DATE(),INTERVAL @days DAY)
        GROUP BY date ORDER BY date
    """, p)

    # ── Heatmap ─────────────────────────────────────────────────────────
    heat_rows = q(f"""
        SELECT day_of_week, hour, COUNT(*) AS events,
               COUNTIF(use_case IN ('Local App Control','Device Bind (App)')) AS app,
               COUNTIF(use_case='Docklet Press (App)')    AS dock,
               COUNTIF(use_case='Remote App Control')     AS remote,
               COUNTIF(use_case='Observed Change (App)')  AS auto
        FROM {AL}
        WHERE hub_id=@hub_id
          AND DATE(event_timestamp)>=DATE_SUB(CURRENT_DATE(),INTERVAL @days DAY)
        GROUP BY day_of_week, hour
    """, p)
    heatmap, heatmap_detail = {}, {}
    for r in heat_rows:
        k = f"{r['day_of_week']}_{r['hour']}"
        heatmap[k] = r["events"]
        heatmap_detail[k] = {"app":r["app"],"dock":r["dock"],
                              "remote":r["remote"],"auto":r["auto"]}

    # ── Failures ────────────────────────────────────────────────────────
    fail_rows = q(f"""
        SELECT event_timestamp AS ts, use_case AS uc, entity_id AS dev,
               friendly_name, failure_reason AS reason, room,
               trigger_method AS src, CAST(latency_ms AS STRING) AS lat,
               network_type AS net, COALESCE(docklet_id,'') AS dock
        FROM {AL}
        WHERE hub_id=@hub_id AND success=false
          AND DATE(event_timestamp)>=DATE_SUB(CURRENT_DATE(),INTERVAL @days DAY)
        ORDER BY event_timestamp DESC LIMIT 100
    """, p)
    failures = []
    for f in fail_rows:
        f["src"] = uc_src(f.get("uc"))
        f["lat"] = f["lat"] if f["lat"] else "N/A"
        failures.append(f)

    # ── Reliability detail ──────────────────────────────────────────────
    src_rows = q(f"""
        SELECT use_case, COUNT(*) AS total, COUNTIF(success) AS success,
               COUNTIF(NOT success) AS fail,
               ROUND(100*COUNTIF(success)/COUNT(*),2) AS rel
        FROM {AL}
        WHERE hub_id=@hub_id
          AND DATE(event_timestamp)>=DATE_SUB(CURRENT_DATE(),INTERVAL @days DAY)
        GROUP BY use_case
    """, p)
    src_rel = {r["use_case"]:{k:v for k,v in r.items() if k!="use_case"} for r in src_rows}
    a_rows = [r for r in src_rows if "App Control" in (r.get("use_case") or "")]
    d_rows = [r for r in src_rows if "Docklet"     in (r.get("use_case") or "")]
    at=sum(r["total"] for r in a_rows); as_=sum(r["success"] for r in a_rows)
    dt=sum(r["total"] for r in d_rows); ds =sum(r["success"] for r in d_rows)

    # ── hub_to_snap_count (total HA SNAP commands issued) ────────────────
    ha_cnt_rows = q(f"""
        SELECT COUNT(*) AS cnt
        FROM {HL}
        WHERE hub_id=@hub_id
          AND DATE(event_timestamp)>=DATE_SUB(CURRENT_DATE(),INTERVAL @days DAY)
    """, p)
    hub_to_snap_count = ha_cnt_rows[0]["cnt"] if ha_cnt_rows else 0

    # ── Failures by reason ───────────────────────────────────────────────
    fbr_rows = q(f"""
        SELECT failure_reason AS reason, COUNT(*) AS cnt
        FROM {AL}
        WHERE hub_id=@hub_id AND success=false AND failure_reason IS NOT NULL
          AND DATE(event_timestamp)>=DATE_SUB(CURRENT_DATE(),INTERVAL @days DAY)
        GROUP BY failure_reason ORDER BY cnt DESC
    """, p)
    fbr_ev_rows = q(f"""
        SELECT failure_reason AS reason, event_timestamp AS ts,
               entity_id AS dev, friendly_name, use_case AS uc,
               trigger_method AS src, room, CAST(latency_ms AS STRING) AS lat
        FROM {AL}
        WHERE hub_id=@hub_id AND success=false AND failure_reason IS NOT NULL
          AND DATE(event_timestamp)>=DATE_SUB(CURRENT_DATE(),INTERVAL @days DAY)
        ORDER BY event_timestamp DESC LIMIT 300
    """, p)
    fbr_ev_map = {}
    for e in fbr_ev_rows:
        r_ = e.pop("reason")
        fbr_ev_map.setdefault(r_, []).append(e)
    fail_by_reason = {
        r["reason"]: {"count": r["cnt"], "events": fbr_ev_map.get(r["reason"], [])}
        for r in fbr_rows
    }

    # ── Failures by device ───────────────────────────────────────────────
    fbd_rows = q(f"""
        SELECT entity_id AS dev, failure_reason AS reason, COUNT(*) AS cnt
        FROM {AL}
        WHERE hub_id=@hub_id AND success=false
          AND DATE(event_timestamp)>=DATE_SUB(CURRENT_DATE(),INTERVAL @days DAY)
        GROUP BY entity_id, failure_reason ORDER BY entity_id, cnt DESC
    """, p)
    fail_by_device = {}
    for r in fbd_rows:
        dev = r["dev"] or "unknown"
        if dev not in fail_by_device:
            fail_by_device[dev] = {"count": 0, "reasons": {}}
        reason_key = r["reason"] or "UNKNOWN"
        fail_by_device[dev]["reasons"][reason_key] = r["cnt"]
        fail_by_device[dev]["count"] += r["cnt"]

    # ── Usage (source breakdown) ─────────────────────────────────────────
    usage_rows = q(f"""
        SELECT
            COUNTIF(use_case IN ('Local App Control','Device Bind (App)')) AS app,
            COUNTIF(use_case='Docklet Press (App)') AS docklet,
            COUNTIF(use_case='Remote App Control')  AS remote,
            COUNTIF(use_case='Observed Change (App)') AS direct
        FROM {AL}
        WHERE hub_id=@hub_id
          AND DATE(event_timestamp)>=DATE_SUB(CURRENT_DATE(),INTERVAL @days DAY)
    """, p)
    ur = usage_rows[0] if usage_rows else {}
    app_cnt     = int(ur.get("app",     0) or 0)
    docklet_cnt = int(ur.get("docklet", 0) or 0)
    remote_cnt  = int(ur.get("remote",  0) or 0)
    direct_cnt  = int(ur.get("direct",  0) or 0)
    h_total = app_cnt + docklet_cnt
    usage = {
        "app":          app_cnt,
        "docklet":      docklet_cnt,
        "remote":       remote_cnt,
        "direct":       direct_cnt,
        "app_ratio":    round(100 * app_cnt     / h_total, 2) if h_total else 0,
        "dock_ratio":   round(100 * docklet_cnt / h_total, 2) if h_total else 0,
        "scene_per_day": round(direct_cnt / days, 2),
    }

    return {
        "total":       kpi["total"],
        "success":     kpi["success"],
        "reliability": kpi["reliability"],
        "speed": {
            "hub_snap_hub": {**hs_kpi, "events": hs_events},
            "local_e2e":    {**le_kpi, "events": le_events},
            "remote_e2e":   {"avg":0,"p50":0,"p95":0,"events":[]},
            "hub_app":      {"p50": hs_kpi.get("p50") or 48},
            "buckets":        buckets,
            "bucket_events":  bucket_events,
            "per_uc":        per_uc,
        },
        "daily":              daily,
        "heatmap":            heatmap,
        "heatmap_detail":     heatmap_detail,
        "failures":           failures,
        "reliability_detail": {
            "app_trigger_feedback":  round(100*as_/at,2) if at else 0,
            "dock_trigger_feedback": round(100*ds/dt,2)  if dt else 0,
            "hub_to_app":        0,
            "app_triggers":      at,
            "app_feedbacks":     as_,
            "dock_triggers":     dt,
            "dock_feedbacks":    ds,
            "hub_to_snap_count": hub_to_snap_count,
            "src_rel":           src_rel,
            "dock_stats":        _build_dock_stats(_dock_rows_for_hub(hub_id, days)),
        },
        "dock_usage":     _build_dock_usage(_dock_rows_for_hub(hub_id, days)),
        "usage":          usage,
        "devices":        [],
        "fail_by_reason": fail_by_reason,
        "fail_by_device": fail_by_device,
    }

_root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

@app.get("/")
def serve_dashboard():
    return FileResponse(os.path.join(_root, "dashboard.html"))

# Serve dashboard_app.js and any other static files from Analytics/
app.mount("/", StaticFiles(directory=_root), name="static")