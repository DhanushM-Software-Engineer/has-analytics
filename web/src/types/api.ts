/**
 * TypeScript contract for the Schnell Fleet Analytics API.
 *
 * Derived from REAL captured responses (analytics-api/tests/golden/), not from
 * reading the backend code — these types ARE the frozen behavior contract.
 * If the backend legitimately evolves, re-capture the golden fixtures and
 * update these types in the same change.
 *
 * Endpoints:
 *   GET /api/hubs                                   → HubsResponse
 *   GET /api/hub/{hub_id}?from_date=&to_date=       → HubDetail
 *
 * Conventions observed in the data:
 *   - All timestamps are ISO-8601 strings (app_logs naive, ha_logs +05:30).
 *   - Numeric aggregates that can be absent for a window are `null`, never 0.
 *   - The all-source invariant always holds:
 *       total_activity === activity_success + activity_fail
 */

// ── /api/hubs ────────────────────────────────────────────────────────────────

export interface HubsResponse {
  hubs: string[];
}

// ── Event rows ───────────────────────────────────────────────────────────────

/** Complete app-triggered command list (app_logs) — Log Center source of truth. */
export interface AppEvent {
  ts: string;
  dev: string;
  friendly_name: string | null;
  uc: string;                       // use_case label
  lat: number | null;               // latency_ms
  room: string | null;
  net: string | null;               // network_type
  src: string;                      // 'app' | 'app_remote' | 'docklet' | ...
  success: boolean;
  reason: string | null;            // failure_reason
  tap: string | null;
  cmd_sent: string | null;
  rest_resp: string | null;
  ws_conf: string | null;
}

/** Dock press events (ha_logs, context_id-joined outcome). */
export interface DockEvent {
  ts: string;
  dev: string;
  friendly_name: string | null;
  dock_id: string;
  docklet_id: string;
  action: string;
  room: string | null;
  success: boolean;
}

/** Hub-recorded scene activations & automation runs (ha_logs). */
export interface HubObservedEvent {
  ts: string;
  dev: string;
  friendly_name: string | null;
  /** 'Scene Activated (Hub)' | 'Automation Run (Hub)' */
  uc: string;
  room: string | null;
  /** always 'direct_hub' */
  src: string;
}

/** Direct hub control (actuation_source 'ha:*') — confirmed actuations. */
export interface HubDirectEvent {
  ts: string;
  dev: string;
  friendly_name: string | null;
  room: string | null;
  action: string;
  new_state: string;
  success: boolean;                 // always true (only confirmed actuations count)
  /** always 'direct_hub_ui' */
  src: string;
}

/** App failure rows (failures list). */
export interface FailureEvent {
  ts: string;
  uc: string;
  dev: string;
  friendly_name: string | null;
  reason: string;
  room: string | null;
  src: string;
  lat: string;                      // CAST AS STRING; 'N/A' when absent
  net: string | null;
  dock: string;                     // '' when not dock-bound
}

// ── Speed ────────────────────────────────────────────────────────────────────

export interface SpeedStats {
  avg: number;                      // 0 when no data (backend coalesces)
  p50: number;
  p95: number;
  stddev: number;
}

/** Hub → SNAP → Hub sample (ha_logs; gap capped at SNAP_MAX_MS=30s). */
export interface HubSnapEvent {
  ts: string;
  dev: string;
  friendly_name: string | null;
  uc: string;                       // ha_event_type
  room: string | null;
  origin: string | null;            // log_source — who triggered the round-trip
  matter_ts: string;
  snap_ts: string;
  lat: number;                      // snap_state_change_ts − matter_command_ts (ms)
}

/** Local/remote E2E sample (app_logs, latency_ms present). */
export interface E2eEvent {
  ts: string;
  dev: string;
  friendly_name: string | null;
  uc: string;
  lat: number;
  room: string | null;
  net: string | null;
  tap: string | null;
  cmd_sent: string | null;
  rest_resp: string | null;
  ws_conf: string | null;
  src: string;
  success: boolean;
  failure_reason: string | null;
}

export type LatencyBucket = '<500ms' | '500-1000ms' | '1-2s' | '2-5s' | '>5s';

export interface BucketEvent {
  ts: string;
  dev: string;
  friendly_name: string | null;
  uc: string;
  lat: number;
  src: string;
  room: string | null;
  success: boolean;
}

export interface PerUcEvent {
  ts: string;
  dev: string;
  friendly_name: string | null;
  lat: number;
  src: string;
  room: string | null;
}

export interface PerUcStats extends SpeedStats {
  count: number;
  success: number;
  buckets: Partial<Record<LatencyBucket, number>>;
  events: PerUcEvent[];
}

export interface Speed {
  hub_snap_hub: SpeedStats & { events: HubSnapEvent[] };
  local_e2e: SpeedStats & { events: E2eEvent[] };
  remote_e2e: SpeedStats & { events: E2eEvent[] };
  hub_app: SpeedStats & { events: never[] };   // stats only; samples derived client-side
  buckets: Partial<Record<LatencyBucket, number>>;
  bucket_events: Partial<Record<LatencyBucket, BucketEvent[]>>;
  per_uc: Record<string, PerUcStats>;          // keyed by use_case label
}

// ── Daily series ─────────────────────────────────────────────────────────────

/** App-command daily rollup. Latency fields are null on app-quiet days. */
export interface DailyRow {
  date: string;                     // YYYY-MM-DD
  total: number;
  rel: number;
  avg: number | null;
  sd: number | null;
  p50: number | null;
  p95: number | null;
  ns: number | null;                // % of timed commands under 1s (North Star)
}

// ── Reliability ──────────────────────────────────────────────────────────────

export interface SourceReliability {
  total: number;
  success: number;
  fail: number;
  rel: number;
}

export interface DockActionStats {
  action: string;                   // 'toggle' | 'increment' | 'decrement'
  total: number;
  success: number;
  failure: number;
  rel: number;
}

export interface DockletStats {
  docklet_id: string;
  total: number;
  success: number;
  failure: number;
  rel: number;
  actions: DockActionStats[];
}

export interface DockStats {
  dock_id: string;
  total: number;
  success: number;
  failure: number;
  rel: number;
  docklets: DockletStats[];
}

export interface ReliabilityDetail {
  app_trigger_feedback: number;
  dock_trigger_feedback: number;
  hub_to_app: number;
  app_triggers: number;
  app_feedbacks: number;
  dock_triggers: number;
  dock_feedbacks: number;
  hub_to_snap_count: number;
  /**
   * Keyed by source label. App use-cases appear under their use_case names
   * ('Local App Control', 'Device Bind (App)', ...); consolidated sources are
   * 'Dock Control' and 'Hub' (= direct hub control + automations + scenes).
   */
  src_rel: Record<string, SourceReliability>;
  dock_stats: DockStats[];
}

export interface FailReasonEntry {
  count: number;
  events: {
    ts: string;
    dev: string;
    friendly_name: string | null;
    uc: string;
    src: string;
    room: string | null;
    lat: string;                    // string-cast latency; may be 'N/A'
  }[];
}

export interface FailDeviceEntry {
  count: number;
  reasons: Record<string, number>;
}

// ── Usage ────────────────────────────────────────────────────────────────────

export interface Usage {
  app: number;                      // local app + device bind commands
  remote: number;
  docklet: number;                  // dock activations (ha_logs)
  direct: number;                   // Observed Change (App) — INTERNAL only, never shown
  app_ratio: number;                // 3-way split over App + Dock + Hub; sums to 100
  dock_ratio: number;
  hub_ratio: number;
  snap_devices: number;
  hub_scene_total: number;
  hub_scene_per_day: number;
  hub_auto_total: number;
  hub_auto_per_day: number;
  hub_direct_total: number;         // actuation_source 'ha:*' confirmed actuations
  hub_direct_success: number;       // === hub_direct_total (all confirmed)
  hub_direct_per_day: number;
  hub_total: number;                // direct + automations + scenes
  hub_per_day: number;
  /** @deprecated alias of hub_direct_total kept for older UI builds */
  direct_ha_ui_total: number;
  /** @deprecated alias of hub_direct_per_day kept for older UI builds */
  direct_ha_ui_per_day: number;
}

export interface DockUsageDaily {
  date: string;
  total: number;
  success: number;
  failure: number;
  rel: number;
}

export interface DockUsage {
  total: number;
  by_action: Record<string, number>;
  by_docklet: Record<string, number>;
  daily: DockUsageDaily[];
}

// ── Devices ──────────────────────────────────────────────────────────────────

export interface DeviceRow {
  id: string;
  room: string;
  total: number;
  success: number;
  rel: number;
  p50: number;
}

// ── /api/hub/{hub_id} ────────────────────────────────────────────────────────

export interface HubDetail {
  /** App-triggered command count (app_logs, APP_UC scope). */
  total: number;
  /** App-triggered successes. */
  success: number;
  /** App-command reliability % (per-source detail). */
  reliability: number;

  /** ALL-SOURCE headline: app + dock + scene + automation + direct hub control. */
  total_activity: number;
  activity_success: number;
  activity_fail: number;            // invariant: total_activity = success + fail
  activity_reliability: number;

  speed: Speed;
  daily: DailyRow[];
  failures: FailureEvent[];
  reliability_detail: ReliabilityDetail;
  dock_usage: DockUsage;

  /** Complete event lists — the client builds its pool from these so every
   *  summary card reconciles exactly with Log Center / heatmap drill-downs. */
  all_events: AppEvent[];
  dock_events: DockEvent[];
  hub_observed_events: HubObservedEvent[];
  hub_ha_ui_events: HubDirectEvent[];

  fail_by_reason: Record<string, FailReasonEntry>;
  fail_by_device: Record<string, FailDeviceEntry>;
  devices: DeviceRow[];
  usage: Usage;
}
