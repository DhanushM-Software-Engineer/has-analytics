from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from google.cloud import bigquery
from datetime import date, timedelta
from concurrent.futures import ThreadPoolExecutor
import time
import os

# Simple in-memory cache — keyed by (hub_id, from_date, to_date), TTL 5 min
_HUB_CACHE: dict = {}
_CACHE_TTL = 300

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["GET"], allow_headers=["*"])

PROJECT = "schnell-home-automation"
client  = bigquery.Client(project=PROJECT)

# ── Dock data — read live from BigQuery (schnell_analytics.dock_logs) ─────────
# dock_logs mirrors the dock Google Sheet: an Apps Script inside the Sheet
# re-loads the table on every edit (see Analytics/dock_sheet_apps_script.gs).

def _build_dock_stats(rows):
    """Aggregate dock_logs rows into per-dock stats with docklets[] sub-array."""
    from collections import defaultdict
    by_dock = defaultdict(lambda: {"total": 0, "success": 0, "failure": 0, "docklets": {}})
    for r in rows:
        dock_id    = r["dock_id"]
        docklet_id = r["docklet_id"]
        by_dock[dock_id]["total"]   += r["total_action_count"]
        by_dock[dock_id]["success"] += r["success_count"]
        by_dock[dock_id]["failure"] += r["failure_count"]
        if docklet_id not in by_dock[dock_id]["docklets"]:
            by_dock[dock_id]["docklets"][docklet_id] = {
                "total": 0, "success": 0, "failure": 0,
                "actions": defaultdict(lambda: {"total": 0, "success": 0, "failure": 0})
            }
        dk = by_dock[dock_id]["docklets"][docklet_id]
        dk["total"]   += r["total_action_count"]
        dk["success"] += r["success_count"]
        dk["failure"] += r["failure_count"]
        a = dk["actions"][r["action"]]
        a["total"]   += r["total_action_count"]
        a["success"] += r["success_count"]
        a["failure"] += r["failure_count"]
    stats = []
    for dock_id, d in by_dock.items():
        rel = round(100 * d["success"] / d["total"], 2) if d["total"] else 0
        docklets = []
        for docklet_id, dk in d["docklets"].items():
            dk_rel = round(100 * dk["success"] / dk["total"], 2) if dk["total"] else 0
            actions = [
                {"action": act, **v,
                 "rel": round(100 * v["success"] / v["total"], 2) if v["total"] else 0}
                for act, v in dk["actions"].items()
            ]
            docklets.append({
                "docklet_id": docklet_id,
                "total":      dk["total"],
                "success":    dk["success"],
                "failure":    dk["failure"],
                "rel":        dk_rel,
                "actions":    actions,
            })
        stats.append({
            "dock_id":  dock_id,
            "total":    d["total"],
            "success":  d["success"],
            "failure":  d["failure"],
            "rel":      rel,
            "docklets": docklets,
        })
    return stats

def _build_dock_usage(rows):
    """Aggregate dock_logs rows into dock_usage summary."""
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

def hp(hub_id, from_date, to_date):
    return [
        bigquery.ScalarQueryParameter("hub_id",    "STRING", hub_id),
        bigquery.ScalarQueryParameter("from_date", "DATE",   from_date),
        bigquery.ScalarQueryParameter("to_date",   "DATE",   to_date),
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
def hub_detail(hub_id: str,
               from_date: str = Query(default=None),
               to_date:   str = Query(default=None)):
    if not to_date:
        to_date = date.today().isoformat()
    if not from_date:
        from_date = (date.today() - timedelta(days=30)).isoformat()
    from_dt = date.fromisoformat(from_date)
    to_dt   = date.fromisoformat(to_date)
    if (to_dt - from_dt).days > 90:
        from_dt   = to_dt - timedelta(days=90)
        from_date = from_dt.isoformat()
    days_count = (to_dt - from_dt).days + 1
    p  = hp(hub_id, from_date, to_date)
    AL = "`schnell-home-automation.schnell_analytics.app_logs`"
    HL = "`schnell-home-automation.schnell_analytics.ha_logs`"

    # Return cached result if still fresh
    _ck = f"{hub_id}:{from_date}:{to_date}"
    if _ck in _HUB_CACHE:
        _ts, _data = _HUB_CACHE[_ck]
        if time.time() - _ts < _CACHE_TTL:
            return _data

    # ── Fire all 21 queries in parallel ──────────────────────────────────
    with ThreadPoolExecutor(max_workers=15) as ex:
        f_kpi      = ex.submit(q, f"""
            SELECT COUNT(*) AS total, COUNTIF(success) AS success,
                   COALESCE(ROUND(100*COUNTIF(success)/NULLIF(COUNT(*),0),2),0) AS reliability
            FROM {AL} WHERE hub_id=@hub_id
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date""", p)
        f_le       = ex.submit(q, f"""
            SELECT ROUND(AVG(latency_ms)) AS avg,
                   APPROX_QUANTILES(latency_ms,100)[OFFSET(50)] AS p50,
                   APPROX_QUANTILES(latency_ms,100)[OFFSET(95)] AS p95
            FROM {AL} WHERE hub_id=@hub_id AND latency_ms IS NOT NULL
              AND use_case IN ('Local App Control','Device Bind (App)')
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date""", p)
        f_le_ev    = ex.submit(q, f"""
            SELECT event_timestamp AS ts, entity_id AS dev, friendly_name,
                   use_case AS uc, latency_ms AS lat, room, network_type AS net,
                   tap_ts AS tap, command_sent_ts AS cmd_sent,
                   rest_response_ts AS rest_resp, ws_confirmation_ts AS ws_conf,
                   trigger_method AS src, success, failure_reason
            FROM {AL} WHERE hub_id=@hub_id AND latency_ms IS NOT NULL
              AND use_case IN ('Local App Control','Device Bind (App)')
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            ORDER BY event_timestamp DESC LIMIT 50""", p)
        f_hs       = ex.submit(q, f"""
            SELECT ROUND(AVG(ha_processing_latency_ms)) AS avg,
                   APPROX_QUANTILES(ha_processing_latency_ms,100)[OFFSET(50)] AS p50,
                   APPROX_QUANTILES(ha_processing_latency_ms,100)[OFFSET(95)] AS p95
            FROM {HL} WHERE hub_id=@hub_id AND ha_processing_latency_ms IS NOT NULL
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date""", p)
        f_hs_ev    = ex.submit(q, f"""
            SELECT event_timestamp AS ts, entity_id AS dev, friendly_name,
                   ha_event_type AS uc, ha_processing_latency_ms AS lat, room,
                   matter_command_ts AS matter_ts, snap_state_change_ts AS snap_ts
            FROM {HL} WHERE hub_id=@hub_id AND ha_processing_latency_ms IS NOT NULL
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            ORDER BY event_timestamp DESC LIMIT 50""", p)
        f_per_uc   = ex.submit(q, f"""
            SELECT use_case, ROUND(AVG(latency_ms)) AS avg,
                   APPROX_QUANTILES(latency_ms,100)[OFFSET(50)] AS p50,
                   APPROX_QUANTILES(latency_ms,100)[OFFSET(95)] AS p95,
                   ROUND(STDDEV(latency_ms)) AS stddev,
                   COUNT(*) AS count, COUNTIF(success) AS success
            FROM {AL} WHERE hub_id=@hub_id AND latency_ms IS NOT NULL
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            GROUP BY use_case""", p)
        f_per_uc_ev = ex.submit(q, f"""
            SELECT use_case, ts, dev, friendly_name, lat, src, room FROM (
              SELECT use_case, event_timestamp AS ts, entity_id AS dev,
                     friendly_name, latency_ms AS lat, trigger_method AS src, room,
                     ROW_NUMBER() OVER (PARTITION BY use_case
                                        ORDER BY event_timestamp DESC) AS rn
              FROM {AL} WHERE hub_id=@hub_id AND latency_ms IS NOT NULL
                AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            ) WHERE rn <= 100
            ORDER BY ts DESC""", p)
        f_uc_bkt   = ex.submit(q, f"""
            SELECT use_case,
                   CASE WHEN latency_ms<500  THEN '<500ms'
                        WHEN latency_ms<1000 THEN '500-1000ms'
                        WHEN latency_ms<2000 THEN '1-2s'
                        WHEN latency_ms<5000 THEN '2-5s'
                        ELSE '>5s' END AS bucket,
                   COUNT(*) AS cnt
            FROM {AL} WHERE hub_id=@hub_id AND latency_ms IS NOT NULL
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            GROUP BY use_case, bucket""", p)
        f_bcount   = ex.submit(q, f"""
            SELECT CASE WHEN latency_ms<500  THEN '<500ms'
                        WHEN latency_ms<1000 THEN '500-1000ms'
                        WHEN latency_ms<2000 THEN '1-2s'
                        WHEN latency_ms<5000 THEN '2-5s'
                        ELSE '>5s' END AS bucket,
                   COUNT(*) AS cnt
            FROM {AL} WHERE hub_id=@hub_id AND latency_ms IS NOT NULL
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            GROUP BY bucket ORDER BY MIN(latency_ms)""", p)
        f_bk       = ex.submit(q, f"""
            SELECT CASE WHEN latency_ms<500  THEN '<500ms'
                        WHEN latency_ms<1000 THEN '500-1000ms'
                        WHEN latency_ms<2000 THEN '1-2s'
                        WHEN latency_ms<5000 THEN '2-5s'
                        ELSE '>5s' END AS bucket,
                   event_timestamp AS ts, entity_id AS dev, friendly_name,
                   use_case AS uc, latency_ms AS lat, trigger_method AS src,
                   room, success
            FROM {AL} WHERE hub_id=@hub_id AND latency_ms IS NOT NULL
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            LIMIT 500""", p)
        f_daily    = ex.submit(q, f"""
            SELECT date, COUNT(*) AS total,
                   ROUND(100*COUNTIF(success)/COUNT(*),2) AS rel,
                   APPROX_QUANTILES(latency_ms,100 IGNORE NULLS)[OFFSET(50)] AS p50,
                   ROUND(100*COUNTIF(latency_ms<1000)/
                         NULLIF(COUNTIF(latency_ms IS NOT NULL),0),2) AS ns
            FROM {AL} WHERE hub_id=@hub_id
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            GROUP BY date ORDER BY date""", p)
        f_heat     = ex.submit(q, f"""
            SELECT day_of_week, hour, COUNT(*) AS events,
                   COUNTIF(use_case IN ('Local App Control','Device Bind (App)')) AS app,
                   COUNTIF(use_case='Docklet Press (App)') AS dock,
                   COUNTIF(use_case='Remote App Control')  AS remote,
                   COUNTIF(use_case='Observed Change (App)') AS auto
            FROM {AL} WHERE hub_id=@hub_id
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            GROUP BY day_of_week, hour""", p)
        f_fail     = ex.submit(q, f"""
            SELECT event_timestamp AS ts, use_case AS uc, entity_id AS dev,
                   friendly_name, failure_reason AS reason, room,
                   trigger_method AS src, CAST(latency_ms AS STRING) AS lat,
                   network_type AS net, COALESCE(docklet_id,'') AS dock
            FROM {AL} WHERE hub_id=@hub_id AND success=false
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            ORDER BY event_timestamp DESC LIMIT 100""", p)
        f_src      = ex.submit(q, f"""
            SELECT use_case, COUNT(*) AS total, COUNTIF(success) AS success,
                   COUNTIF(NOT success) AS fail,
                   ROUND(100*COUNTIF(success)/COUNT(*),2) AS rel
            FROM {AL} WHERE hub_id=@hub_id
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            GROUP BY use_case""", p)
        f_ha_cnt   = ex.submit(q, f"""
            SELECT COUNT(*) AS cnt FROM {HL}
            WHERE hub_id=@hub_id
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date""", p)
        f_fbr      = ex.submit(q, f"""
            SELECT failure_reason AS reason, COUNT(*) AS cnt
            FROM {AL} WHERE hub_id=@hub_id AND success=false AND failure_reason IS NOT NULL
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            GROUP BY failure_reason ORDER BY cnt DESC""", p)
        f_fbr_ev   = ex.submit(q, f"""
            SELECT failure_reason AS reason, event_timestamp AS ts,
                   entity_id AS dev, friendly_name, use_case AS uc,
                   trigger_method AS src, room, CAST(latency_ms AS STRING) AS lat
            FROM {AL} WHERE hub_id=@hub_id AND success=false AND failure_reason IS NOT NULL
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            ORDER BY event_timestamp DESC LIMIT 300""", p)
        f_fbd      = ex.submit(q, f"""
            SELECT entity_id AS dev, failure_reason AS reason, COUNT(*) AS cnt
            FROM {AL} WHERE hub_id=@hub_id AND success=false
              AND SPLIT(entity_id,'.')[OFFSET(0)] NOT IN ('scene','automation','script','group')
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            GROUP BY entity_id, failure_reason ORDER BY entity_id, cnt DESC""", p)
        f_dev      = ex.submit(q, f"""
            SELECT entity_id AS id, ANY_VALUE(room) AS room,
                   COUNT(*) AS total, COUNTIF(success=true) AS success,
                   ROUND(100*COUNTIF(success=true)/COUNT(*),2) AS rel,
                   APPROX_QUANTILES(latency_ms,100 IGNORE NULLS)[OFFSET(50)] AS p50
            FROM {AL} WHERE hub_id=@hub_id
              AND SPLIT(entity_id,'.')[OFFSET(0)] NOT IN ('scene','automation','script','group')
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            GROUP BY entity_id ORDER BY total DESC LIMIT 50""", p)
        f_usage    = ex.submit(q, f"""
            SELECT COUNTIF(use_case IN ('Local App Control','Device Bind (App)')) AS app,
                   COUNTIF(use_case='Docklet Press (App)') AS docklet,
                   COUNTIF(use_case='Remote App Control')  AS remote,
                   COUNTIF(use_case='Observed Change (App)') AS direct,
                   COUNTIF(entity_id LIKE 'scene.%' AND use_case='Observed Change (App)') AS scene_count
            FROM {AL} WHERE hub_id=@hub_id
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date""", p)
        f_snap_count = ex.submit(q, f"""
            SELECT COUNT(DISTINCT entity_id) AS cnt
            FROM {AL} WHERE hub_id=@hub_id
              AND SPLIT(entity_id,'.')[OFFSET(0)] NOT IN ('scene','automation','script','group')
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date""", p)
        f_heat_fail  = ex.submit(q, f"""
            SELECT day_of_week, hour, COUNT(*) AS events
            FROM {AL} WHERE hub_id=@hub_id AND success=false
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            GROUP BY day_of_week, hour""", p)
        # Hub→App WS push = ws_confirmation_ts − rest_response_ts over the FULL
        # window (timestamps stored as STRING → SAFE_CAST). diff >= 0 guards
        # against clock-skew rows where ws_conf precedes rest_resp.
        f_hub_app    = ex.submit(q, f"""
            SELECT ROUND(AVG(diff)) AS avg,
                   APPROX_QUANTILES(diff,100)[OFFSET(50)] AS p50,
                   APPROX_QUANTILES(diff,100)[OFFSET(95)] AS p95
            FROM (
              SELECT TIMESTAMP_DIFF(SAFE_CAST(ws_confirmation_ts AS TIMESTAMP),
                                    SAFE_CAST(rest_response_ts  AS TIMESTAMP),
                                    MILLISECOND) AS diff
              FROM {AL} WHERE hub_id=@hub_id AND latency_ms IS NOT NULL
                AND use_case IN ('Local App Control','Device Bind (App)')
                AND rest_response_ts IS NOT NULL AND ws_confirmation_ts IS NOT NULL
                AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            ) WHERE diff >= 0""", p)
        # Observed Change events have NULL latency, so every latency-filtered
        # sample query skips them — fetch them separately for the Log Center.
        f_obs_ev     = ex.submit(q, f"""
            SELECT event_timestamp AS ts, entity_id AS dev, friendly_name,
                   use_case AS uc, room, network_type AS net,
                   trigger_method AS src, success, failure_reason
            FROM {AL} WHERE hub_id=@hub_id AND use_case='Observed Change (App)'
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            ORDER BY event_timestamp DESC LIMIT 200""", p)
        # Hub-recorded scene activations & automation runs from ha_logs.
        # Only genuine activation signals: call_service on scene.* and
        # automation_triggered — scene/automation state_changed rows are
        # mostly HA-restart state restores, not real activations.
        f_hub_obs_ev = ex.submit(q, f"""
            SELECT event_timestamp AS ts, entity_id AS dev, friendly_name,
                   CASE WHEN entity_id LIKE 'scene.%' THEN 'Scene Activated (Hub)'
                        ELSE 'Automation Run (Hub)' END AS uc, room
            FROM {HL} WHERE hub_id=@hub_id
              AND ((entity_id LIKE 'scene.%'      AND ha_event_type='call_service')
                OR (entity_id LIKE 'automation.%' AND ha_event_type='automation_triggered'))
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            ORDER BY event_timestamp DESC LIMIT 200""", p)
        f_hub_obs_cnt = ex.submit(q, f"""
            SELECT COUNTIF(entity_id LIKE 'scene.%'      AND ha_event_type='call_service')         AS hub_scene,
                   COUNTIF(entity_id LIKE 'automation.%' AND ha_event_type='automation_triggered') AS hub_auto
            FROM {HL} WHERE hub_id=@hub_id
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date""", p)
        f_dock     = ex.submit(q, f"""
            SELECT date, day_of_week, dock_id, docklet_id, action,
                   total_action_count, success_count, failure_count
            FROM `{PROJECT}.schnell_analytics.dock_logs`
            WHERE hub_id=@hub_id
              AND DATE(date) BETWEEN @from_date AND @to_date""", p)

    # ── Collect results & post-process (fast, sequential) ────────────────
    kpi = f_kpi.result()[0]

    le     = f_le.result()
    le_kpi = le[0] if le else {"avg":0,"p50":0,"p95":0}
    le_events = f_le_ev.result()
    for e in le_events:
        e["src"] = uc_src(e.get("uc"))

    hs     = f_hs.result()
    hs_kpi = hs[0] if hs else {"avg":0,"p50":0,"p95":0}
    hs_events = f_hs_ev.result()

    per_uc_rows = f_per_uc.result()
    per_uc_ev   = f_per_uc_ev.result()
    per_uc_map  = {}
    for e in per_uc_ev:
        uc = e.pop("use_case")
        e["src"] = uc_src(uc)
        per_uc_map.setdefault(uc, []).append(e)

    uc_bkt_rows = f_uc_bkt.result()
    uc_bkt_map: dict = {}
    for r in uc_bkt_rows:
        uc_bkt_map.setdefault(r["use_case"], {})[r["bucket"]] = r["cnt"]

    per_uc = {r["use_case"]: {"avg":r["avg"],"p50":r["p50"],"p95":r["p95"],
              "stddev": int(r["stddev"]) if r["stddev"] is not None else 0,
              "count":r["count"],"success":r["success"],
              "buckets":uc_bkt_map.get(r["use_case"],{}),
              "events":per_uc_map.get(r["use_case"],[])}
              for r in per_uc_rows}

    buckets = {r["bucket"]: r["cnt"] for r in f_bcount.result()}

    bk_rows = f_bk.result()
    bucket_events: dict = {}
    for r in bk_rows:
        bk = r.pop("bucket")
        r["src"] = uc_src(r.get("uc"))
        bucket_events.setdefault(bk, []).append(r)

    daily = f_daily.result()

    heatmap, heatmap_detail = {}, {}
    for r in f_heat.result():
        k = f"{r['day_of_week']}_{r['hour']}"
        heatmap[k] = r["events"]
        heatmap_detail[k] = {"app":r["app"],"dock":r["dock"],
                              "remote":r["remote"],"auto":r["auto"]}

    heatmap_fail = {}
    for r in f_heat_fail.result():
        k = f"{r['day_of_week']}_{r['hour']}"
        heatmap_fail[k] = r["events"]

    ha_rows      = f_hub_app.result()
    ha_raw       = ha_rows[0] if ha_rows else {}
    hub_app_kpi  = {"avg": ha_raw.get("avg") or 0,
                    "p50": ha_raw.get("p50") or 0,
                    "p95": ha_raw.get("p95") or 0}

    obs_events = f_obs_ev.result()
    for e in obs_events:
        e["src"] = uc_src(e.get("uc"))

    hub_obs_events = f_hub_obs_ev.result()
    for e in hub_obs_events:
        e["src"] = "direct_hub"   # 'direct' substring → matches Observed Change filter

    hub_obs_rows = f_hub_obs_cnt.result()
    hub_obs      = hub_obs_rows[0] if hub_obs_rows else {}
    hub_scene_cnt = int(hub_obs.get("hub_scene", 0) or 0)
    hub_auto_cnt  = int(hub_obs.get("hub_auto",  0) or 0)

    failures = []
    for f in f_fail.result():
        f["src"] = uc_src(f.get("uc"))
        f["lat"] = f["lat"] if f["lat"] else "N/A"
        failures.append(f)

    src_rows = f_src.result()
    src_rel  = {r["use_case"]:{k:v for k,v in r.items() if k!="use_case"} for r in src_rows}
    a_rows   = [r for r in src_rows if "App Control" in (r.get("use_case") or "")]
    d_rows   = [r for r in src_rows if "Docklet"     in (r.get("use_case") or "")]
    at=sum(r["total"] for r in a_rows); as_=sum(r["success"] for r in a_rows)
    dt=sum(r["total"] for r in d_rows); ds =sum(r["success"] for r in d_rows)

    ha_cnt_rows       = f_ha_cnt.result()
    hub_to_snap_count = ha_cnt_rows[0]["cnt"] if ha_cnt_rows else 0

    fbr_ev_map: dict = {}
    for e in f_fbr_ev.result():
        r_ = e.pop("reason")
        fbr_ev_map.setdefault(r_, []).append(e)
    fail_by_reason = {
        r["reason"]: {"count": r["cnt"], "events": fbr_ev_map.get(r["reason"], [])}
        for r in f_fbr.result()
    }

    fail_by_device: dict = {}
    for r in f_fbd.result():
        dev = r["dev"] or "unknown"
        if dev not in fail_by_device:
            fail_by_device[dev] = {"count": 0, "reasons": {}}
        fail_by_device[dev]["reasons"][r["reason"] or "UNKNOWN"] = r["cnt"]
        fail_by_device[dev]["count"] += r["cnt"]

    devices = [
        {"id": r["id"] or "unknown", "room": r["room"] or "—",
         "total": int(r["total"]), "success": int(r["success"]),
         "rel": float(r["rel"]) if r["rel"] is not None else 0.0,
         "p50": int(r["p50"]) if r["p50"] is not None else 0}
        for r in f_dev.result()
    ]

    ur          = (f_usage.result() or [{}])[0]
    app_cnt     = int(ur.get("app",         0) or 0)
    docklet_cnt = int(ur.get("docklet",     0) or 0)
    remote_cnt  = int(ur.get("remote",      0) or 0)
    direct_cnt  = int(ur.get("direct",      0) or 0)
    scene_cnt   = int(ur.get("scene_count", 0) or 0)
    h_total     = app_cnt + docklet_cnt
    snap_device_cnt = int((f_snap_count.result() or [{}])[0].get("cnt", 0) or 0)
    usage = {
        "app": app_cnt, "docklet": docklet_cnt,
        "remote": remote_cnt, "direct": direct_cnt,
        "app_ratio":      round(100 * app_cnt     / h_total, 2) if h_total else 0,
        "dock_ratio":     round(100 * docklet_cnt / h_total, 2) if h_total else 0,
        "observed_per_day": round(direct_cnt / days_count, 2),
        # app-observed counts — kept for reference only; the app misses events
        # while closed and can log state-restore bursts as activations
        "scene_total":    scene_cnt,
        "scene_per_day":  round(scene_cnt / days_count, 2),
        "snap_devices":   snap_device_cnt,
        # hub-recorded counts (ha_logs) — the reliable source, used by the tiles
        "hub_scene_total":   hub_scene_cnt,
        "hub_scene_per_day": round(hub_scene_cnt / days_count, 2),
        "hub_auto_total":    hub_auto_cnt,
        "hub_auto_per_day":  round(hub_auto_cnt / days_count, 2),
    }

    # dock_logs rows scoped to this hub + date window, same as app/ha logs
    dock_rows_filtered = [
        {**r, "total_action_count": int(r["total_action_count"] or 0),
              "success_count":      int(r["success_count"]      or 0),
              "failure_count":      int(r["failure_count"]      or 0)}
        for r in f_dock.result()
    ]
    dock_usage_data = _build_dock_usage(dock_rows_filtered)

    result = {
        "total":       kpi["total"],
        "success":     kpi["success"],
        "reliability": kpi["reliability"],
        "speed": {
            "hub_snap_hub": {**hs_kpi, "events": hs_events},
            "local_e2e":    {**le_kpi, "events": le_events},
            "remote_e2e":   {"avg":0,"p50":0,"p95":0,"events":[]},
            "hub_app":      {**hub_app_kpi, "events": []},
            "buckets":       buckets,
            "bucket_events": bucket_events,
            "per_uc":        per_uc,
        },
        "daily":          daily,
        "heatmap":        heatmap,
        "heatmap_detail": heatmap_detail,
        "heatmap_fail":   heatmap_fail,
        "failures":       failures,
        "reliability_detail": {
            "app_trigger_feedback":  round(100*as_/at,2) if at else 0,
            "dock_trigger_feedback": round(100*ds/dt,2)  if dt else 0,
            "hub_to_app":        round(100*as_/at,2) if at else 0,
            "app_triggers":      at,
            "app_feedbacks":     as_,
            "dock_triggers":     dt,
            "dock_feedbacks":    ds,
            "hub_to_snap_count": hub_to_snap_count,
            "src_rel":           src_rel,
            "dock_stats":        _build_dock_stats(dock_rows_filtered),
        },
        "dock_usage":     dock_usage_data,  # from dock_logs (Google Sheet)
        "observed_events": obs_events,
        "hub_observed_events": hub_obs_events,
        "usage":          usage,
        "devices":        devices,
        "fail_by_reason": fail_by_reason,
        "fail_by_device": fail_by_device,
    }
    _HUB_CACHE[_ck] = (time.time(), result)
    return result

_root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

@app.get("/")
def serve_dashboard():
    return FileResponse(os.path.join(_root, "dashboard.html"))

# Serve dashboard_app.js and any other static files from Analytics/
app.mount("/", StaticFiles(directory=_root), name="static")