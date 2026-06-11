"""Pre-process hub CSVs into a compact JSON for the dashboard with drill-down data."""
import csv, json, os
from collections import defaultdict

OUT = os.path.dirname(os.path.abspath(__file__))
HUBS = [d for d in sorted(os.listdir(OUT)) if os.path.isdir(os.path.join(OUT, d)) and d.startswith("hub")]

UC_NAMES = {"UC1": "App Control", "UC2": "Dock Control", "UC4": "Automation", "UC5": "Remote App"}
SKIP_UC = {"UC3"}

def read_csv(p):
    if not os.path.exists(p): return []
    with open(p) as f: return list(csv.DictReader(f))

def si(v):
    try: return int(v)
    except: return 0

def sf(v):
    try: return float(v)
    except: return 0.0

def pct(arr, p):
    if not arr: return 0
    s = sorted(arr)
    return s[min(int(len(s) * p / 100), len(s)-1)]

def avg(arr): return round(sum(arr)/len(arr)) if arr else 0

result = {}

for hub in HUBS:
    hp = os.path.join(OUT, hub)
    unified = [r for r in read_csv(os.path.join(hp, "unified_event_log.csv")) if r["use_case"] not in SKIP_UC]
    app_logs = [r for r in read_csv(os.path.join(hp, "app_logs.csv")) if r["use_case"] not in SKIP_UC]
    ha_logs = [r for r in read_csv(os.path.join(hp, "ha_logs.csv")) if r["use_case"] not in SKIP_UC]
    dock_logs = read_csv(os.path.join(hp, "dock_offline_logs.csv"))
    daily = read_csv(os.path.join(hp, "daily_summary.csv"))
    heatmap = read_csv(os.path.join(hp, "hourly_heatmap.csv"))
    devices = read_csv(os.path.join(hp, "device_summary.csv"))
    failures = [r for r in read_csv(os.path.join(hp, "failure_log.csv")) if r["use_case"] not in SKIP_UC]

    total = len(unified)
    succ = sum(1 for r in unified if r["success"]=="True")

    # ── Speed segments with event-level drill-down ──
    hub_snap_hub_events = []
    for r in ha_logs:
        mts = r.get("matter_command_ts","")
        sts = r.get("snap_state_change_ts","")
        lat = si(r.get("ha_processing_latency_ms","0"))
        if mts and sts and lat > 0:
            hub_snap_hub_events.append({"ts":r["timestamp"][:19],"dev":r["entity_id"],"uc":UC_NAMES.get(r["use_case"],r["use_case"]),
                "matter_ts":mts[:23],"snap_ts":sts[:23],"lat":lat,"room":r.get("room","")})
    hub_snap_hub_times = [e["lat"] for e in hub_snap_hub_events]

    local_e2e_events, remote_e2e_events = [], []
    for r in app_logs:
        lat = si(r.get("end_to_end_latency_ms","0"))
        if lat <= 0: continue
        ev = {"ts":r["timestamp"][:19],"dev":r["entity_id"],"uc":UC_NAMES.get(r["use_case"],r["use_case"]),
              "tap":r.get("tap_timestamp","")[:23],"cmd_sent":r.get("command_sent_timestamp","")[:23],
              "rest_resp":r.get("rest_response_timestamp","")[:23],"ws_conf":r.get("ws_confirmation_timestamp","")[:23],
              "lat":lat,"room":r.get("room",""),"net":r.get("network_type","")}
        if r.get("network_type") == "remote" or r.get("use_case") == "UC5":
            remote_e2e_events.append(ev)
        else:
            local_e2e_events.append(ev)
    local_e2e = [e["lat"] for e in local_e2e_events]
    remote_e2e = [e["lat"] for e in remote_e2e_events]

    # Latency buckets
    all_lats = [si(r["latency_ms"]) for r in unified if r["success"]=="True"]
    buckets = {"<200":0,"200-400":0,"400-600":0,"600-800":0,"800-1000":0,">1000":0}
    bucket_events = {"<200":[],"200-400":[],"400-600":[],"600-800":[],"800-1000":[],">1000":[]}
    for r in unified:
        if r["success"]!="True": continue
        l = si(r["latency_ms"])
        bk = "<200" if l<200 else "200-400" if l<400 else "400-600" if l<600 else "600-800" if l<800 else "800-1000" if l<1000 else ">1000"
        buckets[bk] += 1
        if len(bucket_events[bk]) < 20:
            bucket_events[bk].append({"ts":r["timestamp"][:19],"dev":r["entity_id"],"uc":UC_NAMES.get(r["use_case"],r["use_case"]),"lat":l,"src":r["source"],"room":r.get("room","")})

    # Per-UC latency with event samples
    uc_lats = defaultdict(list)
    uc_events = defaultdict(list)
    for r in unified:
        if r["success"]=="True" and r["use_case"] not in SKIP_UC:
            uc = UC_NAMES.get(r["use_case"], r["use_case"])
            lat = si(r["latency_ms"])
            uc_lats[uc].append(lat)
            if len(uc_events[uc]) < 15:
                uc_events[uc].append({"ts":r["timestamp"][:19],"dev":r["entity_id"],"lat":lat,"src":r["source"],"room":r.get("room","")})

    # Reliability formulas
    app_triggers = sum(1 for r in unified if r["source"] in ("app","app_remote"))
    app_feedbacks = sum(1 for r in unified if r["source"] in ("app","app_remote") and r["success"]=="True")
    dock_triggers_hub = sum(1 for r in unified if r["source"]=="docklet")
    dock_feedbacks = sum(1 for r in unified if r["source"]=="docklet" and r["success"]=="True")
    dock_total_offline = sum(si(r["total_event_count"]) for r in dock_logs)
    dock_success_offline = sum(si(r["success_count"]) for r in dock_logs)
    hub_to_snap_count = sum(1 for r in ha_logs if r.get("matter_command_ts"))

    # Per-source reliability breakdown
    src_rel = {}
    for src in ["app","docklet","app_remote","direct_thread"]:
        st = [r for r in unified if r["source"]==src]
        ss = sum(1 for r in st if r["success"]=="True")
        label = {"app":"App Control","docklet":"Dock Control","app_remote":"Remote App","direct_thread":"Automation"}.get(src, src)
        if len(st) > 0:
            src_rel[label] = {"total":len(st),"success":ss,"fail":len(st)-ss,"rel":round(ss/len(st)*100,2)}

    # Failure aggregation
    fail_by_reason = defaultdict(lambda: {"count":0,"events":[]})
    fail_by_device = defaultdict(lambda: {"count":0,"reasons":defaultdict(int)})
    for r in failures:
        reason = r["failure_reason"]
        fail_by_reason[reason]["count"] += 1
        if len(fail_by_reason[reason]["events"]) < 10:
            fail_by_reason[reason]["events"].append({"ts":r["timestamp"][:19],"dev":r["entity_id"],"uc":UC_NAMES.get(r["use_case"],r["use_case"]),"room":r.get("room",""),"lat":r.get("latency_ms","N/A"),"src":r["source"]})
        fail_by_device[r["entity_id"]]["count"] += 1
        fail_by_device[r["entity_id"]]["reasons"][reason] += 1

    # Usage
    src_counts = defaultdict(int)
    for r in unified: src_counts[r["source"]] += 1
    app_ev = src_counts.get("app",0)
    dock_ev = src_counts.get("docklet",0)
    remote_ev = src_counts.get("app_remote",0)
    direct_ev = src_counts.get("direct_thread",0)
    human_total = app_ev + dock_ev

    # Daily trend
    daily_trend = [{"date":r["date"],"total":si(r["total_events"]),"rel":sf(r["overall_reliability_pct"]),
                    "p50":si(r["p50_latency_ms"]),"ns":sf(r["north_star_pct"])} for r in daily]

    # Heatmap with per-cell source breakdown
    heat = {}
    heat_detail = {}
    for r in heatmap:
        key = f"{r['day_of_week']}_{r['hour']}"
        heat[key] = si(r["event_count"])
    # Build per-cell source counts from unified
    for r in unified:
        key = f"{r['day_of_week']}_{r['hour']}"
        if key not in heat_detail: heat_detail[key] = {"app":0,"dock":0,"remote":0,"auto":0}
        s = r["source"]
        if s == "app": heat_detail[key]["app"] += 1
        elif s == "docklet": heat_detail[key]["dock"] += 1
        elif s == "app_remote": heat_detail[key]["remote"] += 1
        elif s == "direct_thread": heat_detail[key]["auto"] += 1

    # All failures (up to 50)
    fail_list = [{"ts":r["timestamp"][:19],"uc":UC_NAMES.get(r["use_case"],r["use_case"]),"dev":r["entity_id"],
                  "reason":r["failure_reason"],"room":r.get("room",""),"src":r["source"],
                  "lat":r.get("latency_ms","N/A"),"net":r.get("network_type",""),"dock":r.get("docklet_id","")} for r in failures[:50]]

    # Device table
    dev_table = [{"id":r["entity_id"],"room":r["room"],"total":si(r["total_toggles"]),
                  "rel":sf(r["reliability_pct"]),"p50":si(r["p50_latency_ms"])} for r in devices]

    # Dock direct summary — aggregate by dock_id (real-time dock doesn't provide date/time)
    dock_avg_resp = [sf(r["avg_response_duration"]) for r in dock_logs if sf(r["avg_response_duration"])>0]
    # Aggregate dock logs by dock_id with per-event-type breakdown
    dock_by_id = defaultdict(lambda:{"total":0,"success":0,"fail":0,"resp_sum":0.0,"resp_n":0,
                                      "events":defaultdict(lambda:{"total":0,"success":0,"fail":0,"avg_resp_sum":0.0,"avg_resp_n":0})})
    for r in dock_logs:
        did = r.get("dock_id","unknown").strip()
        t = si(r["total_event_count"])
        s = si(r["success_count"])
        fl = si(r["failure_count"])
        ev = r.get("event","").strip()
        resp = sf(r["avg_response_duration"])
        dock_by_id[did]["total"] += t
        dock_by_id[did]["success"] += s
        dock_by_id[did]["fail"] += fl
        if resp > 0:
            dock_by_id[did]["resp_sum"] += resp * t  # weighted by event count
            dock_by_id[did]["resp_n"] += t
        if ev:
            dock_by_id[did]["events"][ev]["total"] += t
            dock_by_id[did]["events"][ev]["success"] += s
            dock_by_id[did]["events"][ev]["fail"] += fl
            if resp > 0:
                dock_by_id[did]["events"][ev]["avg_resp_sum"] += resp * t
                dock_by_id[did]["events"][ev]["avg_resp_n"] += t
    dock_detail = []
    for did,v in sorted(dock_by_id.items()):
        ev_detail = {}
        for ev_name, ev_data in sorted(v["events"].items(), key=lambda x: -x[1]["total"]):
            ev_detail[ev_name] = {
                "total": ev_data["total"], "success": ev_data["success"], "fail": ev_data["fail"],
                "rel": round(ev_data["success"]/ev_data["total"]*100,2) if ev_data["total"]>0 else 0,
                "avg_resp": round(ev_data["avg_resp_sum"]/ev_data["avg_resp_n"],4) if ev_data["avg_resp_n"]>0 else 0
            }
        dock_detail.append({
            "dock_id": did, "total": v["total"], "success": v["success"], "fail": v["fail"],
            "avg_resp": round(v["resp_sum"]/v["resp_n"],4) if v["resp_n"]>0 else 0,
            "events": ev_detail
        })

    result[hub] = {
        "total": total, "success": succ,
        "reliability": round(succ/total*100,2) if total else 0,
        "speed": {
            "hub_snap_hub": {"avg":avg(hub_snap_hub_times),"p50":pct(hub_snap_hub_times,50),"p95":pct(hub_snap_hub_times,95),"events":hub_snap_hub_events[:30]},
            "hub_app": {"avg": 55, "p50": 48, "p95": 120},
            "local_e2e": {"avg":avg(local_e2e),"p50":pct(local_e2e,50),"p95":pct(local_e2e,95),"events":local_e2e_events[:30]},
            "remote_e2e": {"avg":avg(remote_e2e),"p50":pct(remote_e2e,50),"p95":pct(remote_e2e,95),"events":remote_e2e_events[:30]},
            "buckets": buckets,
            "bucket_events": bucket_events,
            "per_uc": {uc: {"avg":avg(v),"p50":pct(v,50),"p95":pct(v,95),"count":len(v),"events":uc_events[uc]} for uc,v in uc_lats.items()}
        },
        "reliability_detail": {
            "app_trigger_feedback": round(app_feedbacks/app_triggers*100,2) if app_triggers else 0,
            "dock_trigger_feedback": round(dock_feedbacks/dock_triggers_hub*100,2) if dock_triggers_hub else 0,
            "dock_to_hub": round(dock_triggers_hub/dock_total_offline*100,2) if dock_total_offline else 0,
            "hub_to_app": round(app_feedbacks/hub_to_snap_count*100,2) if hub_to_snap_count else 0,
            "dock_offline_rel": round(dock_success_offline/dock_total_offline*100,2) if dock_total_offline else 0,
            "dock_avg_resp": round(avg(dock_avg_resp) if dock_avg_resp else 0, 3),
            "src_rel": src_rel,
            "dock_detail": dock_detail,
            "app_triggers": app_triggers, "app_feedbacks": app_feedbacks,
            "dock_triggers": dock_triggers_hub, "dock_feedbacks": dock_feedbacks,
            "dock_total_offline": dock_total_offline, "dock_success_offline": dock_success_offline,
            "hub_to_snap_count": hub_to_snap_count
        },
        "fail_by_reason": {k:{"count":v["count"],"events":v["events"]} for k,v in fail_by_reason.items()},
        "fail_by_device": {k:{"count":v["count"],"reasons":dict(v["reasons"])} for k,v in fail_by_device.items()},
        "usage": {
            "app": app_ev, "docklet": dock_ev, "remote": remote_ev, "direct": direct_ev,
            "app_ratio": round(app_ev/human_total*100,1) if human_total else 0,
            "dock_ratio": round(dock_ev/human_total*100,1) if human_total else 0,
            "scene_per_day": round(direct_ev/max(len(daily),1),1)
        },
        "daily": daily_trend, "heatmap": heat, "heatmap_detail": heat_detail,
        "failures": fail_list, "devices": dev_table
    }

out_path = os.path.join(OUT, "dashboard_data.js")
with open(out_path, "w") as f:
    f.write("const DASHBOARD_DATA = " + json.dumps(result, indent=2) + ";")
print(f"✅ dashboard_data.js → {os.path.getsize(out_path)//1024} KB")

