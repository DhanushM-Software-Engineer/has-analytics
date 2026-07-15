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

@app.on_event("startup")
async def startup_event():
    print("\n" + "="*50)
    print("🚀 Analytics Dashboard running at: http://localhost:8080")
    print("="*50 + "\n")

PROJECT = "schnell-home-automation"
client  = bigquery.Client(project=PROJECT)

# ── Data-sourcing model ───────────────────────────────────────────────────────
# app_logs  → GENUINE APP-TRIGGERED actions only (reliable). Headline Total Events,
#             Reliability, Speed, latency, heatmap, per-device and failures all use
#             this scope. "Observed Change (App)" is passive app observation — the
#             app only sees it while open, so it is UNRELIABLE and is NOT shown as a
#             user-facing category; it is kept internally for reference only.
# ha_logs   → the hub records everything reliably even when the app is closed. Source
#             of truth for scene activations, automation runs, and dock device-side
#             activations.
# dock_logs → the dock hardware's own press-level success/failure (the button press
#             itself, independent of the device it activates). Synced with ha_logs
#             (device-side activation) by dock_id + docklet_id.
APP_UC = "use_case IN ('Local App Control','Device Bind (App)','Remote App Control')"


def _build_dock_stats(dock_ev, dock_action_rows):
    """Dock RELIABILITY grouped from the SAME dock press-event list the Log Center
    uses (so the dock count can never diverge from the reliability total), merged
    with the dock_logs action-type usage breakdown.

    dock_ev          : ha_logs dock press events, each with dock_id, docklet_id and a
                       `success` flag (did the bound device reach on/off?).
    dock_action_rows : dock_logs rows — only for the per-docklet action-type usage
                       breakdown (increment / decrement / toggle).
    """
    from collections import defaultdict
    actions_by_dk = defaultdict(lambda: defaultdict(lambda: {"total": 0, "success": 0, "failure": 0}))
    for r in dock_action_rows:
        a = actions_by_dk[(r["dock_id"], r["docklet_id"])][r["action"]]
        a["total"]   += r["total_action_count"]
        a["success"] += r["success_count"]
        a["failure"] += r["failure_count"]

    by_dock = defaultdict(lambda: {"total": 0, "success": 0, "failure": 0, "docklets": {}})
    for e in dock_ev:
        dock_id = e.get("dock_id"); docklet_id = e.get("docklet_id"); ok = bool(e.get("success"))
        dd = by_dock[dock_id]
        dd["total"] += 1; dd["success"] += 1 if ok else 0; dd["failure"] += 0 if ok else 1
        dk = dd["docklets"].setdefault(docklet_id, {"total": 0, "success": 0, "failure": 0})
        dk["total"] += 1; dk["success"] += 1 if ok else 0; dk["failure"] += 0 if ok else 1

    stats = []
    for dock_id, dd in by_dock.items():
        docklets = []
        for docklet_id, dk in dd["docklets"].items():
            actions = [
                {"action": act, **v,
                 "rel": round(100 * v["success"] / v["total"], 2) if v["total"] else 0}
                for act, v in actions_by_dk.get((dock_id, docklet_id), {}).items()
            ]
            docklets.append({
                "docklet_id": docklet_id,
                "total": dk["total"], "success": dk["success"], "failure": dk["failure"],
                "rel": round(100 * dk["success"] / dk["total"], 2) if dk["total"] else 0,
                "actions": actions,
            })
        stats.append({
            "dock_id": dock_id, "total": dd["total"], "success": dd["success"],
            "failure": dd["failure"],
            "rel": round(100 * dd["success"] / dd["total"], 2) if dd["total"] else 0,
            "docklets": docklets,
        })
    return stats


def _build_dock_usage(dock_rows):
    """Dock USAGE breakdown — sourced from dock_logs only (action-type counts:
    increment / decrement / toggle). Reliability is NOT taken from here."""
    from collections import defaultdict
    by_action  = defaultdict(int)
    by_docklet = defaultdict(int)
    by_date    = defaultdict(lambda: {"total": 0, "success": 0, "failure": 0})
    for r in dock_rows:
        by_action[r["action"]]      += r["total_action_count"]
        by_docklet[r["docklet_id"]] += r["total_action_count"]
        by_date[r["date"]]["total"]   += r["total_action_count"]
        by_date[r["date"]]["success"] += r["success_count"]
        by_date[r["date"]]["failure"] += r["failure_count"]
    daily = [
        {"date": d, **v,
         "rel": round(100 * v["success"] / v["total"], 2) if v["total"] else 0}
        for d, v in sorted(by_date.items())
    ]
    return {
        "total":      sum(by_action.values()),
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
        SELECT DISTINCT hub_id FROM (
            SELECT hub_id FROM `schnell-home-automation.schnell_analytics.ha_logs` WHERE hub_id IS NOT NULL AND hub_id != ''
            UNION DISTINCT
            SELECT hub_id FROM `schnell-home-automation.schnell_analytics.app_logs` WHERE hub_id IS NOT NULL AND hub_id != ''
            UNION DISTINCT
            SELECT hub_id FROM `schnell-home-automation.schnell_analytics.dock_logs` WHERE hub_id IS NOT NULL AND hub_id != ''
        )
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

    # ── Fire all queries in parallel ─────────────────────────────────────
    with ThreadPoolExecutor(max_workers=15) as ex:
        # Headline KPIs — GENUINE APP-TRIGGERED events only (observed excluded).
        f_kpi      = ex.submit(q, f"""
            SELECT COUNT(*) AS total, COUNTIF(success) AS success,
                   COALESCE(ROUND(100*COUNTIF(success)/NULLIF(COUNT(*),0),2),0) AS reliability
            FROM {AL} WHERE hub_id=@hub_id AND {APP_UC}
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date""", p)
        f_le       = ex.submit(q, f"""
            SELECT ROUND(AVG(latency_ms)) AS avg,
                   APPROX_QUANTILES(latency_ms,100)[OFFSET(50)] AS p50,
                   APPROX_QUANTILES(latency_ms,100)[OFFSET(95)] AS p95,
                   ROUND(STDDEV(latency_ms)) AS stddev
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
        # Hub → SNAP → Hub = real device-actuation latency = the gap between when the
        # hub sent the Matter command and when the device confirmed its new state.
        # (NOT ha_processing_latency_ms — that's ~0, just HA's internal handling.)
        # gap > 0 excludes rows the hub hasn't stamped with distinct times yet.
        f_hs       = ex.submit(q, f"""
            SELECT ROUND(AVG(gap)) AS avg,
                   APPROX_QUANTILES(gap,100)[OFFSET(50)] AS p50,
                   APPROX_QUANTILES(gap,100)[OFFSET(95)] AS p95,
                   ROUND(STDDEV(gap)) AS stddev
            FROM (
              SELECT TIMESTAMP_DIFF(SAFE_CAST(snap_state_change_ts AS TIMESTAMP),
                                    SAFE_CAST(matter_command_ts  AS TIMESTAMP),
                                    MILLISECOND) AS gap
              FROM {HL} WHERE hub_id=@hub_id
                AND matter_command_ts IS NOT NULL AND snap_state_change_ts IS NOT NULL
                AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            ) WHERE gap > 0""", p)
        # log_source included so the sample table shows which origin actually
        # caused this device actuation (app/dock/automation/scene/hub-ui) —
        # this segment is deliberately origin-agnostic for the *latency* stat
        # itself (device round-trip time doesn't depend on who triggered it),
        # but knowing the origin per sample is useful context now that it's
        # available (Hub Logging Spec).
        f_hs_ev    = ex.submit(q, f"""
            SELECT event_timestamp AS ts, entity_id AS dev, friendly_name,
                   ha_event_type AS uc, room, log_source AS origin,
                   matter_command_ts AS matter_ts, snap_state_change_ts AS snap_ts,
                   TIMESTAMP_DIFF(SAFE_CAST(snap_state_change_ts AS TIMESTAMP),
                                  SAFE_CAST(matter_command_ts  AS TIMESTAMP),
                                  MILLISECOND) AS lat
            FROM {HL} WHERE hub_id=@hub_id
              AND matter_command_ts IS NOT NULL AND snap_state_change_ts IS NOT NULL
              AND TIMESTAMP_DIFF(SAFE_CAST(snap_state_change_ts AS TIMESTAMP),
                                 SAFE_CAST(matter_command_ts  AS TIMESTAMP),
                                 MILLISECOND) > 0
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            ORDER BY event_timestamp DESC LIMIT 50""", p)
        f_per_uc   = ex.submit(q, f"""
            SELECT use_case, ROUND(AVG(latency_ms)) AS avg,
                   APPROX_QUANTILES(latency_ms,100)[OFFSET(50)] AS p50,
                   APPROX_QUANTILES(latency_ms,100)[OFFSET(95)] AS p95,
                   ROUND(STDDEV(latency_ms)) AS stddev,
                   COUNT(*) AS count, COUNTIF(success) AS success
            FROM {AL} WHERE hub_id=@hub_id AND latency_ms IS NOT NULL AND {APP_UC}
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            GROUP BY use_case""", p)
        f_per_uc_ev = ex.submit(q, f"""
            SELECT use_case, ts, dev, friendly_name, lat, src, room FROM (
              SELECT use_case, event_timestamp AS ts, entity_id AS dev,
                     friendly_name, latency_ms AS lat, trigger_method AS src, room,
                     ROW_NUMBER() OVER (PARTITION BY use_case
                                        ORDER BY event_timestamp DESC) AS rn
              FROM {AL} WHERE hub_id=@hub_id AND latency_ms IS NOT NULL AND {APP_UC}
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
            FROM {AL} WHERE hub_id=@hub_id AND latency_ms IS NOT NULL AND {APP_UC}
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            GROUP BY use_case, bucket""", p)
        f_bcount   = ex.submit(q, f"""
            SELECT CASE WHEN latency_ms<500  THEN '<500ms'
                        WHEN latency_ms<1000 THEN '500-1000ms'
                        WHEN latency_ms<2000 THEN '1-2s'
                        WHEN latency_ms<5000 THEN '2-5s'
                        ELSE '>5s' END AS bucket,
                   COUNT(*) AS cnt
            FROM {AL} WHERE hub_id=@hub_id AND latency_ms IS NOT NULL AND {APP_UC}
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
            FROM {AL} WHERE hub_id=@hub_id AND latency_ms IS NOT NULL AND {APP_UC}
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            LIMIT 500""", p)
        f_daily    = ex.submit(q, f"""
            SELECT date, COUNT(*) AS total,
                   ROUND(100*COUNTIF(success)/COUNT(*),2) AS rel,
                   AVG(latency_ms) AS avg,
                   STDDEV(latency_ms) AS sd,
                   APPROX_QUANTILES(latency_ms,100 IGNORE NULLS)[OFFSET(50)] AS p50,
                   APPROX_QUANTILES(latency_ms,100 IGNORE NULLS)[OFFSET(95)] AS p95,
                   ROUND(100*COUNTIF(latency_ms<1000)/
                         NULLIF(COUNTIF(latency_ms IS NOT NULL),0),2) AS ns
            FROM {AL} WHERE hub_id=@hub_id AND {APP_UC}
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            GROUP BY date ORDER BY date""", p)
        # (Heatmaps are built client-side from the complete event pool — no backend
        #  heatmap query needed; that keeps cell counts equal to the drill-downs.)
        f_fail     = ex.submit(q, f"""
            SELECT event_timestamp AS ts, use_case AS uc, entity_id AS dev,
                   friendly_name, failure_reason AS reason, room,
                   trigger_method AS src, CAST(latency_ms AS STRING) AS lat,
                   network_type AS net, COALESCE(docklet_id,'') AS dock
            FROM {AL} WHERE hub_id=@hub_id AND success=false AND {APP_UC}
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            ORDER BY event_timestamp DESC LIMIT 100""", p)
        f_src      = ex.submit(q, f"""
            SELECT use_case, COUNT(*) AS total, COUNTIF(success) AS success,
                   COUNTIF(NOT success) AS fail,
                   ROUND(100*COUNTIF(success)/COUNT(*),2) AS rel
            FROM {AL} WHERE hub_id=@hub_id AND {APP_UC}
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            GROUP BY use_case""", p)
        # Hub device-processing event count — real device events only (excludes HA
        # system noise: service_registered, entity_registry_updated, panels_updated…)
        f_ha_cnt   = ex.submit(q, f"""
            SELECT COUNT(*) AS cnt FROM {HL}
            WHERE hub_id=@hub_id
              AND ha_event_type IN ('call_service','state_changed')
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date""", p)
        f_fbr      = ex.submit(q, f"""
            SELECT failure_reason AS reason, COUNT(*) AS cnt
            FROM {AL} WHERE hub_id=@hub_id AND success=false AND failure_reason IS NOT NULL AND {APP_UC}
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            GROUP BY failure_reason ORDER BY cnt DESC""", p)
        f_fbr_ev   = ex.submit(q, f"""
            SELECT failure_reason AS reason, event_timestamp AS ts,
                   entity_id AS dev, friendly_name, use_case AS uc,
                   trigger_method AS src, room, CAST(latency_ms AS STRING) AS lat
            FROM {AL} WHERE hub_id=@hub_id AND success=false AND failure_reason IS NOT NULL AND {APP_UC}
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            ORDER BY event_timestamp DESC LIMIT 300""", p)
        f_fbd      = ex.submit(q, f"""
            SELECT entity_id AS dev, failure_reason AS reason, COUNT(*) AS cnt
            FROM {AL} WHERE hub_id=@hub_id AND success=false AND {APP_UC}
              AND SPLIT(entity_id,'.')[OFFSET(0)] NOT IN ('scene','automation','script','group')
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            GROUP BY entity_id, failure_reason ORDER BY entity_id, cnt DESC""", p)
        f_dev      = ex.submit(q, f"""
            SELECT entity_id AS id, ANY_VALUE(room) AS room,
                   COUNT(*) AS total, COUNTIF(success=true) AS success,
                   ROUND(100*COUNTIF(success=true)/COUNT(*),2) AS rel,
                   APPROX_QUANTILES(latency_ms,100 IGNORE NULLS)[OFFSET(50)] AS p50
            FROM {AL} WHERE hub_id=@hub_id AND {APP_UC}
              AND SPLIT(entity_id,'.')[OFFSET(0)] NOT IN ('scene','automation','script','group')
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            GROUP BY entity_id ORDER BY total DESC LIMIT 50""", p)
        f_usage    = ex.submit(q, f"""
            SELECT COUNTIF(use_case IN ('Local App Control','Device Bind (App)')) AS app,
                   COUNTIF(use_case='Remote App Control')  AS remote,
                   COUNTIF(use_case='Observed Change (App)') AS direct
            FROM {AL} WHERE hub_id=@hub_id
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date""", p)
        f_snap_count = ex.submit(q, f"""
            SELECT COUNT(DISTINCT entity_id) AS cnt
            FROM {AL} WHERE hub_id=@hub_id AND {APP_UC}
              AND SPLIT(entity_id,'.')[OFFSET(0)] NOT IN ('scene','automation','script','group')
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date""", p)
        # Hub→App WS push = ws_confirmation_ts − rest_response_ts over the FULL
        # window (timestamps stored as STRING → SAFE_CAST). diff >= 0 guards
        # against clock-skew rows where ws_conf precedes rest_resp.
        f_hub_app    = ex.submit(q, f"""
            SELECT ROUND(AVG(diff)) AS avg,
                   APPROX_QUANTILES(diff,100)[OFFSET(50)] AS p50,
                   APPROX_QUANTILES(diff,100)[OFFSET(95)] AS p95,
                   ROUND(STDDEV(diff)) AS stddev
            FROM (
              SELECT TIMESTAMP_DIFF(SAFE_CAST(ws_confirmation_ts AS TIMESTAMP),
                                    SAFE_CAST(rest_response_ts  AS TIMESTAMP),
                                    MILLISECOND) AS diff
              FROM {AL} WHERE hub_id=@hub_id AND latency_ms IS NOT NULL
                AND use_case IN ('Local App Control','Device Bind (App)')
                AND rest_response_ts IS NOT NULL AND ws_confirmation_ts IS NOT NULL
                AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            ) WHERE diff >= 0""", p)
        # COMPLETE app-triggered event list — the Log Center is built from this so
        # its counts reconcile exactly with the headline cards (no sampling).
        f_all_ev     = ex.submit(q, f"""
            SELECT event_timestamp AS ts, entity_id AS dev, friendly_name,
                   use_case AS uc, latency_ms AS lat, room, network_type AS net,
                   trigger_method AS src, success, failure_reason AS reason,
                   tap_ts AS tap, command_sent_ts AS cmd_sent,
                   rest_response_ts AS rest_resp, ws_confirmation_ts AS ws_conf
            FROM {AL} WHERE hub_id=@hub_id AND {APP_UC}
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            ORDER BY event_timestamp DESC LIMIT 20000""", p)
        # Observed Change (App) — passive app observation. Kept for INTERNAL
        # reference only; not shown as a user-facing category.
        f_obs_cnt    = ex.submit(q, f"""
            SELECT COUNT(*) AS cnt FROM {AL}
            WHERE hub_id=@hub_id AND use_case='Observed Change (App)'
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date""", p)
        # Hub-recorded scene activations & automation runs from ha_logs (reliable —
        # recorded even when the app is closed). This is the ONLY source for
        # scene/automation counts anywhere in the dashboard.
        f_hub_obs_ev = ex.submit(q, f"""
            SELECT event_timestamp AS ts, entity_id AS dev, friendly_name,
                   CASE WHEN entity_id LIKE 'scene.%' THEN 'Scene Activated (Hub)'
                        ELSE 'Automation Run (Hub)' END AS uc, room
            FROM {HL} WHERE hub_id=@hub_id
              AND ((entity_id LIKE 'scene.%'      AND ha_event_type='call_service')
                OR (entity_id LIKE 'automation.%' AND ha_event_type='automation_triggered'))
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            ORDER BY event_timestamp DESC LIMIT 2000""", p)
        f_hub_obs_cnt = ex.submit(q, f"""
            SELECT COUNTIF(entity_id LIKE 'scene.%'      AND ha_event_type='call_service')         AS hub_scene,
                   COUNTIF(entity_id LIKE 'automation.%' AND ha_event_type='automation_triggered') AS hub_auto
            FROM {HL} WHERE hub_id=@hub_id
              AND DATE(event_timestamp) BETWEEN @from_date AND @to_date""", p)
        # Dock action-type USAGE breakdown (dock_logs — increment/decrement/toggle).
        # Used ONLY for the usage panel, NOT for reliability.
        f_dock     = ex.submit(q, f"""
            SELECT date, day_of_week, dock_id, docklet_id, action,
                   total_action_count, success_count, failure_count
            FROM `{PROJECT}.schnell_analytics.dock_logs`
            WHERE hub_id=@hub_id
              AND DATE(date) BETWEEN @from_date AND @to_date""", p)
        # Dock press events (real, from ha_logs) — each press marked success/fail by
        # whether its context_id produced an on/off state. This ONE list feeds both
        # the Log Center and the dock reliability, so they always reconcile.
        #
        # dock_id is an entity-hardware mapping (Custom Storage), not an origin
        # signal — an app-triggered command on a dock-bound device ALSO carries
        # dock_id, which was inflating dock press counts with app-caused
        # activity (confirmed 2026-07-09 testing: app commands on
        # switch.test_product_switch_2/4 both showed dock_id set). Once the Hub
        # Logging Spec fields exist on a row (is_trigger IS NOT NULL), require
        # TRUE dock origin (is_trigger AND log_source LIKE 'dock:%') to count it
        # as a press. Rows from before the spec was added keep the original
        # dock_id-only heuristic, so historical counts don't shift underfoot.
        f_dock_ev  = ex.submit(q, f"""
            WITH presses AS (
              SELECT event_timestamp AS ts, entity_id AS dev, friendly_name,
                     dock_id, docklet_id, action, room, context_id
              FROM {HL} WHERE hub_id=@hub_id AND dock_id IS NOT NULL AND dock_id!=''
                AND ha_event_type='call_service'
                AND (is_trigger IS NULL OR (is_trigger AND log_source LIKE 'dock:%'))
                AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
            ),
            outcomes AS (
              SELECT context_id, LOGICAL_OR(new_state IN ('on','off')) AS ok
              FROM {HL} WHERE hub_id=@hub_id AND ha_event_type='state_changed'
                AND context_id IS NOT NULL
                AND DATE(event_timestamp) BETWEEN @from_date AND @to_date
              GROUP BY context_id
            )
            SELECT p.ts, p.dev, p.friendly_name, p.dock_id, p.docklet_id, p.action,
                   p.room, COALESCE(o.ok, false) AS success
            FROM presses p LEFT JOIN outcomes o USING(context_id)
            ORDER BY p.ts DESC LIMIT 20000""", p)
        # Note: `snap:` log_source rows are the SNAP board actuating a device — the
        # device-layer of an action already triggered by app/dock/automation. They are
        # NOT counted separately (that would double-count the trigger). The SNAP
        # timestamps still feed the Hub → SNAP → Hub *latency* (f_hs), which is timing,
        # not a count.

        # Direct HA-screen control — the ONE previously-uncountable source (see
        # "Known data gaps" in the architecture doc). Resolved via the Hub Logging
        # Spec fields (trigger_id / is_trigger / log_source): an is_trigger row
        # that isn't automation:/scene:/dock:/snap:, AND has no matching
        # app_logs.trigger_id, can only be a direct HA-UI action. This join is
        # used instead of comparing HA account ids because this product only ever
        # has one HA account per hub — the app and the hub's own UI share it, so
        # account comparison alone can't tell them apart; whether the app itself
        # logged initiating this exact action can. Only present on events
        # recorded after these fields were added — older rows have NULL
        # is_trigger and are correctly excluded, never miscounted. Kept as its
        # own additive metric for now (not folded into total_activity yet) until
        # it's been observed across more real-world traffic.
        f_ha_ui_cnt = ex.submit(q, f"""
            SELECT COUNT(*) AS cnt
            FROM {HL} h
            WHERE h.hub_id=@hub_id AND h.is_trigger
              AND COALESCE(h.log_source, '') NOT LIKE 'automation:%'
              AND COALESCE(h.log_source, '') NOT LIKE 'scene:%'
              AND COALESCE(h.log_source, '') NOT LIKE 'dock:%'
              AND COALESCE(h.log_source, '') NOT LIKE 'snap:%'
              AND NOT EXISTS (
                SELECT 1 FROM {AL} a
                WHERE a.hub_id=@hub_id AND a.trigger_id=h.trigger_id
              )
              AND DATE(h.event_timestamp) BETWEEN @from_date AND @to_date""", p)
        f_ha_ui_ev  = ex.submit(q, f"""
            SELECT h.event_timestamp AS ts, h.entity_id AS dev, h.friendly_name, h.room
            FROM {HL} h
            WHERE h.hub_id=@hub_id AND h.is_trigger
              AND COALESCE(h.log_source, '') NOT LIKE 'automation:%'
              AND COALESCE(h.log_source, '') NOT LIKE 'scene:%'
              AND COALESCE(h.log_source, '') NOT LIKE 'dock:%'
              AND COALESCE(h.log_source, '') NOT LIKE 'snap:%'
              AND NOT EXISTS (
                SELECT 1 FROM {AL} a
                WHERE a.hub_id=@hub_id AND a.trigger_id=h.trigger_id
              )
              AND DATE(h.event_timestamp) BETWEEN @from_date AND @to_date
            ORDER BY h.event_timestamp DESC LIMIT 200""", p)

    # ── Collect results & post-process (fast, sequential) ────────────────
    kpi = f_kpi.result()[0]

    le     = f_le.result()
    # APPROX_QUANTILES/AVG return NULL for an empty window — coalesce to 0 so the
    # UI never renders "nullms".
    le_kpi = {k: (le[0].get(k) or 0) for k in ("avg","p50","p95","stddev")} if le else {"avg":0,"p50":0,"p95":0,"stddev":0}
    le_events = f_le_ev.result()
    for e in le_events:
        e["src"] = uc_src(e.get("uc"))

    hs     = f_hs.result()
    hs_kpi = {k: (hs[0].get(k) or 0) for k in ("avg","p50","p95","stddev")} if hs else {"avg":0,"p50":0,"p95":0,"stddev":0}
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

    ha_rows      = f_hub_app.result()
    ha_raw       = ha_rows[0] if ha_rows else {}
    hub_app_kpi  = {"avg": ha_raw.get("avg") or 0,
                    "p50": ha_raw.get("p50") or 0,
                    "p95": ha_raw.get("p95") or 0,
                    "stddev": ha_raw.get("stddev") or 0}

    # Complete app-triggered event list — Log Center source of truth
    all_events = f_all_ev.result()
    for e in all_events:
        e["src"] = uc_src(e.get("uc"))

    hub_obs_events = f_hub_obs_ev.result()
    for e in hub_obs_events:
        e["src"] = "direct_hub"

    hub_obs_rows = f_hub_obs_cnt.result()
    hub_obs      = hub_obs_rows[0] if hub_obs_rows else {}
    hub_scene_cnt = int(hub_obs.get("hub_scene", 0) or 0)
    hub_auto_cnt  = int(hub_obs.get("hub_auto",  0) or 0)

    # Direct HA-screen control (Hub Logging Spec) — additive metric, see f_ha_ui_cnt.
    ha_ui_rows = f_ha_ui_cnt.result()
    ha_ui_cnt  = int((ha_ui_rows or [{}])[0].get("cnt", 0) or 0)
    ha_ui_events = f_ha_ui_ev.result()
    for e in ha_ui_events:
        e["src"] = "direct_hub_ui"

    obs_cnt = int((f_obs_cnt.result() or [{}])[0].get("cnt", 0) or 0)

    failures = []
    for f in f_fail.result():
        f["src"] = uc_src(f.get("uc"))
        f["lat"] = f["lat"] if f["lat"] else "N/A"
        failures.append(f)

    src_rows = f_src.result()
    src_rel  = {r["use_case"]:{k:v for k,v in r.items() if k!="use_case"} for r in src_rows}
    a_rows   = [r for r in src_rows if "App Control" in (r.get("use_case") or "")]
    at=sum(r["total"] for r in a_rows); as_=sum(r["success"] for r in a_rows)

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

    # Dock: reliability from ha_logs (context_id-linked press→outcome); the
    # dock_logs action rows feed only the usage breakdown.
    dock_rows_filtered = [
        {**r, "total_action_count": int(r["total_action_count"] or 0),
              "success_count":      int(r["success_count"]      or 0),
              "failure_count":      int(r["failure_count"]      or 0)}
        for r in f_dock.result()
    ]
    dock_ev     = f_dock_ev.result()
    # Fold dock press failures into the failure tables so "Failures by Reason /
    # Device" reconcile with the all-source Failures count. A dock failure = the
    # bound device never reached on/off (reason: DEVICE_UNAVAILABLE).
    _dock_fail_evs = [e for e in dock_ev if not e.get("success")]
    if _dock_fail_evs:
        _fbr = fail_by_reason.setdefault("DEVICE_UNAVAILABLE", {"count": 0, "events": []})
        _fbr["count"] += len(_dock_fail_evs)
        _fbr["events"].extend({
            "ts": e["ts"], "dev": e["dev"], "friendly_name": e.get("friendly_name"),
            "uc": "Dock Control", "src": "docklet", "room": e.get("room"), "lat": "N/A"
        } for e in _dock_fail_evs[:300])
        for e in _dock_fail_evs:
            dev = e["dev"] or e.get("docklet_id") or "unknown"
            _fbd = fail_by_device.setdefault(dev, {"count": 0, "reasons": {}})
            _fbd["reasons"]["DEVICE_UNAVAILABLE"] = _fbd["reasons"].get("DEVICE_UNAVAILABLE", 0) + 1
            _fbd["count"] += 1
    dock_stats      = _build_dock_stats(dock_ev, dock_rows_filtered)
    dock_usage_data = _build_dock_usage(dock_rows_filtered)
    # Dock press counts + reliability — from the same dock_ev list (single source)
    dock_press_total = len(dock_ev)
    dock_succ        = sum(1 for e in dock_ev if e.get("success"))
    dock_fail        = dock_press_total - dock_succ
    dock_press_rel   = round(100 * dock_succ / dock_press_total, 2) if dock_press_total else 0
    # Dock is a real trigger with pass/fail, so it belongs in the per-source table.
    if dock_press_total:
        src_rel["Dock Control"] = {"total": dock_press_total, "success": dock_succ,
                                   "fail": dock_fail, "rel": dock_press_rel}

    ur          = (f_usage.result() or [{}])[0]
    app_cnt     = int(ur.get("app",    0) or 0)
    remote_cnt  = int(ur.get("remote", 0) or 0)
    # Dock event count comes from ha_logs presses (reliable, always-on); the app
    # only *observes* dock presses while open, so app-observed dock is not used.
    dock_cnt    = dock_press_total
    h_total     = app_cnt + dock_cnt
    snap_device_cnt = int((f_snap_count.result() or [{}])[0].get("cnt", 0) or 0)
    usage = {
        "app": app_cnt, "remote": remote_cnt,
        "docklet": dock_cnt,                # dock device activations (ha_logs)
        "direct": obs_cnt,                  # observed — INTERNAL reference only
        "app_ratio":  round(100 * app_cnt  / h_total, 2) if h_total else 0,
        "dock_ratio": round(100 * dock_cnt / h_total, 2) if h_total else 0,
        "snap_devices":   snap_device_cnt,
        # scene/automation — hub-recorded (ha_logs) is the only source
        "hub_scene_total":   hub_scene_cnt,
        "hub_scene_per_day": round(hub_scene_cnt / days_count, 2),
        "hub_auto_total":    hub_auto_cnt,
        "hub_auto_per_day":  round(hub_auto_cnt / days_count, 2),
        # Direct HA-screen control (Hub Logging Spec) — additive, not yet folded
        # into total_activity/activity_reliability. See f_ha_ui_cnt.
        "direct_ha_ui_total":   ha_ui_cnt,
        "direct_ha_ui_per_day": round(ha_ui_cnt / days_count, 2),
    }

    # ── ALL-SOURCE totals — every reliable event, whoever triggered it ──────────
    # Total activity = app commands + dock presses + scene activations + automation
    # runs. Success/fail spans app + dock (both have a real outcome); scene &
    # automation runs are counted as successful activity (the hub recorded them).
    total_activity   = int(kpi["total"]) + dock_press_total + hub_scene_cnt + hub_auto_cnt
    app_fail         = int(kpi["total"]) - int(kpi["success"])
    activity_success = int(kpi["success"]) + dock_succ + hub_scene_cnt + hub_auto_cnt
    activity_fail    = app_fail + dock_fail
    activity_reliability = round(100 * activity_success / total_activity, 2) if total_activity else 0

    result = {
        "total":          kpi["total"],        # app-triggered count
        "success":        kpi["success"],      # app-triggered successes
        "reliability":    kpi["reliability"],  # app-command reliability (per-source detail)
        # all-source headline numbers (Total Events / Reliability / Failures tiles)
        "total_activity":       total_activity,
        "activity_success":     activity_success,
        "activity_fail":        activity_fail,
        "activity_reliability": activity_reliability,
        "speed": {
            "hub_snap_hub": {**hs_kpi, "events": hs_events},
            "local_e2e":    {**le_kpi, "events": le_events},
            "remote_e2e":   {"avg":0,"p50":0,"p95":0,"stddev":0,"events":[]},
            "hub_app":      {**hub_app_kpi, "events": []},
            "buckets":       buckets,
            "bucket_events": bucket_events,
            "per_uc":        per_uc,
        },
        "daily":          daily,
        "failures":       failures,
        "reliability_detail": {
            "app_trigger_feedback":  round(100*as_/at,2) if at else 0,
            "dock_trigger_feedback": dock_press_rel,
            "hub_to_app":        round(100*as_/at,2) if at else 0,
            "app_triggers":      at,
            "app_feedbacks":     as_,
            "dock_triggers":     dock_press_total,
            "dock_feedbacks":    dock_succ,
            "hub_to_snap_count": hub_to_snap_count,
            "src_rel":           src_rel,
            "dock_stats":        dock_stats,
        },
        "dock_usage":     dock_usage_data,
        "dock_events":    dock_ev,                # ha_logs dock activations
        "all_events":     all_events,             # complete app-triggered list
        "hub_observed_events": hub_obs_events,    # scene/automation from ha_logs
        "hub_ha_ui_events": ha_ui_events,         # direct HA-UI control (Hub Logging Spec)
        "usage":          usage,
        "devices":        devices,
        "fail_by_reason": fail_by_reason,
        "fail_by_device": fail_by_device,
    }
    _HUB_CACHE[_ck] = (time.time(), result)
    return result

# Static UI lives in Analytics/public — the single source of truth, served both
# here (local dev / container) and by Firebase Hosting in production.
_root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")

@app.get("/")
def serve_dashboard():
    return FileResponse(os.path.join(_root, "index.html"))

# Serve dashboard_app.js and any other static files from Analytics/public/
app.mount("/", StaticFiles(directory=_root), name="static")
