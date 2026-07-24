/** Speed tab — segment cards (with documented formulas), speed distribution,
 *  AVG & SD trend, and per-use-case cards incl. Hub Control (Direct). */
import { useMemo } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import '../../charts/setup';
import type { HubDetail, SpeedStats } from '../../types/api';
import { TARGETS } from '../../lib/constants';
import { tsMs } from '../../lib/format';
import { buildEventPool } from '../../lib/pool';
import { InfoButton, EventTable, type EvCol } from '../../components/common';
import { useDash } from '../../state/DashboardContext';

const tooltipIconCanvas = document.createElement('canvas');
tooltipIconCanvas.width = 24;
tooltipIconCanvas.height = 10;
const tooltipIconCtx = tooltipIconCanvas.getContext('2d');
if (tooltipIconCtx) {
  tooltipIconCtx.fillStyle = '#6366f1';
  tooltipIconCtx.fillRect(0, 4, 24, 2);
  tooltipIconCtx.beginPath();
  tooltipIconCtx.arc(12, 5, 3, 0, 2 * Math.PI);
  tooltipIconCtx.fill();
}

interface SegDef {
  key: 'hub_snap_hub' | 'hub_app' | 'local_e2e' | 'remote_e2e';
  name: string;
  desc: string;
  val: SpeedStats & { events?: unknown[] };
  target: { val: number; lbl: string };
  cols: EvCol[];
  derivedEvents?: Record<string, unknown>[];
}

export function SpeedTab({ hub, d }: { hub: string; d: HubDetail }) {
  const dash = useDash();
  const s = d.speed;

  // Hub→App sample rows derived from local_e2e events (ws_conf − rest_resp).
  const hubAppEvents = useMemo(() =>
    (s.local_e2e.events || [])
      .map((e) => {
        const t1 = tsMs(e.rest_resp), t2 = tsMs(e.ws_conf);
        const pushLat = t1 && t2 && t2 >= t1 ? t2 - t1 : null;
        return {
          ts: e.ts, dev: e.dev, uc: e.uc, room: e.room,
          hub_dispatched: e.rest_resp, app_confirmed: e.ws_conf,
          lat: pushLat !== null ? String(pushLat) : null,
        };
      })
      .filter((e) => e.lat !== null) as Record<string, unknown>[],
  [s]);

  const segs: SegDef[] = [
    {
      key: 'hub_snap_hub', name: 'Hub → SNAP → Hub (Automations & Scenes)',
      desc: 'Hub issues Matter cmd over Thread mesh → SNAP device activates → state reflected back to Hub.',
      val: s.hub_snap_hub, target: TARGETS.hubSnap!,
      cols: [
        { key: 'fmtDate', label: 'Date' }, { key: 'fmtTime', label: 'Time' },
        { key: 'uc', label: 'Use Case' }, { key: 'dev', label: 'Device' },
        { key: 'room', label: 'Room' }, { key: 'floor', label: 'Floor' },
        { key: 'origin', label: 'Origin' }, { key: 'matter_ts', label: 'Matter CMD Sent Time' },
        { key: 'snap_ts', label: 'State Reflected Time' }, { key: 'lat', label: 'Total Latency' },
        { key: 'status', label: 'State' },
      ],
    },
    {
      key: 'hub_app', name: 'Hub → App (WebSocket Push)',
      desc: 'Device state confirmed at Hub → Hub immediately pushes via WebSocket → App reflects new state.',
      val: s.hub_app, target: TARGETS.hubApp!, derivedEvents: hubAppEvents,
      cols: [
        { key: 'fmtDate', label: 'Date' }, { key: 'fmtTime', label: 'Time' },
        { key: 'dev', label: 'Device' }, { key: 'room', label: 'Room' }, { key: 'floor', label: 'Floor' },
        { key: 'hub_dispatched', label: 'State Confirmed at Hub' },
        { key: 'app_confirmed', label: 'App Received' }, { key: 'lat', label: 'Push Latency' },
        { key: 'status', label: 'State' },
      ],
    },
    {
      key: 'local_e2e', name: 'App Control (Local)',
      desc: 'Full round-trip on local Wi-Fi: App sends cmd → Hub receives → SNAP device activates → state pushed back to App via WebSocket',
      val: s.local_e2e, target: TARGETS.localE2e!,
      cols: [
        { key: 'fmtDate', label: 'Date' }, { key: 'fmtTime', label: 'Time' },
        { key: 'uc', label: 'Use Case' }, { key: 'dev', label: 'Device' },
        { key: 'room', label: 'Room' }, { key: 'floor', label: 'Floor' },
        { key: 'cmd_sent', label: 'CMD Sent' }, { key: 'rest_resp', label: "Hub ACK'd" },
        { key: 'ws_conf', label: 'App Updated' }, { key: 'lat', label: 'Total Latency' },
        { key: 'status', label: 'State' },
      ],
    },
    {
      key: 'remote_e2e', name: 'App Control (Remote)',
      desc: 'Full round-trip via Internet: App sends cmd remotely → Hub receives → SNAP device activates → state pushed back to App via WebSocket',
      val: s.remote_e2e, target: TARGETS.remoteE2e!,
      cols: [
        { key: 'fmtDate', label: 'Date' }, { key: 'fmtTime', label: 'Time' },
        { key: 'uc', label: 'Use Case' }, { key: 'dev', label: 'Device' },
        { key: 'room', label: 'Room' }, { key: 'floor', label: 'Floor' },
        { key: 'cmd_sent', label: 'CMD Sent' }, { key: 'rest_resp', label: "Hub ACK'd" },
        { key: 'ws_conf', label: 'App Updated' }, { key: 'lat', label: 'Total Latency' },
        { key: 'status', label: 'State' },
      ],
    },
  ];

  const openSegModal = (sg: SegDef) => {
    const segF = sg.key === 'hub_snap_hub' ? 'hub_snap' : sg.key === 'hub_app' ? 'hub_app' : sg.key;
    
    let rawEvents: any[] = [];
    try {
      const pool = buildEventPool(hub, d);
      if (segF === 'hub_app') {
        rawEvents = pool.filter(e => e.hub_app_lat != null).map(e => ({
          ...e,
          hub_dispatched: e.rest_resp, app_confirmed: e.ws_conf,
          lat: e.hub_app_lat !== null ? String(e.hub_app_lat) : null,
        }));
      } else if (segF === 'hub_snap') {
        rawEvents = pool.filter(e => (e.segType as string) === 'hub_snap_hub');
      } else {
        rawEvents = pool.filter(e => e.segType === segF);
      }
    } catch (e) {}
    
    const realCount = rawEvents.length;

    const lcOpts = {
      hub, tab: 'all' as const, segFilter: segF,
      context: { label: `SPEED SEGMENTS: ${sg.name}, EVENTS: ${realCount}` },
    };

    const rows = rawEvents.slice(0, 20).map((e: any) => {
      let fmtDate = '—', fmtTime = '—';
      if (e.ts) {
        const t = new Date(e.ts);
        if (!isNaN(t.getTime())) {
          const y = t.getFullYear().toString().substring(2);
          const m = (t.getMonth() + 1).toString().padStart(2, '0');
          const d_ = t.getDate().toString().padStart(2, '0');
          fmtDate = `${d_}-${m}-${y}`;
          fmtTime = t.toTimeString().split(' ')[0] || '—';
        }
      }
      
      let s = e.status?.toLowerCase();
      if (!s) {
        if (e.success === false || e.reason || e.failed_reason) s = 'fail';
        else if (e.lat > sg.target.val) s = 'slow';
        else s = 'ok';
      }
      
      let statusTag = <span className="tag">{e.status?.toUpperCase() || 'OK'}</span>;
      if (s === 'ok') statusTag = <span className="tag tag-green">OK</span>;
      if (s === 'fail' || s === 'failed') statusTag = <span className="tag tag-red">FAILED</span>;
      if (s === 'slow' || s === 'warn') statusTag = <span className="tag tag-yellow">SLOW</span>;

      const formatTime = (tsStr: string) => {
        if (!tsStr) return '—';
        const t = new Date(tsStr);
        return isNaN(t.getTime()) ? tsStr : t.toTimeString().split(' ')[0];
      };

      return { 
        ...e, 
        fmtDate, fmtTime, status: statusTag,
        matter_ts: e.matter_ts ? formatTime(e.matter_ts as string) : undefined,
        snap_ts: e.snap_ts ? formatTime(e.snap_ts as string) : undefined,
        cmd_sent: e.cmd_sent ? formatTime(e.cmd_sent as string) : undefined,
        rest_resp: e.rest_resp ? formatTime(e.rest_resp as string) : undefined,
        ws_conf: e.ws_conf ? formatTime(e.ws_conf as string) : undefined,
        hub_dispatched: e.hub_dispatched ? formatTime(e.hub_dispatched as string) : undefined,
        app_confirmed: e.app_confirmed ? formatTime(e.app_confirmed as string) : undefined
      };
    });

    const customTitle = (
      <div style={{ textAlign: 'left', lineHeight: 1.2 }}>
        <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '1px', marginBottom: 8, fontWeight: 400 }}>LOG VIEW</div>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.3px', marginBottom: 8 }}>{sg.name.toUpperCase()}</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400 }}>{sg.desc}</div>
      </div>
    );

    const MetricCard = ({ label, val, color }: any) => (
      <div style={{ flex: 1, position: 'relative', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fafafa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>{label}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: color || '#fafafa', lineHeight: 1 }}>{val}</div>
          </div>
        </div>
      </div>
    );

    const customBody = (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 16, width: '100%', marginBottom: 24, flexWrap: 'wrap' }}>
          <MetricCard label="Total Events" val={rawEvents.length.toLocaleString()} color="#fafafa" />
          <MetricCard label="P50 Latency" val={`${sg.val.p50}ms`} color={sg.val.p50 > sg.target.val ? 'var(--yellow)' : '#fafafa'} />
          <MetricCard label="P95 Latency" val={`${sg.val.p95}ms`} color={sg.val.p95 > sg.target.val ? 'var(--red)' : '#fafafa'} />
          <MetricCard label="Avg Latency" val={`${Math.round(sg.val.avg)}ms`} color="#fafafa" />
          <MetricCard label="Std Dev" val={`${Math.round(sg.val.stddev)}ms`} color="#fafafa" />
        </div>
        <hr style={{ width: '100%', border: 0, borderTop: '1px solid var(--border)', margin: '0 0 20px 0' }} />
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px', width: '100%', textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>LOGS</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Sampled {Math.min(20, rawEvents.length)} logs</div>
            </div>
            <button className="card-btn-view" style={{ padding: '6px 14px', fontSize: 11 }} onClick={() => dash.openLogCenter(lcOpts)}>VIEW</button>
          </div>
          <EventTable events={rows} cols={sg.cols} />
        </div>
      </div>
    );

    dash.showModal(customTitle, customBody);
  };

  // ── Speed distribution buckets ────────────────────────────────────────────
  const bucketKeys = Object.keys(s.buckets) as (keyof typeof s.buckets)[];
  const bucketColors = ['#10b981', '#f59e0b', '#f97316', '#ef4444', '#be123c'];

  const openBucketModal = (k: string) => {
    const evs = (s.bucket_events as Record<string, Record<string, unknown>[]>)[k] || [];
    const cnt = (s.buckets as Record<string, number>)[k] || 0;
    const parseBucket = (bucket: string) => {
      const isSec = bucket.endsWith('s') && !bucket.endsWith('ms');
      const mult = isSec ? 1000 : 1;
      if (bucket.startsWith('<')) return { latMin: 0, latMax: parseInt(bucket.slice(1)) * mult };
      if (bucket.startsWith('>')) return { latMin: parseInt(bucket.slice(1)) * mult, latMax: null };
      const [a, b] = bucket.split('-').map((x) => parseInt(x));
      return { latMin: (a ?? 0) * mult, latMax: b !== undefined && !isNaN(b) ? b * mult : null };
    };
    
    const rows = evs.slice(0, 20).map((e: any) => {
      let fmtDate = '—', fmtTime = '—';
      if (e.ts) {
        const t = new Date(e.ts);
        if (!isNaN(t.getTime())) {
          const y = t.getFullYear().toString().substring(2);
          const m = (t.getMonth() + 1).toString().padStart(2, '0');
          const d = t.getDate().toString().padStart(2, '0');
          fmtDate = `${d}-${m}-${y}`;
          fmtTime = t.toTimeString().split(' ')[0] || '—';
        }
      }
      
      let s = e.status?.toLowerCase();
      if (!s) {
        if (e.success === false || e.reason || e.failed_reason) s = 'fail';
        else if (e.lat > 1000) s = 'slow';
        else s = 'ok';
      }
      
      let statusTag = <span className="tag">{e.status?.toUpperCase() || 'OK'}</span>;
      if (s === 'ok') statusTag = <span className="tag tag-green">OK</span>;
      if (s === 'fail' || s === 'failed') statusTag = <span className="tag tag-red">FAILED</span>;
      if (s === 'slow' || s === 'warn') statusTag = <span className="tag tag-yellow">SLOW</span>;

      return { ...e, fmtDate, fmtTime, status: statusTag };
    });

    const customTitle = (
      <div style={{ textAlign: 'left', lineHeight: 1.2 }}>
        <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '1px', marginBottom: 8, fontWeight: 400 }}>LOG VIEW</div>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.3px', marginBottom: 8 }}>LATENCY DISTRIBUTION</div>
      </div>
    );

    const MetricCard = ({ label, val, color }: any) => (
      <div style={{ flex: 1, position: 'relative', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fafafa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>{label}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: color || '#fafafa', lineHeight: 1 }}>{val}</div>
          </div>
        </div>
      </div>
    );

    const onLc = () => {
      const f = parseBucket(k);
      dash.openLogCenter({ hub, tab: 'all', ...f, context: { label: `SPEED DISTRIBUTION -> LATENCY: ${k}, EVENTS: ${cnt}` } });
    };

    const customBody = (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 16, width: '100%', marginBottom: 24, flexWrap: 'wrap' }}>
          <MetricCard label="Latency Range" val={/[a-zA-Z]/.test(k) ? k : `${k}ms`} color="#fafafa" />
          <MetricCard label="Total Events" val={cnt.toLocaleString()} color="#fafafa" />
        </div>
        <hr style={{ width: '100%', border: 0, borderTop: '1px solid var(--border)', margin: '0 0 20px 0' }} />
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px', width: '100%', textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>LOGS</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Sampled {Math.min(20, evs.length)} logs</div>
            </div>
            <button className="card-btn-view" style={{ padding: '6px 14px', fontSize: 11 }} onClick={onLc}>VIEW</button>
          </div>
          {rows.length
            ? <EventTable events={rows} cols={[
                { key: 'fmtDate', label: 'Date' },
                { key: 'fmtTime', label: 'Time' },
                { key: 'uc', label: 'Use Case' },
                { key: 'dev', label: 'Device' },
                { key: 'room', label: 'Room' },
                { key: 'floor', label: 'Floor' },
                { key: 'lat', label: 'Latency' },
                { key: 'status', label: 'Status' }
              ]} />
            : <div className="dbg-empty">No events found in sample.</div>}
        </div>
      </div>
    );

    dash.showModal(customTitle, customBody);
  };

  // ── Cumulative Distribution Function (CDF) ────────────────────────────────
  const cdfLatencies = useMemo(() => {
    return d.all_events
      .map((e) => e.lat)
      .filter((l): l is number => l !== null && l > 0)
      .sort((a, b) => a - b);
  }, [d.all_events]);

  const cdfPoints = useMemo(() => {
    if (!cdfLatencies.length) return { labels: [], data: [] };
    const percentiles = Array.from({ length: 100 }, (_, i) => i + 1);
    const data = percentiles.map((p) => {
      const idx = Math.floor((p / 100) * (cdfLatencies.length - 1));
      return cdfLatencies[idx] || 0;
    });
    return { labels: percentiles, data };
  }, [cdfLatencies]);

  const openCdfModal = (idx: number) => {
    const p = cdfPoints.labels[idx];
    const currLat = cdfPoints.data[idx];
    const prevLat = (idx === 0 ? 0 : cdfPoints.data[idx - 1]) || 0;

    if (p == null || currLat == null) return;

    const bandEvents = d.all_events.filter((e) => e.lat != null && e.lat > prevLat && e.lat <= currLat);

    const rows = bandEvents.slice(0, 20).map((e: any) => {
      let fmtDate = '—', fmtTime = '—';
      if (e.ts) {
        const t = new Date(e.ts);
        if (!isNaN(t.getTime())) {
          const y = t.getFullYear().toString().substring(2);
          const m = (t.getMonth() + 1).toString().padStart(2, '0');
          const d = t.getDate().toString().padStart(2, '0');
          fmtDate = `${d}-${m}-${y}`;
          fmtTime = t.toTimeString().split(' ')[0] || '—';
        }
      }
      
      let s = e.status?.toLowerCase();
      if (!s) {
        if (e.success === false || e.reason || e.failed_reason) s = 'fail';
        else if (e.lat > 1000) s = 'slow';
        else s = 'ok';
      }
      
      let statusTag = <span className="tag">{e.status?.toUpperCase() || 'OK'}</span>;
      if (s === 'ok') statusTag = <span className="tag tag-green">OK</span>;
      if (s === 'fail' || s === 'failed') statusTag = <span className="tag tag-red">FAILED</span>;
      if (s === 'slow' || s === 'warn') statusTag = <span className="tag tag-yellow">SLOW</span>;

      return { ...e, fmtDate, fmtTime, status: statusTag };
    });

    const customTitle = (
      <div style={{ textAlign: 'left', lineHeight: 1.2 }}>
        <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '1px', marginBottom: 8, fontWeight: 400 }}>LOG VIEW</div>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.3px', marginBottom: 8 }}>CUMULATIVE DISTRIBUTION FUNCTION</div>
      </div>
    );

    const MetricCard = ({ label, val, color }: any) => (
      <div style={{ flex: 1, position: 'relative', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fafafa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>{label}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: color || '#fafafa', lineHeight: 1 }}>{val}</div>
          </div>
        </div>
      </div>
    );

    const onLc = () => {
      dash.openLogCenter({ hub, tab: 'all', latMin: Math.floor(prevLat), latMax: Math.ceil(currLat), context: { label: `CDF -> PERCENTILE: P${p}, LATENCY: ${Math.round(prevLat)}ms - ${Math.round(currLat)}ms, EVENTS: ${bandEvents.length}` } });
    };

    const customBody = (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 16, width: '100%', marginBottom: 24, flexWrap: 'wrap' }}>
          <MetricCard label="Percentile" val={`P${p}`} color="#fafafa" />
          <MetricCard label="Latency Band" val={`${Math.round(prevLat)}-${Math.round(currLat)}ms`} color="#fafafa" />
          <MetricCard label="Total Events" val={bandEvents.length.toLocaleString()} color="#fafafa" />
        </div>
        <hr style={{ width: '100%', border: 0, borderTop: '1px solid var(--border)', margin: '0 0 20px 0' }} />
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px', width: '100%', textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>LOGS</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Sampled {Math.min(20, bandEvents.length)} logs</div>
            </div>
            <button className="card-btn-view" style={{ padding: '6px 14px', fontSize: 11 }} onClick={onLc}>VIEW</button>
          </div>
          {rows.length
            ? <EventTable events={rows} cols={[
                { key: 'fmtDate', label: 'Date' },
                { key: 'fmtTime', label: 'Time' },
                { key: 'uc', label: 'Use Case' },
                { key: 'dev', label: 'Device' },
                { key: 'room', label: 'Room' },
                { key: 'floor', label: 'Floor' },
                { key: 'lat', label: 'Latency' },
                { key: 'status', label: 'Status' }
              ]} />
            : <div className="dbg-empty">No events found in sample.</div>}
        </div>
      </div>
    );

    dash.showModal(customTitle, customBody);
  };



  return (<>
    <div className="grid-2" style={{ marginBottom: 16 }}>
      <div className="panel" style={{ marginBottom: 0 }}>
        <h3>SPEED DISTRIBUTION<InfoButton k="lat_dist" /></h3>
        <div className="chart-box" style={{ height: 260 }}>
          <Bar
            data={{
              labels: bucketKeys as string[],
              datasets: [{ label: 'Events', data: bucketKeys.map((k) => (s.buckets as Record<string, number>)[k as string] ?? 0), backgroundColor: bucketColors, borderRadius: 2 }],
            }}
            options={{
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              onClick: (_e, els) => { if (els.length) openBucketModal(String(bucketKeys[els[0]!.index])); },
              scales: {
                y: { title: { display: true, text: 'Event Count' }, beginAtZero: true },
                x: { title: { display: true, text: 'Latency Range (ms)' } },
              },
            }}
          />
        </div>
      </div>
      <div className="panel" style={{ marginBottom: 0 }}>
        <h3>CUMULATIVE DISTRIBUTION FUNCTION<InfoButton k="lat_cdf" /></h3>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 16, fontSize: 11, color: 'rgba(255,255,255,0.7)', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 24, height: 2, background: '#6366f1', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#6366f1' }} />
            </div>
            <span>Latency (ms)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 24, height: 0, borderTop: '2px dashed rgba(255,255,255,0.3)' }} /><span>Target (1000ms)</span>
          </div>
        </div>
        <div className="chart-box" style={{ height: 238 }}>
          <Line
            data={{
              labels: cdfPoints.labels,
              datasets: [
                {
                  label: 'Latency (ms)',
                  data: cdfPoints.data,
                  borderColor: '#6366f1',
                  backgroundColor: 'rgba(99,102,241,0.1)',
                  tension: 0.1,
                  fill: true,
                  pointRadius: (ctx) => {
                    const p = cdfPoints.labels[ctx.dataIndex];
                    return (p === 25 || p === 50 || p === 90 || p === 95 || p === 99) ? 4 : 0;
                  },
                  pointBackgroundColor: '#6366f1',
                },
                {
                  label: 'Target (ms)',
                  data: Array(cdfPoints.labels.length).fill(1000),
                  borderColor: 'rgba(255,255,255,0.3)',
                  backgroundColor: 'transparent',
                  tension: 0,
                  fill: false,
                  pointRadius: 0,
                  borderDash: [3, 3],
                },
              ],
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              interaction: { mode: 'index', intersect: false },
              onClick: (_e, elements) => {
                if (!elements.length) return;
                const idx = elements[0]!.index;
                openCdfModal(idx);
              },
              plugins: {
                legend: { display: false },
                tooltip: {
                  usePointStyle: true,
                  filter: function(tooltipItem) {
                    return tooltipItem.datasetIndex === 0;
                  },
                  callbacks: {
                    labelPointStyle: function() {
                      return { pointStyle: tooltipIconCanvas, rotation: 0 };
                    },
                    title: (ctx) => {
                      const i = ctx[0]?.dataIndex;
                      return i != null ? `Percentile: ${cdfPoints.labels[i]}th` : '';
                    },
                    label: (ctx) => `Latency: ${ctx.parsed.y} ms`,
                  },
                },
              },
              scales: {
                y: { title: { display: true, text: 'Latency (ms)' }, beginAtZero: true },
                x: {
                  title: { display: true, text: 'Percentile' },
                  ticks: {
                    autoSkip: false,
                    maxRotation: 0,
                    minRotation: 0,
                    callback: function(_val, index) {
                      const p = cdfPoints.labels[index];
                      if (p == null) return '';
                      return (p === 1 || p === 25 || p === 50 || p === 90 || p === 95 || p === 99) ? `P${p}` : '';
                    }
                  }
                },
              },
            }}
          />
        </div>
      </div>
    </div>

    <div className="panel">
      <h3>SPEED SEGMENTS<InfoButton k="speed_segments" /></h3>
      <div>
        {segs.map((sg) => {
          const noData = sg.val.p50 === 0 && sg.val.avg === 0;
          const box = (label: string, value: number, isP50: boolean) => (
            <div key={label} style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: 12, width: 100, textAlign: 'center', background: 'rgba(0,0,0,0.2)' }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase' }}>{label}</div>
              <div style={{ fontSize: 16, fontWeight: 'bold', color: isP50 ? '#fbbf24' : '#ffffff', marginBottom: 6 }}>{value}ms</div>
              <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>Target &lt;{sg.target.val}ms</div>
            </div>
          );
          return (
            <div key={sg.key} className="speed-segment" onClick={() => openSegModal(sg)}>
              <div style={{ flex: 1, paddingRight: 40 }}>
                <div style={{ fontSize: 13, fontWeight: 'bold', color: '#fff', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{sg.name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>{sg.desc}</div>
              </div>
              <div>
                {noData
                  ? <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', paddingRight: 20 }}>{sg.key === 'remote_e2e' ? 'Not tracked yet' : 'No data'}</div>
                  : <div style={{ display: 'flex', gap: 10 }}>
                      {box('P50', sg.val.p50, true)}
                      {box('P95', sg.val.p95, false)}
                      {box('AVG', Math.round(sg.val.avg), false)}
                      {box('STD DEV', Math.round(sg.val.stddev), false)}
                    </div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>


  </>);
}
