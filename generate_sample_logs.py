"""
Generate per-hub log folders replicating the Schnell_Mock_Data schema.
Each hub gets its own folder with all CSV log files.
Structure: sample_logs/hub001/, sample_logs/hub002/, sample_logs/hub003/
"""
import csv, random, uuid, os
from datetime import datetime, timedelta
from collections import defaultdict

random.seed(42)
OUT = os.path.dirname(os.path.abspath(__file__))

START = datetime(2025, 6, 15, 0, 0, 0)
END = datetime(2025, 7, 15, 23, 59, 59)
DAYS = [(START + timedelta(days=d)).strftime("%Y-%m-%d") for d in range(31)]
DOW = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]
ACTIONS = ["turn_on","turn_off","toggle"]
FAIL_REASONS = ["TIMEOUT","NO_RESPONSE","DEVICE_OFFLINE","THREAD_MESH_FAIL"]
USE_CASES = ["UC1","UC2","UC3","UC4","UC5"]

HUBS = {
    "hub001": {
        "devices": [
            ("light.snap_living_main","Living Room","Ground Floor","snap"),
            ("light.snap_living_accent","Living Room","Ground Floor","snap"),
            ("fan.snap_living_fan","Living Room","Ground Floor","snap"),
            ("light.snap_bedroom_main","Master Bedroom","First Floor","snap"),
            ("light.snap_bedroom_bedside","Master Bedroom","First Floor","snap"),
            ("fan.snap_bedroom_fan","Master Bedroom","First Floor","snap"),
        ],
        "docks": [
            ("switch.docklet_1","dock_living","light.snap_living_main"),
            ("switch.docklet_2","dock_living","light.snap_living_accent"),
            ("switch.docklet_3","dock_living","fan.snap_living_fan"),
            ("switch.docklet_4","dock_bedroom","light.snap_bedroom_main"),
        ],
        "dock_ids": ["W-Dock001-01","W-Dock001-02","W-Dock001-03","W-Dock001-04","W-Dock001-05"],
        "apps": ["HASApp0001","HASApp0002"],
        "scenes": [("scene_good_night","Good Night",6),("scene_wake_up","Wake Up",4),("scene_movie_mode","Movie Mode",3)],
    },
    "hub002": {
        "devices": [
            ("light.snap_kitchen_main","Kitchen","Ground Floor","snap"),
            ("light.snap_kitchen_counter","Kitchen","Ground Floor","snap"),
            ("fan.snap_dining_fan","Dining Room","Ground Floor","snap"),
            ("light.snap_study_main","Study Room","First Floor","snap"),
        ],
        "docks": [
            ("switch.docklet_5","dock_kitchen","light.snap_kitchen_main"),
            ("switch.docklet_6","dock_kitchen","light.snap_kitchen_counter"),
            ("switch.docklet_7","dock_dining","fan.snap_dining_fan"),
        ],
        "dock_ids": ["W-Dock002-01","W-Dock002-02","W-Dock002-03","W-Dock002-04"],
        "apps": ["HASApp0003","HASApp0004"],
        "scenes": [("scene_dinner_time","Dinner Time",5),("scene_all_off","All Off",8)],
    },
    "hub003": {
        "devices": [
            ("light.snap_garage_main","Garage","Ground Floor","snap"),
            ("light.snap_porch_main","Porch","Ground Floor","snap"),
            ("fan.snap_guest_fan","Guest Room","First Floor","snap"),
            ("light.snap_guest_main","Guest Room","First Floor","snap"),
            ("light.snap_hallway","Hallway","Ground Floor","snap"),
        ],
        "docks": [
            ("switch.docklet_8","dock_garage","light.snap_garage_main"),
            ("switch.docklet_9","dock_guest","light.snap_guest_main"),
            ("switch.docklet_10","dock_guest","fan.snap_guest_fan"),
        ],
        "dock_ids": ["W-Dock003-01","W-Dock003-02","W-Dock003-03","W-Dock003-04"],
        "apps": ["HASApp0005","HASApp0006"],
        "scenes": [("scene_welcome","Welcome Home",4),("scene_goodnight","Good Night",6),("scene_away","Away Mode",5)],
    },
}

def uid(): return str(uuid.uuid4())
def rts(base, lo, hi): return base + timedelta(milliseconds=random.randint(lo, hi))
def fts(dt): return dt.strftime("%Y-%m-%d %H:%M:%S.") + f"{dt.microsecond//1000:03d}"
def pick(lst): return random.choice(lst)

def gen_hub_data(hub_id, cfg):
    """Generate all CSV files for one hub."""
    hub_dir = os.path.join(OUT, hub_id)
    os.makedirs(hub_dir, exist_ok=True)

    unified, app_logs, ha_logs, failures = [], [], [], []
    daily_stats = {d: {"total":0,"success":0,"fail":0,"app":0,"dock":0,"direct":0,"remote":0,"scene":0,
                       "uc1":0,"uc2":0,"uc3":0,"uc4":0,"uc5":0,"uc1_s":0,"uc2_s":0,"uc4_s":0,"uc5_s":0,
                       "lats":[],"under1s":0} for d in DAYS}
    hourly = {}
    dev_stats = {d[0]: {"total":0,"app":0,"dock":0,"direct":0,"succ":0,"lats":[]} for d in cfg["devices"]}

    events_per_day = random.randint(28, 45)

    for day_str in DAYS:
        day_dt = datetime.strptime(day_str, "%Y-%m-%d")
        dow = DOW[day_dt.weekday()]
        is_wknd = dow in ("Saturday","Sunday")
        n = events_per_day + random.randint(-8, 8)
        if is_wknd: n = int(n * 1.2)

        for _ in range(n):
            eid = uid()
            hour = random.choices(range(24), weights=[1,1,1,1,1,2,4,6,5,3,3,4,5,4,3,3,4,5,7,8,7,5,3,2])[0]
            ts = day_dt + timedelta(hours=hour, minutes=random.randint(0,59), seconds=random.randint(0,59), milliseconds=random.randint(0,999))
            ts_str = fts(ts)
            dev = pick(cfg["devices"])
            eid_dev, room, floor, dtype = dev
            action = pick(ACTIONS)
            old_s, new_s = ("off","on") if action in ("turn_on","toggle") else ("on","off")

            # Determine use case
            r = random.random()
            if r < 0.38:
                uc, src, net = "UC1", "app", "local"
                dock_eid, dock_id = "", ""
            elif r < 0.64:
                uc, src, net = "UC2", "docklet", "local"
                dk = pick(cfg["docks"])
                dock_eid, dock_id = dk[0], dk[1]
                eid_dev = dk[2]
                for d in cfg["devices"]:
                    if d[0] == eid_dev: dev = d; room, floor, dtype = d[1], d[2], d[3]
            elif r < 0.67:
                uc, src, net = "UC3", "app", "local"
                dk = pick(cfg["docks"])
                dock_eid, dock_id = dk[0], dk[1]
                action = "bind"
            elif r < 0.83:
                uc, src, net = "UC4", "direct_thread", "thread_local"
                dk = pick(cfg["docks"])
                dock_eid, dock_id = dk[0], dk[1]
            else:
                uc, src, net = "UC5", "app_remote", "remote"
                dock_eid, dock_id = "", ""

            # Latency profiles (ms)
            lat_profiles = {"UC1":(350,650),"UC2":(180,450),"UC3":(900,2200),"UC4":(50,160),"UC5":(600,1400)}
            lo, hi = lat_profiles[uc]
            lat = random.randint(lo, hi)

            # Success/failure
            fail_rates = {"UC1":0.015,"UC2":0.008,"UC3":0.06,"UC4":0.004,"UC5":0.04}
            success = random.random() > fail_rates[uc]
            fail_reason = "" if success else pick(FAIL_REASONS)
            if not success: lat = random.randint(5000, 9000)

            fb_ts = rts(ts, lat, lat)
            fb_str = fts(fb_ts)
            ns_pass = success and lat < 1000

            # ── Unified event log ──
            unified.append([eid, ts_str, day_str, ts.strftime("%H:%M:%S"), hour, dow, is_wknd,
                           uc, src, eid_dev, room, floor, dtype, action, old_s, new_s,
                           ts_str, fb_str, lat, success, fail_reason, net, dock_eid, dock_id, ns_pass])

            # ── App logs (UC1, UC3, UC5) ──
            if src in ("app","app_remote"):
                tap_ts = ts
                cmd_ts = rts(ts, 30, 80)
                rest_ts = rts(cmd_ts, 60, 200)
                ws_ts = fb_ts
                app_logs.append(["flutter_app", eid, ts_str, day_str, ts.strftime("%H:%M:%S"), hour, dow,
                                uc, eid_dev, action, room, floor, dtype, net,
                                fts(tap_ts), fts(cmd_ts), fts(rest_ts), fts(ws_ts),
                                lat, success, fail_reason, "tile_tap", "room_view", "deviceStateProvider",
                                dock_eid, dock_id])

            # ── HA logs (all events) ──
            ctx_user = "null" if uc == "UC4" else f"user_{hub_id}"
            origin = "REMOTE" if uc == "UC5" else "LOCAL"
            dock_ts = fts(ts) if uc == "UC2" else ""
            matter_ts = fts(rts(ts, 30, 120))
            snap_ts = fb_str
            ha_lat = lat
            ha_logs.append(["home_assistant", eid, ts_str, day_str, ts.strftime("%H:%M:%S"), hour, dow,
                           uc, "state_changed", eid_dev, old_s, new_s, action, room, floor, dtype,
                           uid()[:16], ctx_user, origin, dock_ts, matter_ts, snap_ts,
                           ha_lat, success, fail_reason, dock_eid, dock_id, net, f"node_{random.randint(1,12):02d}"])

            # ── Failure log ──
            if not success:
                failures.append([eid, ts_str, day_str, ts.strftime("%H:%M:%S"), uc, src, eid_dev, room,
                                action, fail_reason, "N/A" if fail_reason != "TIMEOUT" else lat, net, dock_eid, dock_id])

            # ── Aggregate stats ──
            ds = daily_stats[day_str]
            ds["total"] += 1
            if success: ds["success"] += 1
            else: ds["fail"] += 1
            if src == "app": ds["app"] += 1
            elif src == "docklet": ds["dock"] += 1
            elif src == "direct_thread": ds["direct"] += 1
            elif src == "app_remote": ds["remote"] += 1
            if action == "activate" or uc == "UC4": ds["scene"] += 1
            ds[uc.lower()] += 1
            if success: ds[uc.lower() + "_s"] = ds.get(uc.lower() + "_s", 0) + 1
            if success: ds["lats"].append(lat); ds["under1s"] += (1 if lat < 1000 else 0)

            hk = (dow, hour)
            hourly[hk] = hourly.get(hk, 0) + 1

            if eid_dev in dev_stats:
                dv = dev_stats[eid_dev]
                dv["total"] += 1
                if src == "app" or src == "app_remote": dv["app"] += 1
                elif src == "docklet": dv["dock"] += 1
                elif src == "direct_thread": dv["direct"] += 1
                if success: dv["succ"] += 1
                if success: dv["lats"].append(lat)

    # ── Write unified_event_log.csv ──
    with open(os.path.join(hub_dir, "unified_event_log.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["event_id","timestamp","date","time","hour","day_of_week","is_weekend",
                    "use_case","source","entity_id","room","floor","device_type","action",
                    "old_state","new_state","trigger_timestamp","feedback_timestamp","latency_ms",
                    "success","failure_reason","network_type","docklet_id","dock_id","north_star_pass"])
        w.writerows(unified)

    # ── Write app_logs.csv ──
    with open(os.path.join(hub_dir, "app_logs.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["log_source","event_id","timestamp","date","time","hour","day_of_week",
                    "use_case","entity_id","action","room","floor","device_type","network_type",
                    "tap_timestamp","command_sent_timestamp","rest_response_timestamp",
                    "ws_confirmation_timestamp","end_to_end_latency_ms","success","failure_reason",
                    "trigger_method","app_screen","riverpod_provider","docklet_id","dock_id"])
        w.writerows(app_logs)

    # ── Write ha_logs.csv ──
    with open(os.path.join(hub_dir, "ha_logs.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["log_source","event_id","timestamp","date","time","hour","day_of_week",
                    "use_case","ha_event_type","entity_id","old_state","new_state","action",
                    "room","floor","device_type","context_id","context_user_id","origin",
                    "docklet_state_change_ts","matter_command_ts","snap_state_change_ts",
                    "ha_processing_latency_ms","success","failure_reason","docklet_id","dock_id",
                    "network_type","thread_node_id"])
        w.writerows(ha_logs)

    # ── Write daily_summary.csv ──
    with open(os.path.join(hub_dir, "daily_summary.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["date","day_of_week","is_weekend","total_events","successful_events","failed_events",
                    "overall_reliability_pct","app_events","docklet_events","direct_thread_events",
                    "remote_events","scene_events","uc1_count","uc2_count","uc3_count","uc4_count","uc5_count",
                    "uc1_reliability_pct","uc2_reliability_pct","uc4_reliability_pct","uc5_reliability_pct",
                    "avg_latency_ms","p50_latency_ms","p95_latency_ms","max_latency_ms","min_latency_ms",
                    "under_1s_count","north_star_pct"])
        for d in DAYS:
            s = daily_stats[d]
            dt = datetime.strptime(d, "%Y-%m-%d")
            dow = DOW[dt.weekday()]
            iw = dow in ("Saturday","Sunday")
            lats = sorted(s["lats"]) if s["lats"] else [0]
            n = len(lats)
            rel = round(s["success"]/s["total"]*100,2) if s["total"] else 0
            uc1r = round(s["uc1_s"]/s["uc1"]*100,2) if s["uc1"] else 0
            uc2r = round(s["uc2_s"]/s["uc2"]*100,2) if s["uc2"] else 0
            uc4r = round(s["uc4_s"]/s["uc4"]*100,2) if s["uc4"] else 0
            uc5r = round(s["uc5_s"]/s["uc5"]*100,2) if s["uc5"] else 0
            ns = round(s["under1s"]/n*100,2) if n else 0
            w.writerow([d, dow, iw, s["total"], s["success"], s["fail"], rel,
                       s["app"], s["dock"], s["direct"], s["remote"], s["scene"],
                       s["uc1"], s["uc2"], s["uc3"], s["uc4"], s["uc5"],
                       uc1r, uc2r, uc4r, uc5r,
                       round(sum(lats)/n) if n else 0, lats[n//2], lats[int(n*0.95)] if n>1 else lats[0],
                       max(lats), min(lats), s["under1s"], ns])

    # ── Write hourly_heatmap.csv ──
    with open(os.path.join(hub_dir, "hourly_heatmap.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["day_of_week","hour","hour_label","event_count","is_weekend"])
        for dow_name in DOW:
            for h in range(24):
                cnt = hourly.get((dow_name, h), 0)
                iw = dow_name in ("Saturday","Sunday")
                w.writerow([dow_name, h, f"{h:02d}:00", cnt, iw])

    # ── Write device_summary.csv ──
    with open(os.path.join(hub_dir, "device_summary.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["entity_id","room","floor","device_type","total_toggles","app_toggles",
                    "docklet_toggles","direct_toggles","reliability_pct","avg_latency_ms",
                    "p50_latency_ms","p95_latency_ms"])
        for dev in cfg["devices"]:
            eid = dev[0]
            ds = dev_stats[eid]
            lats = sorted(ds["lats"]) if ds["lats"] else [0]
            n = len(lats)
            rel = round(ds["succ"]/ds["total"]*100,2) if ds["total"] else 0
            w.writerow([eid, dev[1], dev[2], dev[3], ds["total"], ds["app"], ds["dock"], ds["direct"],
                       rel, round(sum(lats)/n) if n else 0, lats[n//2], lats[int(n*0.95)] if n>1 else lats[0]])

    # ── Write failure_log.csv ──
    with open(os.path.join(hub_dir, "failure_log.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["event_id","timestamp","date","time","use_case","source","entity_id","room",
                    "action","failure_reason","latency_ms","network_type","docklet_id","dock_id"])
        w.writerows(failures)

    # ── Write device_registry.csv ──
    with open(os.path.join(hub_dir, "device_registry.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["entity_id","room","floor","type","name","dock_id","bound_to"])
        for dev in cfg["devices"]:
            bound = ""
            for dk in cfg["docks"]:
                if dk[2] == dev[0]: bound = dk[0]
            dock = ""
            for dk in cfg["docks"]:
                if dk[2] == dev[0]: dock = dk[1]
            name = dev[0].split(".")[-1].replace("_"," ").title()
            w.writerow([dev[0], dev[1], dev[2], dev[3], name, dock, bound])

    # ── Write scene_registry.csv ──
    with open(os.path.join(hub_dir, "scene_registry.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["scene_id","name","device_count"])
        for sc in cfg["scenes"]:
            w.writerow(sc)

    # ── Write dock_offline_logs.csv (derived from actual dock events for consistency) ──
    # Map docklet entities to dock hardware IDs: split docklets evenly across dock_ids
    docklet_to_hw = {}
    docklets = [dk[0] for dk in cfg["docks"]]
    for i, dkl in enumerate(docklets):
        docklet_to_hw[dkl] = cfg["dock_ids"][i % len(cfg["dock_ids"])]

    # Collect dock events from unified (UC2 = docklet source)
    dock_events_by_hw = defaultdict(lambda: defaultdict(lambda: {"total":0,"success":0,"fail":0,"resp_sum":0.0}))
    for row in unified:
        if row[7] == "UC2":  # use_case index
            docklet_id = row[22]  # docklet_id index
            hw_id = docklet_to_hw.get(docklet_id, cfg["dock_ids"][0])
            action = row[13]  # action index
            # Map actions to dock event types
            ev_type = "toggle" if action in ("toggle","turn_on","turn_off") else "increment"
            success = row[19]  # success index
            lat = int(row[18]) if row[18] else 0  # latency_ms index
            dock_events_by_hw[hw_id][ev_type]["total"] += 1
            if success: dock_events_by_hw[hw_id][ev_type]["success"] += 1
            else: dock_events_by_hw[hw_id][ev_type]["fail"] += 1
            dock_events_by_hw[hw_id][ev_type]["resp_sum"] += random.uniform(0.008, 0.045)

    # Add ~5-8% extra events that dock processed but didn't reach hub (transit loss)
    for hw_id in cfg["dock_ids"]:
        for ev_type in ["toggle","increment","decrement"]:
            existing = dock_events_by_hw[hw_id][ev_type]["total"]
            extra = max(1, int(existing * random.uniform(0.05, 0.08))) if existing > 0 else random.randint(2, 8)
            extra_fail = random.randint(0, max(1, int(extra * 0.03)))
            dock_events_by_hw[hw_id][ev_type]["total"] += extra
            dock_events_by_hw[hw_id][ev_type]["success"] += (extra - extra_fail)
            dock_events_by_hw[hw_id][ev_type]["fail"] += extra_fail
            dock_events_by_hw[hw_id][ev_type]["resp_sum"] += extra * random.uniform(0.01, 0.04)

    # Write aggregated dock_offline rows
    dock_rows = []
    for hw_id in sorted(cfg["dock_ids"]):
        for ev_type in ["toggle","increment","decrement"]:
            d = dock_events_by_hw[hw_id][ev_type]
            if d["total"] > 0:
                avg_resp = round(d["resp_sum"] / d["total"], 3)
                dock_rows.append(["", hw_id, ev_type, d["total"], d["success"], d["fail"], avg_resp])

    with open(os.path.join(hub_dir, "dock_offline_logs.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["timestamp","dock_id","event","total_event_count","success_count",
                     "failure_count","avg_response_duration"])
        w.writerows(dock_rows)

    total_events = len(unified)
    total_failures = len(failures)
    dock_total = sum(r[3] for r in dock_rows)
    print(f"  ✅ {hub_id}/ → {total_events} events, {total_failures} failures, dock_offline: {dock_total} events ({len(dock_rows)} rows)")

if __name__ == "__main__":
    print("Generating per-hub log folders...\n")
    # Clean old dock_offline_logs.csv from root
    old = os.path.join(OUT, "dock_offline_logs.csv")
    if os.path.exists(old): os.remove(old); print("  Removed old dock_offline_logs.csv")

    for hub_id, cfg in HUBS.items():
        gen_hub_data(hub_id, cfg)

    print(f"\nDone! All hub folders in: {OUT}")
