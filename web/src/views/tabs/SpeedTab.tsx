/** Speed tab — segment cards (with documented formulas), speed distribution,
 *  AVG & SD trend, and per-use-case cards incl. Hub Control (Direct). */
import { useMemo } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import '../../charts/setup';
import type { HubDetail, PerUcStats, SpeedStats } from '../../types/api';
import { TARGETS, UC_DESC, ucLabel, LATENCY_BUCKETS } from '../../lib/constants';
import { tsMs, fmtOrDash } from '../../lib/format';
import { allSourceDaily } from '../../lib/pool';
import { InfoButton, KV, EventTable, LcCta, type EvCol } from '../../components/common';
import { useDash } from '../../state/DashboardContext';
import { useShowDayDebug } from '../../modals/dayDebug';

interface SegDef {
  key: 'hub_snap_hub' | 'hub_app' | 'local_e2e' | 'remote_e2e';
  name: string;
  desc: string;
  val: SpeedStats & { events?: unknown[] };
  target: { val: number; lbl: string };
  cols: EvCol[];
  derivedEvents?: Record<string, unknown>[];
}

// Exact per-event formula behind each segment (matches docs/FORMULAS.md).
const F_MAP: Record<SegDef['key'], { f: string; src: string; note: string }> = {
  hub_snap_hub: {
    f: 'snap_state_change_ts − matter_command_ts',
    src: 'ha_logs · per event · 0 < gap ≤ 30s',
    note: 'The device round-trip over the Thread mesh. Same for every origin (app, dock, automation, scene, hub UI). Stale/clock-skewed gaps > 30s excluded.',
  },
  hub_app: {
    f: 'ws_confirmation_ts − rest_response_ts',
    src: 'app_logs · per event · diff ≥ 0',
    note: 'Time for the hub to push the confirmed state to the app over WebSocket.',
  },
  local_e2e: {
    f: 'latency_ms = ws_confirmation_ts − tap_ts',
    src: 'app_logs · Local App Control + Device Bind',
    note: 'Full tap-to-confirmed round-trip on local Wi-Fi.',
  },
  remote_e2e: {
    f: 'latency_ms = ws_confirmation_ts − tap_ts',
    src: 'app_logs · Remote App Control',
    note: 'Full round-trip when controlling from outside the home.',
  },
};

export function SpeedTab({ hub, d }: { hub: string; d: HubDetail }) {
  const dash = useDash();
  const showDayDebug = useShowDayDebug(hub);
  const s = d.speed;
  const daily = useMemo(() => allSourceDaily(hub, d), [hub, d]);

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
      key: 'hub_snap_hub', name: 'Hub → SNAP → Hub',
      desc: 'Hub issues Matter cmd over Thread mesh → SNAP device activates → state reflected back to Hub.',
      val: s.hub_snap_hub, target: TARGETS.hubSnap!,
      cols: [
        { key: 'ts', label: 'Event Time' }, { key: 'dev', label: 'Device' }, { key: 'uc', label: 'Use Case' },
        { key: 'origin', label: 'Origin' }, { key: 'matter_ts', label: 'Matter CMD Sent' },
        { key: 'snap_ts', label: 'State Reflected' }, { key: 'lat', label: 'Total (ms)' }, { key: 'room', label: 'Room' },
      ],
    },
    {
      key: 'hub_app', name: 'Hub → App (WebSocket Push)',
      desc: 'Device state confirmed at Hub → Hub immediately pushes via WebSocket → App reflects new state.',
      val: s.hub_app, target: TARGETS.hubApp!, derivedEvents: hubAppEvents,
      cols: [
        { key: 'ts', label: 'Event Time' }, { key: 'hub_dispatched', label: 'State Confirmed at Hub' },
        { key: 'app_confirmed', label: 'App Received (ws_conf)' }, { key: 'lat', label: 'Push (ms)' },
        { key: 'dev', label: 'Device' }, { key: 'room', label: 'Room' },
      ],
    },
    {
      key: 'local_e2e', name: 'App Control (Local)',
      desc: 'Full round-trip on local Wi-Fi: App sends cmd → Hub receives → SNAP device activates → state pushed back to App via WebSocket',
      val: s.local_e2e, target: TARGETS.localE2e!,
      cols: [
        { key: 'ts', label: 'Tap Time' }, { key: 'dev', label: 'Device' }, { key: 'uc', label: 'Use Case' },
        { key: 'cmd_sent', label: 'CMD Sent' }, { key: 'rest_resp', label: "Hub ACK'd" },
        { key: 'ws_conf', label: 'App Updated' }, { key: 'lat', label: 'E2E (ms)' },
      ],
    },
    {
      key: 'remote_e2e', name: 'App Control (Remote)',
      desc: 'Full round-trip via Internet: App sends cmd remotely → Hub receives → SNAP device activates → state pushed back to App via WebSocket',
      val: s.remote_e2e, target: TARGETS.remoteE2e!,
      cols: [
        { key: 'ts', label: 'Tap Time' }, { key: 'dev', label: 'Device' }, { key: 'uc', label: 'Use Case' },
        { key: 'cmd_sent', label: 'CMD Sent' }, { key: 'rest_resp', label: "Hub ACK'd" },
        { key: 'ws_conf', label: 'App Updated' }, { key: 'lat', label: 'E2E (ms)' },
      ],
    },
  ];

  const openSegModal = (sg: SegDef) => {
    const noData = sg.val.p50 === 0 && sg.val.avg === 0;
    if (noData) {
      const why = sg.key === 'remote_e2e'
        ? 'No remote-control events were recorded in this period. This segment will populate once devices are controlled from outside the home network.'
        : 'The hub is not recording timing values for this segment yet — every event reports 0ms. This is a hub-side data collection gap, not a dashboard issue. Latency stats will appear automatically once the hub firmware records real timestamps.';
      dash.showModal(`${sg.name} — No Data`, (<>
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 16px', marginBottom: 14, fontSize: 11, color: 'var(--muted)', lineHeight: 1.7 }}>
          <strong style={{ color: '#fafafa' }}>{sg.name}</strong><br />{sg.desc}
        </div>
        <div style={{ background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 6, padding: '12px 16px', fontSize: 11, lineHeight: 1.7 }}>
          <strong style={{ color: 'var(--yellow)' }}>Why is there no data?</strong><br />
          <span style={{ color: 'var(--muted)' }}>{why}</span>
        </div>
      </>));
      return;
    }
    const isSlow = sg.val.p50 > sg.target.val;
    const fm = F_MAP[sg.key];
    const segF = sg.key === 'hub_snap_hub' ? 'hub_snap' : sg.key === 'hub_app' ? 'hub_app' : sg.key;
    const lcOpts = {
      hub, tab: 'all' as const, segFilter: segF,
      context: { label: sg.name, desc: `P50: ${sg.val.p50}ms · P95: ${sg.val.p95}ms` },
    };
    const displayEvents = (sg.key === 'hub_app' ? sg.derivedEvents : (sg.val.events as Record<string, unknown>[])) || [];
    dash.showModal(`${sg.name} — Detail`, (<>
      <table style={{ fontSize: 12, marginBottom: 14 }}>
        <tbody>
          <KV label="Segment"><strong>{sg.name}</strong></KV>
          <KV label="Description">{sg.desc}</KV>
          <KV label="Formula"><code style={{ fontSize: 11, color: '#fafafa' }}>{fm.f}</code></KV>
          <KV label="Source"><span style={{ fontSize: 11, color: 'var(--muted)' }}>{fm.src}</span></KV>
          <KV label="Aggregation"><span style={{ fontSize: 11, color: 'var(--muted)' }}>P50/P95 = 50th/95th percentile · Avg = mean · Std Dev = σ, across all events in the period</span></KV>
          <KV label="Notes"><span style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--muted)' }}>{fm.note}</span></KV>
          <KV label="Avg">{sg.val.avg}ms</KV>
          <KV label="P50"><strong style={{ fontSize: 16, color: isSlow ? 'var(--yellow)' : '#fafafa' }}>{sg.val.p50}ms</strong></KV>
          <KV label="P95">
            <span style={{ color: sg.val.p95 > 1000 ? 'var(--red)' : sg.val.p95 > 500 ? 'var(--yellow)' : 'var(--green)' }}>{sg.val.p95}ms</span>
          </KV>
          <KV label="Std Dev">{sg.val.stddev != null ? Math.round(sg.val.stddev) : 0}ms</KV>
        </tbody>
      </table>
      {displayEvents.length ? (<>
        <div className="dbg-section-hdr" style={{ marginBottom: 8 }}>
          <span className="dbg-section-title">Sample Events ({displayEvents.length})</span>
          <button className="dbg-lc-link" onClick={() => dash.openLogCenter(lcOpts)}>View in Log Center →</button>
        </div>
        <EventTable events={displayEvents} cols={sg.cols} />
      </>) : <LcCta label="View in Log Center →" onClick={() => dash.openLogCenter(lcOpts)} />}
    </>));
  };

  // ── Speed distribution buckets ────────────────────────────────────────────
  const bucketKeys = Object.keys(s.buckets) as (keyof typeof s.buckets)[];
  const bucketColors = ['#10b981', '#f59e0b', '#f97316', '#ef4444', '#be123c'];

  const openBucketModal = (k: string) => {
    const evs = (s.bucket_events as Record<string, Record<string, unknown>[]>)[k] || [];
    const cnt = (s.buckets as Record<string, number>)[k] || 0;
    const parseBucket = (bucket: string) =>
      bucket.startsWith('<') ? { latMin: 0, latMax: parseInt(bucket.slice(1)) }
      : bucket.startsWith('>') ? { latMin: parseInt(bucket.slice(1)), latMax: null }
      : (() => { const [a, b] = bucket.split('-').map((x) => parseInt(x)); return { latMin: a ?? 0, latMax: b ?? null }; })();
    const isProblematic = k.includes('800') || k.includes('>1000') || k.includes('600');
    dash.showModal(`Latency ${k}ms — ${cnt} Events`, (<>
      <table style={{ fontSize: 12, marginBottom: 14 }}>
        <tbody>
          <KV label="Latency Range"><strong>{k}ms</strong></KV>
          <KV label="Event Count"><strong>{cnt}</strong></KV>
          {isProblematic ? <KV label="Assessment"><span style={{ color: 'var(--red)' }}>Above 600ms — degraded user experience</span></KV> : null}
        </tbody>
      </table>
      {evs.length ? (<>
        <div className="dbg-section-hdr" style={{ marginBottom: 8 }}>
          <span className="dbg-section-title">Sample Events</span>
          <button className="dbg-lc-link" onClick={() => {
            const f = parseBucket(k);
            dash.openLogCenter({ hub, tab: 'all', ...f, context: { label: `Latency ${k}ms — ${cnt} events`, desc: `${hub.toUpperCase()} · ${cnt} events in this latency range` } });
          }}>View in Log Center →</button>
        </div>
        <EventTable events={evs} cols={[
          { key: 'ts', label: 'Time' }, { key: 'dev', label: 'Device' }, { key: 'uc', label: 'Use Case' },
          { key: 'src', label: 'Source' }, { key: 'lat', label: 'Latency' }, { key: 'room', label: 'Room' },
        ]} />
      </>) : null}
    </>));
  };

  // ── AVG & SD trend (app-daily) ────────────────────────────────────────────
  const trendDates = daily.map((r) => { const p = r.date.split('-'); return p.length === 3 ? `${p[2]}-${p[1]}` : r.date; });
  const interpolate = (arr: (number | null)[]) => {
    let lastVal: number | null = null, lastIdx = -1;
    const res = [...arr];
    for (let i = 0; i < res.length; i++) {
      const v = res[i];
      if (v != null) {
        if (lastVal !== null && i - lastIdx > 1) {
          const step = (v - lastVal) / (i - lastIdx);
          for (let j = lastIdx + 1; j < i; j++) res[j] = lastVal + step * (j - lastIdx);
        }
        lastVal = v; lastIdx = i;
      }
    }
    return res;
  };
  const intAvg = interpolate(daily.map((r) => r.avg));
  const intSd = interpolate(daily.map((r) => r.sd));

  // ── Per-use-case cards (+ synthetic Hub Control (Direct)) ────────────────
  const perUc: Record<string, PerUcStats> = { ...s.per_uc };
  const hd = d.usage?.hub_direct_total;
  if (hd && s.hub_snap_hub && (s.hub_snap_hub.p50 || s.hub_snap_hub.avg)) {
    perUc['Hub Control (Direct)'] = {
      avg: s.hub_snap_hub.avg, p50: s.hub_snap_hub.p50, p95: s.hub_snap_hub.p95,
      stddev: s.hub_snap_hub.stddev, count: hd, success: hd, buckets: {},
      events: (d.hub_ha_ui_events || []).slice(0, 50).map((e) => ({
        ts: e.ts, dev: e.dev, friendly_name: e.friendly_name, lat: 0, src: 'direct_hub_ui', room: e.room,
      })),
    };
  }

  const openUcDetail = (uc: string) => {
    const v = perUc[uc];
    if (!v) return;
    const desc = UC_DESC[uc] || uc;
    const lbl = ucLabel(uc);
    const stddevC = v.stddev > 500 ? 'var(--red)' : v.stddev > 200 ? 'var(--yellow)' : 'var(--green)';
    const lcOpts = { hub, tab: 'all' as const, ucFilter: uc === 'Hub Control (Direct)' ? 'Hub Control' : uc, context: { label: `${lbl} — Events`, desc: `${hub.toUpperCase()} · P50: ${v.p50}ms · P95: ${v.p95}ms · ${v.count} total` } };
    dash.showModal(`${lbl} — Speed Detail`, (<>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px', marginBottom: 14, fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
        <strong style={{ color: '#fafafa' }}>{lbl}</strong><br />{desc}
      </div>
      <table style={{ fontSize: 12, marginBottom: 14 }}>
        <tbody>
          <KV label="Total Events"><strong style={{ fontSize: 16 }}>{v.count}</strong></KV>
          <KV label="Avg">{v.avg}ms</KV>
          <KV label="P50 (median)"><strong style={{ fontSize: 16, color: '#fafafa' }}>{v.p50}ms</strong></KV>
          <KV label="P95">
            <span style={{ color: v.p95 > 1000 ? 'var(--red)' : v.p95 > 500 ? 'var(--yellow)' : 'var(--green)' }}>
              {v.p95}ms{v.p95 > 1000 ? ' — CRITICAL' : v.p95 > 500 ? ' — WARNING' : ''}
            </span>
          </KV>
          <KV label="Std Dev">
            <span style={{ color: stddevC, fontWeight: 600 }}>{v.stddev}ms</span>
            <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 8 }}>
              {v.stddev > 500 ? 'erratic' : v.stddev > 200 ? 'moderate variability' : 'consistent'}
            </span>
          </KV>
        </tbody>
      </table>
      {v.events && v.events.length ? (<>
        <div className="dbg-section-hdr" style={{ marginBottom: 8 }}>
          <span className="dbg-section-title">Sample Events ({v.events.length} of {v.count})</span>
          <button className="dbg-lc-link" onClick={() => dash.openLogCenter(lcOpts)}>View all {lbl} in Log Center →</button>
        </div>
        <EventTable events={v.events as unknown as Record<string, unknown>[]} cols={[
          { key: 'ts', label: 'Time' }, { key: 'dev', label: 'Device' }, { key: 'lat', label: 'Latency (ms)' },
          { key: 'src', label: 'Source' }, { key: 'room', label: 'Room' },
        ]} />
      </>) : <LcCta label={`View all ${lbl} in Log Center →`} onClick={() => dash.openLogCenter(lcOpts)} />}
    </>));
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
        <h3>AVG & SD TREND<InfoButton k="avg_sd_trend" /></h3>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 16, fontSize: 11, color: 'rgba(255,255,255,0.7)', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 24, height: 2, background: '#6366f1', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#6366f1' }} />
            </div>
            <span>Avg Speed (ms)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 24, height: 0, borderTop: '2px dashed #10b981' }} /><span>AVG + SD</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 24, height: 0, borderTop: '2px dashed #ef4444' }} /><span>AVG - SD</span>
          </div>
        </div>
        <div className="chart-box" style={{ height: 238 }}>
          <Line
            data={{
              labels: trendDates,
              datasets: [
                { label: 'Avg Speed (ms)', data: intAvg, borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.1)', tension: 0.3, fill: false, pointRadius: 3, spanGaps: true },
                { label: 'AVG + SD', data: intAvg.map((a, i) => { const sd = intSd[i]; return a != null && sd != null ? Math.round(a + sd) : null; }), borderColor: '#10b981', backgroundColor: 'transparent', tension: 0.3, fill: false, pointRadius: 0, borderDash: [3, 3], spanGaps: true },
                { label: 'AVG - SD', data: intAvg.map((a, i) => { const sd = intSd[i]; return a != null && sd != null ? Math.max(0, Math.round(a - sd)) : null; }), borderColor: '#ef4444', backgroundColor: 'transparent', tension: 0.3, fill: false, pointRadius: 0, borderDash: [3, 3], spanGaps: true },
              ],
            }}
            options={{
              responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
              onClick: (_e, els) => { if (els.length) showDayDebug(daily[els[0]!.index], 'speed'); },
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: (ctx) => {
                      if (ctx.datasetIndex === 0) {
                        const sd = intSd[ctx.dataIndex];
                        return `Avg Speed : ${Math.round(ctx.parsed.y ?? 0)} ms${sd != null ? ` · Std Dev : ${Math.round(sd)} ms` : ''}`;
                      }
                      return `${ctx.dataset.label}: ${Math.round(ctx.parsed.y ?? 0)} ms`;
                    },
                  },
                },
              },
              scales: {
                y: { title: { display: true, text: 'Speed (ms)' }, beginAtZero: true },
                x: { title: { display: true, text: 'Date' } },
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
                <div style={{ fontSize: 10, color: 'var(--blue)', marginTop: 8, fontWeight: 600 }}>Click for breakdown & Log Center →</div>
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

    <div className="panel">
      <h3>
        <span>Speed by Use Case — Click any card to inspect events</span>
        <InfoButton k="uc_speed_metrics" plain />
      </h3>
      <p style={{ color: 'var(--muted)', fontSize: 10, margin: '-4px 0 14px' }}>
        Each card shows the latency distribution for that trigger type. Bar colours:{' '}
        <span style={{ color: '#10b981' }}>■</span> &lt;500ms <span style={{ color: '#f59e0b' }}>■</span> 500ms–1s{' '}
        <span style={{ color: '#f97316' }}>■</span> 1–2s <span style={{ color: '#ef4444' }}>■</span> &gt;2s
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14 }}>
        {Object.keys(perUc).sort().map((uc) => {
          const v = perUc[uc]!;
          const st = v.p95 < 1000 ? 'Healthy' : v.p95 < 2000 ? 'Warning' : 'Critical';
          const sc = st === 'Healthy' ? 'tag-green' : st === 'Warning' ? 'tag-yellow' : 'tag-red';
          const p50c = v.p50 < 500 ? 'var(--green)' : v.p50 < 1000 ? 'var(--yellow)' : 'var(--red)';
          const p95c = v.p95 < 1000 ? 'var(--green)' : v.p95 < 2000 ? 'var(--yellow)' : 'var(--red)';
          const bkts = (v.buckets || {}) as Record<string, number>;
          const bkTotal = LATENCY_BUCKETS.reduce((sum, b) => sum + (bkts[b.k] || 0), 0) || 1;
          const under1k = (bkts['<500ms'] || 0) + (bkts['500-1000ms'] || 0);
          const sub1sPct = bkTotal > 1 ? Math.round((under1k / bkTotal) * 100) : 0;
          const sub1sC = sub1sPct >= 95 ? 'var(--green)' : sub1sPct >= 80 ? 'var(--yellow)' : 'var(--red)';
          return (
            <div key={uc} className="uc-card" onClick={() => openUcDetail(uc)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#fafafa', lineHeight: 1.3, paddingRight: 8 }}>{ucLabel(uc)}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <InfoButton k="uc_speed_metrics" plain />
                  <span className={`tag ${sc}`}>{st}</span>
                </div>
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 12 }}>{v.count.toLocaleString()} events · {dash.periodLabel()}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: p50c, lineHeight: 1 }}>{v.p50}ms</div>
              <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.6px', color: 'var(--muted)', marginBottom: 10 }}>Median (P50)</div>
              <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', marginBottom: 12 }}>
                {[
                  { l: 'Avg', v: `${v.avg}ms`, c: undefined as string | undefined },
                  { l: 'P95', v: `${v.p95}ms`, c: p95c },
                  { l: 'Std Dev', v: `${fmtOrDash(v.stddev, 'ms')}`, c: (v.stddev || 0) > 500 ? 'var(--red)' : (v.stddev || 0) > 200 ? 'var(--yellow)' : 'var(--green)' },
                  { l: 'Sub-1s', v: `${sub1sPct}%`, c: sub1sC },
                ].map((cell, i, arr) => (
                  <div key={cell.l} style={{ flex: 1, padding: '6px 8px', textAlign: 'center', borderRight: i < arr.length - 1 ? '1px solid var(--border)' : undefined }}>
                    <div style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--muted)', marginBottom: 2 }}>{cell.l}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: cell.c }}>{cell.v}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 9, color: 'var(--muted)', marginBottom: 5 }}>
                <span>Latency distribution</span>
                <span style={{ color: sub1sC }}>Under 1s: {sub1sPct}%</span>
              </div>
              <div style={{ display: 'flex', height: 9, borderRadius: 4, overflow: 'hidden', background: 'var(--border)', marginBottom: 8 }}>
                {LATENCY_BUCKETS.filter((b) => (bkts[b.k] || 0) > 0).map((b) => {
                  const cnt = bkts[b.k] || 0;
                  const pct = ((cnt / bkTotal) * 100).toFixed(2);
                  return <div key={b.k} style={{ width: `${pct}%`, background: b.color, height: '100%' }} title={`${b.k}: ${cnt} events (${parseFloat(pct).toFixed(1)}%)`} />;
                })}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 9, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.6 }}>
                {LATENCY_BUCKETS.filter((b) => (bkts[b.k] || 0) > 0).map((b) => {
                  const pct = Math.round(((bkts[b.k] || 0) / bkTotal) * 100);
                  return (
                    <span key={b.k} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 1, background: b.color, display: 'inline-block', flexShrink: 0 }} />
                      {b.label} {pct}%
                    </span>
                  );
                })}
                {LATENCY_BUCKETS.every((b) => !(bkts[b.k] || 0)) && <span>No latency data</span>}
              </div>
              <div style={{ fontSize: 10, color: 'var(--blue)', textAlign: 'right', opacity: 0.8 }}>Click to inspect events →</div>
            </div>
          );
        })}
      </div>
    </div>
  </>);
}
