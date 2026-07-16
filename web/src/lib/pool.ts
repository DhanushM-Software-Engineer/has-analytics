/**
 * Event pool — THE reconciliation core, ported 1:1 from dashboard_app.js.
 *
 * Built from the COMPLETE authoritative lists returned by the backend, so Log
 * Center counts reconcile exactly with the summary cards:
 *   all_events          → every genuine app-triggered command (app_logs)
 *   dock_events         → dock device-side activations (ha_logs — reliable)
 *   hub_observed_events → scene activations & automation runs (ha_logs)
 *   hub_ha_ui_events    → direct hub control (actuation_source 'ha:*')
 * App-observed "Observed Change (App)" is intentionally NOT included.
 */
import type { HubDetail } from '../types/api';
import { tsMs } from './format';

export type EventStatus = 'ok' | 'warn' | 'slow' | 'fail';
export type SegType = 'local_e2e' | 'remote_e2e' | 'dock' | 'hub_observed' | 'hub_ha_ui' | 'hub_snap';

export interface PoolEvent {
  hub: string;
  ts: string;
  uc: string;
  dev: string;
  room: string;
  src: string;
  lat: number | string | null;
  reason: string | null;
  net: string;
  dock: string;
  action?: string;
  status: EventStatus;
  segType: SegType;
  hasTiming: boolean;
  tap?: string | null;
  cmd_sent?: string | null;
  rest_resp?: string | null;
  ws_conf?: string | null;
  hub_app_lat?: number | null;
  matter_ts?: string | null;
  snap_ts?: string | null;
}

// Memoized per HubDetail object — pool building walks up to 20k events.
const poolCache = new WeakMap<HubDetail, PoolEvent[]>();

export function buildEventPool(hub: string, d: HubDetail): PoolEvent[] {
  const cached = poolCache.get(d);
  if (cached) return cached;
  const events: PoolEvent[] = [];

  (d.all_events || []).forEach((e) => {
    const lat = typeof e.lat === 'number' ? e.lat : parseFloat(String(e.lat));
    const hasLat = !isNaN(lat);
    const t1 = tsMs(e.rest_resp), t2 = tsMs(e.ws_conf);
    const hubAppLat = t1 && t2 && t2 >= t1 ? t2 - t1 : null;
    const status: EventStatus =
      e.success === false ? 'fail' : hasLat && lat > 1000 ? 'slow' : hasLat && lat > 800 ? 'warn' : 'ok';
    events.push({
      hub, ts: e.ts, uc: e.uc || '—', dev: e.dev || '—', room: e.room || '—',
      src: e.src || 'app', lat: e.lat, reason: e.reason || null, net: e.net || '—', dock: '—',
      status, segType: e.uc === 'Remote App Control' ? 'remote_e2e' : 'local_e2e',
      hasTiming: !!(e.rest_resp && e.ws_conf),
      tap: e.tap, cmd_sent: e.cmd_sent, rest_resp: e.rest_resp, ws_conf: e.ws_conf,
      hub_app_lat: hubAppLat,
    });
  });

  // Dock presses (ha_logs) — a press FAILS if its bound device didn't reach on/off
  (d.dock_events || []).forEach((e) => {
    const failed = e.success === false;
    events.push({
      hub, ts: e.ts, uc: 'Dock Control',
      dev: e.dev || e.docklet_id || '—', room: e.room || '—', src: 'docklet', lat: null,
      reason: failed ? 'DEVICE_UNAVAILABLE' : null, net: 'dock', dock: e.dock_id || '—',
      action: e.action || '', status: failed ? 'fail' : 'ok', segType: 'dock', hasTiming: false,
    });
  });

  // Hub-recorded scene activations & automation runs (ha_logs — reliable source)
  (d.hub_observed_events || []).forEach((e) =>
    events.push({
      hub, ts: e.ts, uc: e.uc || 'Hub Event',
      dev: e.dev || '—', room: e.room || '—', src: 'direct_hub', lat: null,
      reason: null, net: 'hub', dock: '—', status: 'ok', segType: 'hub_observed', hasTiming: false,
    }),
  );

  // Direct hub control (actuation_source 'ha:*') — part of the "Hub" source.
  (d.hub_ha_ui_events || []).forEach((e) =>
    events.push({
      hub, ts: e.ts, uc: 'Hub Control',
      dev: e.dev || '—', room: e.room || '—', src: 'direct_hub_ui', lat: null,
      action: e.action || '', reason: null, net: 'hub', dock: '—',
      status: e.success === false ? 'fail' : 'ok', segType: 'hub_ha_ui', hasTiming: false,
    }),
  );

  events.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
  poolCache.set(d, events);
  return events;
}

export type SrcClass = 'app' | 'remote' | 'dock' | 'hub';

export function eventSrcClass(e: PoolEvent): SrcClass {
  const s = (e.src || '').toLowerCase();
  if (s.includes('docklet')) return 'dock';
  if (s.includes('remote')) return 'remote';
  if (s.includes('direct_hub') || e.segType === 'hub_observed') return 'hub';
  return 'app';
}

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function evDow(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const d = new Date(ts.slice(0, 10) + 'T00:00:00Z');
  return isNaN(d.getTime()) ? null : DOW[d.getUTCDay()] ?? null;
}

export function evHour(ts: string | null | undefined): number {
  if (!ts || ts.length < 13) return -1;
  const h = parseInt(ts.slice(11, 13));
  return isNaN(h) ? -1 : h;
}

/** UC / source display name → predicate over pool events (Log Center + drill-downs). */
export function srcPred(key: string): (e: PoolEvent) => boolean {
  const k = (key || '').toLowerCase();
  if (k.includes('dock')) return (e) => (e.src || '').toLowerCase().includes('docklet');
  if (k.includes('remote'))
    return (e) => {
      const s = (e.src || '').toLowerCase();
      return s.includes('app_remote') || s.includes('remote_app') || s === 'remote';
    };
  // Hub = everything the hub itself originated: direct hub control + scenes + automations
  if (k.includes('hub') || k.includes('auto') || k.includes('scene') || k.includes('observ'))
    return (e) => (e.src || '').toLowerCase().includes('direct');
  // App Control: src='app' only (not app_remote)
  return (e) => (e.src || '').toLowerCase() === 'app';
}

/** All-source failures — from the complete pool, never the app-only sample. */
export function failuresFor(hub: string, d: HubDetail, pred: (e: PoolEvent) => boolean): PoolEvent[] {
  return buildEventPool(hub, d).filter((e) => e.status === 'fail').filter(pred);
}

export interface DailyAgg {
  date: string;
  total: number;
  fail: number;
  app: number;
  dock: number;
  hub: number;
  failApp: number;
  failDock: number;
  failHub: number;
  rel: number;
  p50: number | null;
  p95: number | null;
  ns: number | null;
  avg: number | null;
  sd: number | null;
}

/** All-source per-day series (matches Total Events + heatmap); latency merged
 *  from the app-command daily rollup (only app has latency). */
export function allSourceDaily(hub: string, d: HubDetail): DailyAgg[] {
  const pool = buildEventPool(hub, d);
  const m: Record<string, { total: number; fail: number; app: number; dock: number; hub: number; failApp: number; failDock: number; failHub: number }> = {};
  pool.forEach((e) => {
    const day = (e.ts || '').slice(0, 10);
    if (!day) return;
    const o = m[day] || (m[day] = { total: 0, fail: 0, app: 0, dock: 0, hub: 0, failApp: 0, failDock: 0, failHub: 0 });
    o.total++;
    const src = eventSrcClass(e);
    if (src === 'app' || src === 'remote') o.app++;
    else if (src === 'dock') o.dock++;
    else o.hub++;
    if (e.status === 'fail') {
      o.fail++;
      if (src === 'app' || src === 'remote') o.failApp++;
      else if (src === 'dock') o.failDock++;
      else o.failHub++;
    }
  });
  const appByDate: Record<string, HubDetail['daily'][number]> = {};
  (d.daily || []).forEach((r) => { appByDate[r.date] = r; });
  return Object.keys(m).sort().map((date) => {
    const o = m[date]!;
    const a = appByDate[date];
    return {
      date, total: o.total, fail: o.fail,
      app: o.app, dock: o.dock, hub: o.hub,
      failApp: o.failApp, failDock: o.failDock, failHub: o.failHub,
      rel: o.total ? +((100 * (o.total - o.fail)) / o.total).toFixed(2) : 0,
      p50: a?.p50 ?? null, p95: a?.p95 ?? null, ns: a?.ns ?? null, avg: a?.avg ?? null, sd: a?.sd ?? null,
    };
  });
}
