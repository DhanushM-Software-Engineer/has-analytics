/** Log Center — event-level debugging workspace. Ported 1:1 from the vanilla
 *  version (tabs, hub pills, filters, context banner, segment-aware columns,
 *  expandable timing pipeline) but with VIRTUALIZED rows so tens of thousands
 *  of events render smoothly (the at-scale requirement). */
import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useDash, type LcOpts } from '../state/DashboardContext';
import { buildEventPool, eventSrcClass, srcPred, evDow, evHour, type PoolEvent } from '../lib/pool';
import { relColor, msDiff, segStatus, devShort } from '../lib/format';
import { InfoButton } from '../components/common';

type LcTab = 'failures' | 'slow' | 'all';

interface LcState {
  hub: string | null;
  tab: LcTab;
  src: string;
  reason: string;
  search: string;
  srcFilter: string | null;
  ucFilter: string | null;
  segFilter: string | null;
  latMin: number | null;
  latMax: number | null;
  hourFilter: number | null;
  dayFilter: string | null;
  context: { label: string; desc?: string } | null;
}

function initState(opts: LcOpts): LcState {
  return {
    hub: opts.hub ?? null,
    tab: opts.tab ?? 'failures',
    src: opts.filters?.src ?? '',
    reason: opts.filters?.reason ?? '',
    search: opts.filters?.search ?? '',
    srcFilter: opts.srcFilter ?? null,
    ucFilter: opts.ucFilter ?? null,
    segFilter: opts.segFilter ?? null,
    latMin: opts.latMin ?? null,
    latMax: opts.latMax ?? null,
    hourFilter: opts.hourFilter ?? null,
    dayFilter: opts.dayFilter ?? null,
    context: opts.context ?? null,
  };
}

export function LogCenter({ opts }: { opts: LcOpts }) {
  const dash = useDash();
  const { D } = dash;
  const [st, setSt] = useState<LcState>(() => initState(opts));
  const [expanded, setExpanded] = useState<number | null>(null);

  const events = useMemo(() => {
    const hubs = st.hub ? [st.hub] : Object.keys(D);
    let all: PoolEvent[] = [];
    hubs.forEach((h) => { const d = D[h]; if (d) all = all.concat(buildEventPool(h, d)); });
    all.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));

    if (st.tab === 'failures') all = all.filter((e) => e.status === 'fail');
    else if (st.tab === 'slow') all = all.filter((e) => e.status === 'slow' || e.status === 'warn');

    const pred = st.srcFilter ? srcPred(st.srcFilter) : null;
    const src = st.src.toLowerCase(), reason = st.reason.toLowerCase(), search = st.search.toLowerCase();
    return all.filter((e) => {
      if (pred && !pred(e)) return false;
      if (st.ucFilter && !(e.uc || '').toLowerCase().includes(st.ucFilter.toLowerCase())) return false;
      if (st.segFilter) {
        if (st.segFilter === 'hub_app') { if (e.segType !== 'hub_snap') return false; }
        else if (e.segType !== st.segFilter) return false;
      }
      if (st.latMin !== null || st.latMax !== null) {
        const l = parseFloat(String(e.lat));
        if (isNaN(l)) return false;
        if (st.latMin !== null && l < st.latMin) return false;
        if (st.latMax !== null && l > st.latMax) return false;
      }
      if (st.hourFilter !== null && evHour(e.ts) !== st.hourFilter) return false;
      if (st.dayFilter && evDow(e.ts) !== st.dayFilter) return false;
      if (src) {
        const esrc = (e.src || '').toLowerCase();
        if (src === 'app' && esrc !== 'app') return false;
        else if (src !== 'app' && !esrc.includes(src)) return false;
      }
      if (reason && !(e.reason || '').toLowerCase().includes(reason)) return false;
      if (search && !`${e.ts} ${e.dev} ${e.room} ${e.uc} ${e.hub}`.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [D, st]);

  const failCnt = events.filter((e) => e.status === 'fail').length;
  const slowCnt = events.filter((e) => e.status === 'slow' || e.status === 'warn').length;
  const byClass = { app: 0, remote: 0, dock: 0, hub: 0 };
  events.forEach((e) => { byClass[eventSrcClass(e)]++; });

  const clearFilters = () => {
    setSt((s) => ({ ...s, src: '', reason: '', search: '', context: null, srcFilter: null, ucFilter: null, segFilter: null, latMin: null, latMax: null, hourFilter: null, dayFilter: null }));
    setExpanded(null);
  };

  const hasFilter = st.context || st.srcFilter || st.ucFilter || st.segFilter || st.latMin !== null;
  const filterParts: string[] = [];
  if (st.srcFilter) filterParts.push(`Source: ${st.srcFilter}`);
  if (st.ucFilter) filterParts.push(`Use Case: ${st.ucFilter}`);
  if (st.segFilter) filterParts.push(`Segment: ${st.segFilter}`);
  if (st.latMin !== null) filterParts.push(`Latency: ${st.latMin}${st.latMax ? '–' + st.latMax : '+'} ms`);

  // ── Virtualized rows ──────────────────────────────────────────────────────
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (expanded === i ? 420 : 37),
    overscan: 14,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const segCols = st.segFilter ? SEG_COLS[st.segFilter === 'remote_e2e' ? 'local_e2e' : st.segFilter] : null;
  const gridTemplate = segCols ? segCols.grid : DEFAULT_GRID;

  const tabNames: Record<string, string> = { overall: 'Overview', speed: 'Speed', reliability: 'Reliability', usage: 'Usage' };
  const origin = dash.view.kind === 'logcenter' ? dash.view.origin : null;

  return (
    <div>
      <div className="lc-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            {origin && (
              <div style={{ paddingTop: 2 }}>
                <button className="btn" onClick={dash.lcGoBack} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '5px 12px' }}>
                  <span style={{ fontSize: 14, lineHeight: 1 }}>←</span>
                  <span>
                    <div style={{ fontWeight: 600, color: '#fafafa' }}>
                      {origin.view === 'detail' ? `${origin.hub?.toUpperCase()} · ${tabNames[origin.tabId ?? 'overall'] ?? 'Overview'}` : 'Fleet Overview'}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 1 }}>Return to previous view</div>
                  </span>
                </button>
              </div>
            )}
            <div>
              <div className="lc-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                Log Center<InfoButton k="log_center" plain />
              </div>
              <div className="lc-subtitle">
                Event-level debugging workspace · Click any row to expand timing pipeline · {dash.periodLabel()}
              </div>
            </div>
          </div>
          <HubDropdown
            hubs={Object.keys(D)}
            dotColor={(h) => relColor(D[h]!.activity_reliability ?? D[h]!.reliability)}
            value={st.hub}
            onChange={(h) => { setSt((s) => ({ ...s, hub: h })); setExpanded(null); }}
          />
        </div>
        <div className="lc-tabs-row">
          <div className="lc-tabs">
            <button className={`lc-tab tab-fail ${st.tab === 'failures' ? 'active' : ''}`} onClick={() => { setSt((s) => ({ ...s, tab: 'failures' })); setExpanded(null); }}>Failures</button>
            <button className={`lc-tab tab-slow ${st.tab === 'slow' ? 'active' : ''}`} onClick={() => { setSt((s) => ({ ...s, tab: 'slow' })); setExpanded(null); }}>Slow Events (&gt;800ms)</button>
            <button className={`lc-tab tab-all ${st.tab === 'all' ? 'active' : ''}`} onClick={() => { setSt((s) => ({ ...s, tab: 'all' })); setExpanded(null); }}>All Events</button>
          </div>
          <div className="lc-filters">
            <select className="lc-filter-select" value={st.src} onChange={(e) => setSt((s) => ({ ...s, src: e.target.value }))}>
              <option value="">All Sources</option>
              <option value="app">App Control (Local)</option>
              <option value="remote">Remote App</option>
              <option value="docklet">Dock Control</option>
              <option value="direct">Hub (Direct / Scene / Automation)</option>
            </select>
            <select className="lc-filter-select" value={st.reason} onChange={(e) => setSt((s) => ({ ...s, reason: e.target.value }))}>
              <option value="">All Reasons</option>
              <option value="TIMEOUT">TIMEOUT</option>
              <option value="NO_RESPONSE">NO_RESPONSE</option>
              <option value="DEVICE_OFFLINE">DEVICE_OFFLINE</option>
              <option value="DEVICE_UNAVAILABLE">DEVICE_UNAVAILABLE</option>
              <option value="THREAD_MESH_FAIL">THREAD_MESH_FAIL</option>
            </select>
            <input className="lc-filter-input" placeholder="Device, room, use case…" value={st.search}
              onChange={(e) => setSt((s) => ({ ...s, search: e.target.value }))} />
            <button className="lc-filter-clear" onClick={clearFilters}>Clear</button>
          </div>
        </div>
      </div>

      <div style={{ padding: '20px 28px' }}>
        {hasFilter && (
          <div className="lc-context-banner">
            <div>
              <div className="lc-context-label">{st.context?.label || 'Filtered View'}</div>
              <div className="lc-context-desc">
                {(st.context?.desc || '') + (filterParts.length ? ` · Filter — ${filterParts.join(' · ')}` : '')}
              </div>
            </div>
            <button className="lc-context-clear" onClick={clearFilters}>Clear Filter</button>
          </div>
        )}

        <div className="lc-summary-row">
          <span>
            <span className="lc-cnt">{events.length}</span> events shown{' '}
            <span style={{ color: 'var(--muted)' }}>
              ({[
                byClass.app ? `App ${byClass.app}` : null,
                byClass.remote ? `Remote ${byClass.remote}` : null,
                byClass.dock ? `Dock ${byClass.dock}` : null,
                byClass.hub ? `Hub ${byClass.hub}` : null,
              ].filter(Boolean).join(' · ')})
            </span>
            {failCnt > 0 && <> · <span className="lc-cnt-r">{failCnt} failure{failCnt !== 1 ? 's' : ''}</span></>}
            {slowCnt > 0 && st.tab !== 'slow' && <> · <span className="lc-cnt-y">{slowCnt} slow</span></>}
            {' '}· {st.hub ? st.hub.toUpperCase() : 'All Hubs'} · {dash.periodLabel()}
          </span>
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {events.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '56px 20px', color: 'var(--muted)', fontSize: 12 }}>
              No events match the current filters.
            </div>
          ) : (
            <div ref={parentRef} style={{ overflowY: 'auto', overflowX: 'auto', maxHeight: 620 }}>
              <div className="lcv-head" style={{ gridTemplateColumns: gridTemplate, minWidth: 900 }}>
                {(segCols ? segCols.heads : DEFAULT_HEADS).map((h, i) => <div key={i}>{h}</div>)}
              </div>
              <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', minWidth: 900 }}>
                {rowVirtualizer.getVirtualItems().map((vi) => {
                  const ev = events[vi.index]!;
                  const isExp = expanded === vi.index;
                  return (
                    <div key={vi.key} ref={rowVirtualizer.measureElement} data-index={vi.index}
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}>
                      <LcRow ev={ev} isExp={isExp} grid={gridTemplate} segKey={segCols ? (st.segFilter === 'remote_e2e' ? 'local_e2e' : st.segFilter) : null}
                        onClick={() => setExpanded(isExp ? null : vi.index)} />
                      {isExp && <TimingExpand ev={ev} hubAppP50={ev.hub && D[ev.hub] ? D[ev.hub]!.speed.hub_app.p50 : null} />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Hub picker dropdown — colour-coded status dot per hub (same colours as the
 *  old pills: green/yellow/red by reliability). "All Hubs" = no filter. */
function HubDropdown({ hubs, dotColor, value, onChange }: {
  hubs: string[];
  dotColor: (hub: string) => string;
  value: string | null;
  onChange: (hub: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const dot = (c: string) => (
    <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: c, flexShrink: 0, boxShadow: `0 0 6px ${c}` }} />
  );
  const label = value ? value.toUpperCase() : 'All Hubs';
  return (
    <div style={{ position: 'relative' }}>
      <button className="lc-hub-pill active" onClick={() => setOpen((o) => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', fontSize: 11.5 }}>
        {value ? dot(dotColor(value)) : null}
        <span style={{ fontFamily: value ? 'monospace' : undefined, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 9, color: 'var(--muted)', marginLeft: 2 }}>▾</span>
      </button>
      {open && (<>
        <div style={{ position: 'fixed', inset: 0, zIndex: 98 }} onClick={() => setOpen(false)} />
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 99, minWidth: 230,
          background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 12,
          padding: 6, boxShadow: 'var(--shadow-pop)',
        }}>
          <div
            onClick={() => { onChange(null); setOpen(false); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', borderRadius: 8,
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              color: !value ? '#c7d2fe' : 'var(--text)',
              background: !value ? 'var(--blue-soft)' : 'transparent',
            }}
            onMouseEnter={(e) => { if (value) e.currentTarget.style.background = 'var(--surface)'; }}
            onMouseLeave={(e) => { if (value) e.currentTarget.style.background = 'transparent'; }}>
            All Hubs
          </div>
          {hubs.map((h) => {
            const active = value === h;
            return (
              <div key={h}
                onClick={() => { onChange(h); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', borderRadius: 8,
                  fontSize: 12, fontFamily: 'monospace', fontWeight: 600, cursor: 'pointer',
                  color: active ? '#c7d2fe' : 'var(--text)',
                  background: active ? 'var(--blue-soft)' : 'transparent',
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--surface)'; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
                {dot(dotColor(h))}
                {h.toUpperCase()}
              </div>
            );
          })}
        </div>
      </>)}
    </div>
  );
}

// ── Row layouts ───────────────────────────────────────────────────────────────
const DEFAULT_GRID = '22px 1.5fr 1fr 1.2fr 0.9fr 1.2fr 0.8fr 0.7fr 1.1fr 0.7fr';
const DEFAULT_HEADS = ['', 'Timestamp', 'Hub', 'Use Case', 'Source', 'Device', 'Room', 'Latency', 'Status / Reason', 'Network'];

const SEG_COLS: Record<string, { grid: string; heads: string[] }> = {
  hub_snap: {
    grid: '22px 1.4fr 0.8fr 1fr 1.2fr 0.7fr 1.4fr 1.4fr 0.8fr',
    heads: ['', 'Event Time', 'Hub', 'Triggered By', 'Device', 'Room', 'Hub→Matter CMD', 'Device State Confirmed', 'Round-trip'],
  },
  hub_app: {
    grid: '22px 1.4fr 0.8fr 1fr 1.2fr 0.7fr 1.4fr 1.4fr 0.8fr',
    heads: ['', 'Event Time', 'Hub', 'Triggered By', 'Device', 'Room', 'State Confirmed (snap_ts)', 'App Reflected (ws_conf)', 'Hub→App'],
  },
  local_e2e: {
    grid: '22px 1.3fr 0.8fr 1.1fr 0.7fr 1fr 1.2fr 1.2fr 1.2fr 0.8fr 0.8fr',
    heads: ['', 'App Tap', 'Hub', 'Device', 'Room', 'Use Case', 'CMD Sent', "Hub ACK'd", 'App Updated', 'Hub→App', 'Total E2E'],
  },
};

function LcRow({ ev, isExp, grid, segKey, onClick }: {
  ev: PoolEvent; isExp: boolean; grid: string; segKey: string | null; onClick: () => void;
}) {
  const rowCls = ev.status === 'fail' ? 'lc-row-fail' : ev.status === 'slow' || ev.status === 'warn' ? 'lc-row-slow' : 'lc-row-ok';
  const latColor = ev.status === 'fail' || ev.status === 'slow' ? 'var(--red)' : ev.status === 'warn' ? 'var(--yellow)' : 'var(--green)';
  const latDisp = ev.lat && ev.lat !== 'N/A' ? `${ev.lat}ms` : '—';
  const dev = devShort(ev.dev);
  const mono: React.CSSProperties = { fontFamily: 'monospace', fontSize: 10, whiteSpace: 'nowrap', color: 'var(--muted)' };
  const hubPill = (
    <span style={{ fontSize: 10, background: 'var(--surface2)', padding: '2px 7px', borderRadius: 4, fontWeight: 600 }}>
      {(ev.hub || '—').toUpperCase()}
    </span>
  );
  const chev = <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 11, userSelect: 'none' }}>{isExp ? '▾' : '▸'}</div>;

  let cells: React.ReactNode;
  if (segKey === 'hub_snap' || segKey === 'hub_app') {
    const isHA = segKey === 'hub_app';
    const haLat = ev.hub_app_lat != null ? `${ev.hub_app_lat}ms` : '—';
    const haC = (ev.hub_app_lat ?? 0) > 200 ? 'var(--yellow)' : 'var(--green)';
    cells = (<>
      {chev}
      <div style={mono}>{ev.ts || '—'}</div>
      <div>{hubPill}</div>
      <div style={{ fontSize: 11 }}>{ev.uc || '—'}</div>
      <div style={{ fontFamily: 'monospace', fontSize: 10 }}>{dev}</div>
      <div style={{ fontSize: 11 }}>{ev.room || '—'}</div>
      <div style={{ ...mono, fontSize: 9 }}>{isHA ? (ev.snap_ts || '—') : (ev.matter_ts || '—')}</div>
      <div style={{ ...mono, fontSize: 9 }}>{isHA ? (ev.ws_conf || ev.snap_ts || '—') : (ev.snap_ts || '—')}</div>
      <div style={{ fontWeight: 700, color: isHA ? haC : latColor, fontSize: isHA ? 12 : 13 }}>{isHA ? haLat : latDisp}</div>
    </>);
  } else if (segKey === 'local_e2e') {
    const haLat = ev.hub_app_lat != null ? `${ev.hub_app_lat}ms` : '—';
    const haC = (ev.hub_app_lat ?? 0) > 500 ? 'var(--red)' : (ev.hub_app_lat ?? 0) > 200 ? 'var(--yellow)' : 'var(--green)';
    cells = (<>
      {chev}
      <div style={{ ...mono, fontSize: 9 }}>{ev.ts || '—'}</div>
      <div>{hubPill}</div>
      <div style={{ fontFamily: 'monospace', fontSize: 10 }}>{dev}</div>
      <div style={{ fontSize: 11 }}>{ev.room || '—'}</div>
      <div style={{ fontSize: 11 }}>{ev.uc || '—'}</div>
      <div style={{ ...mono, fontSize: 9 }}>{ev.cmd_sent || '—'}</div>
      <div style={{ ...mono, fontSize: 9 }}>{ev.rest_resp || '—'}</div>
      <div style={{ ...mono, fontSize: 9 }}>{ev.ws_conf || '—'}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: haC }}>{haLat}</div>
      <div style={{ fontWeight: 700, color: latColor, fontSize: 13 }}>{latDisp}</div>
    </>);
  } else {
    const statusCell = ev.status === 'fail'
      ? <span className="tag tag-red">{ev.reason || 'FAILED'}</span>
      : ev.status === 'slow' || ev.status === 'warn'
        ? <span className="tag tag-yellow">SLOW</span>
        : <span className="tag tag-green">OK</span>;
    cells = (<>
      {chev}
      <div style={mono}>{ev.ts || '—'}</div>
      <div>{hubPill}</div>
      <div style={{ fontSize: 11 }}>{ev.uc || '—'}</div>
      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{ev.src || '—'}</div>
      <div style={{ fontFamily: 'monospace', fontSize: 10 }}>{dev}</div>
      <div style={{ fontSize: 11 }}>{ev.room || '—'}</div>
      <div style={{ fontWeight: 700, color: latColor, fontSize: 13 }}>{latDisp}</div>
      <div>{statusCell}</div>
      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{ev.net || '—'}</div>
    </>);
  }

  return (
    <div className={`lcv-row lc-row ${rowCls}${isExp ? ' lc-expanded' : ''}`} style={{ gridTemplateColumns: grid }} onClick={onClick}>
      {cells}
    </div>
  );
}

// ── Expanded timing pipeline (ported from buildTimingExpand) ─────────────────
function TpField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="tp-field">
      <div className="tp-field-label">{label}</div>
      <div className="tp-field-val">{value || '—'}</div>
    </div>
  );
}

function TpSeg({ ms, label, status }: { ms: number | null; label: string; status: string }) {
  return (
    <div className="tp-seg">
      <div className={`tp-seg-ms ${status}`}>{ms !== null ? `${ms}ms` : '—'}</div>
      <div className={`tp-seg-line ${status}`} />
      <div className="tp-seg-label">{label}</div>
    </div>
  );
}

function TimingExpand({ ev, hubAppP50 }: { ev: PoolEvent; hubAppP50: number | null }) {
  if (ev.status === 'fail') {
    return (
      <div className="timing-pipeline-wrap">
        <div className="tp-fail-banner">
          <div className="tp-fail-reason">{ev.reason || 'FAILED'}</div>
          <div className="tp-fail-meta">{ev.ts} · {ev.uc} · {ev.src}</div>
        </div>
        <div className="tp-fields">
          <TpField label="Timestamp" value={ev.ts} />
          <TpField label="Hub" value={ev.hub?.toUpperCase()} />
          <TpField label="Use Case" value={ev.uc} />
          <TpField label="Device" value={ev.dev} />
          <TpField label="Room" value={ev.room} />
          <TpField label="Source" value={ev.src} />
          <TpField label="Latency" value={ev.lat && ev.lat !== 'N/A' ? `${ev.lat}ms` : 'N/A'} />
          <TpField label="Network" value={ev.net} />
          {ev.dock && ev.dock !== '—' ? <TpField label="Dock" value={ev.dock} /> : null}
          <TpField label="Failure Reason" value={<span className="tag tag-red">{ev.reason || '—'}</span>} />
        </div>
      </div>
    );
  }
  if (ev.hasTiming && (ev.segType === 'local_e2e' || ev.segType === 'remote_e2e')) {
    const s1 = msDiff(ev.tap, ev.cmd_sent);
    const s2 = msDiff(ev.cmd_sent, ev.rest_resp);
    const s3 = msDiff(ev.rest_resp, ev.ws_conf);
    const total = parseFloat(String(ev.lat)) || 0;
    const ss1 = segStatus(s1), ss2 = segStatus(s2), ss3 = segStatus(s3);
    const lastDot = total > 1000 ? 'tp-slow' : total > 800 ? 'tp-warn' : 'tp-ok';
    const network = ev.segType === 'remote_e2e' ? 'Remote via Internet' : 'Local via Wi-Fi';
    return (
      <div className="timing-pipeline-wrap">
        <div className="tp-title">End-to-End Request Flow · {network} · Total: {total}ms</div>
        <div className="timing-pipeline">
          <div className="tp-node"><div className={`tp-node-dot ${ss1}`} /><div className="tp-node-label">App Tap</div></div>
          <TpSeg ms={s1} label="App Sends CMD" status={ss1} />
          <div className="tp-node"><div className={`tp-node-dot ${ss2}`} /><div className="tp-node-label">CMD Sent</div></div>
          <TpSeg ms={s2} label="App→Hub Transit" status={ss2} />
          <div className="tp-node"><div className={`tp-node-dot ${ss3}`} /><div className="tp-node-label">Hub ACK'd</div></div>
          <TpSeg ms={s3} label="Hub→Device→App" status={ss3} />
          <div className="tp-node"><div className={`tp-node-dot ${lastDot}`} /><div className="tp-node-label">App Updated</div></div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, padding: '8px 12px', fontSize: 10, color: 'var(--muted)', marginTop: 10, lineHeight: 1.7 }}>
          <strong style={{ color: '#fafafa' }}>Segment breakdown:</strong><br />
          <strong>App Sends CMD ({s1 !== null ? `${s1}ms` : '—'}):</strong> App processes tap and dispatches REST command<br />
          <strong>App→Hub Transit ({s2 !== null ? `${s2}ms` : '—'}):</strong> Command travels to hub · Hub receives and ACKs<br />
          <strong>Hub→Device→App ({s3 !== null ? `${s3}ms` : '—'}):</strong> Hub → SNAP device (Thread mesh) → Device activates → State reflected to hub → Hub pushes state to app via WebSocket
        </div>
        <div className="tp-fields" style={{ marginTop: 10 }}>
          <TpField label="Device" value={ev.dev} />
          <TpField label="Room" value={ev.room} />
          <TpField label="Network" value={ev.net} />
          <TpField label="Use Case" value={ev.uc} />
          {ev.hub_app_lat != null ? (
            <TpField label="Hub→App WS Push" value={
              <strong style={{ color: ev.hub_app_lat > 500 ? 'var(--red)' : ev.hub_app_lat > 200 ? 'var(--yellow)' : 'var(--green)' }}>
                {ev.hub_app_lat}ms
              </strong>} />
          ) : null}
        </div>
      </div>
    );
  }
  if (ev.hasTiming && ev.segType === 'hub_snap') {
    const s1 = msDiff(ev.ts, ev.matter_ts ?? null);
    const s2 = msDiff(ev.matter_ts ?? null, ev.snap_ts ?? null);
    const total = parseFloat(String(ev.lat)) || 0;
    const ss1 = segStatus(s1), ss2 = segStatus(s2);
    return (
      <div className="timing-pipeline-wrap">
        <div className="tp-title">Hub → SNAP Device → Hub Flow · Total: {total}ms</div>
        <div className="timing-pipeline">
          <div className="tp-node"><div className="tp-node-dot tp-ok" /><div className="tp-node-label">Hub Issues CMD</div></div>
          <TpSeg ms={s1} label="Hub→Thread Mesh" status={ss1} />
          <div className="tp-node"><div className={`tp-node-dot ${ss1}`} /><div className="tp-node-label">Matter CMD Sent</div></div>
          <TpSeg ms={s2} label="Device Activates + State Reflects" status={ss2} />
          <div className="tp-node">
            <div className={`tp-node-dot ${total > 800 ? 'tp-slow' : 'tp-ok'}`} />
            <div className="tp-node-label">State Confirmed at Hub<br /><span style={{ color: 'var(--blue)', fontSize: 8 }}>→ WS push to App starts here</span></div>
          </div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, padding: '8px 12px', fontSize: 10, color: 'var(--muted)', marginTop: 10, lineHeight: 1.7 }}>
          <strong style={{ color: '#fafafa' }}>Flow:</strong> Hub issues Matter command → Thread mesh transit → SNAP device activates → State change reflected back to hub<br />
          <strong>Hub→Thread Mesh ({s1 !== null ? `${s1}ms` : '—'}):</strong> Hub dispatches Matter protocol command<br />
          <strong>Device Activates ({s2 !== null ? `${s2}ms` : '—'}):</strong> SNAP device receives, activates, and reflects state back to hub<br />
          <strong style={{ color: 'var(--blue)' }}>After this point:</strong> Hub immediately pushes state to app via WebSocket (~{hubAppP50 ? `${hubAppP50}ms` : '—'} average)
        </div>
        <div className="tp-fields" style={{ marginTop: 10 }}>
          <TpField label="Device" value={ev.dev} />
          <TpField label="Room" value={ev.room} />
          <TpField label="Use Case" value={ev.uc} />
        </div>
      </div>
    );
  }
  return (
    <div className="timing-pipeline-wrap">
      <div className="tp-fields">
        <TpField label="Timestamp" value={ev.ts} />
        <TpField label="Hub" value={ev.hub?.toUpperCase()} />
        <TpField label="Use Case" value={ev.uc} />
        <TpField label="Source" value={ev.src} />
        <TpField label="Device" value={ev.dev} />
        <TpField label="Room" value={ev.room} />
        <TpField label="Latency" value={ev.lat ? `${ev.lat}ms` : '—'} />
        <TpField label="Network" value={ev.net} />
      </div>
    </div>
  );
}
