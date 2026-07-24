/** Log Center — event-level debugging workspace. Ported 1:1 from the vanilla
 *  version (tabs, hub pills, filters, context banner, segment-aware columns,
 *  expandable timing pipeline) but with VIRTUALIZED rows so tens of thousands
 *  of events render smoothly (the at-scale requirement). */
import { useMemo, useRef, useState, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useDash, type LcOpts } from '../state/DashboardContext';
import { buildEventPool, srcPred, evDow, evHour, type PoolEvent } from '../lib/pool';
import { msDiff, segStatus, devShort } from '../lib/format';
import { SearchableSelect } from '../components/common';

const FilterIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#c7d2fe' }}>
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
  </svg>
);

function HeaderFilter({ label, value, onChange, options }: { label: string; value: string | null; onChange: (v: string) => void; options: {label: string; value: string}[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} onClick={() => setOpen(!open)}>
      <span>{label}</span>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: value ? '#fff' : 'var(--muted)' }}>
        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
      </svg>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 100,
          background: 'var(--surface2)', border: '1px solid var(--border2)',
          borderRadius: 8, padding: 6, minWidth: 120, boxShadow: 'var(--shadow-pop)',
          display: 'flex', flexDirection: 'column', gap: 2, cursor: 'default'
        }} onClick={e => e.stopPropagation()}>
          <div onClick={() => { onChange(''); setOpen(false); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 4,
              cursor: 'pointer', fontSize: 11, fontWeight: !value ? 600 : 400,
              color: !value ? '#fff' : 'var(--muted)', background: !value ? 'var(--blue-soft)' : 'transparent', textTransform: 'none'
            }}
          >
            <div style={{ width: 14, height: 14, borderRadius: '50%', border: !value ? '2px solid #fff' : '2px solid var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {!value && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1' }} />}
            </div>
            Default
          </div>
          {options.map(opt => (
            <div key={opt.value} onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 4,
                cursor: 'pointer', fontSize: 11, fontWeight: value === opt.value ? 600 : 400,
                color: value === opt.value ? '#fff' : 'var(--muted)', background: value === opt.value ? 'var(--blue-soft)' : 'transparent', textTransform: 'none'
              }}
            >
              <div style={{ width: 14, height: 14, borderRadius: '50%', border: value === opt.value ? '2px solid #fff' : '2px solid var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {value === opt.value && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1' }} />}
              </div>
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
  dateSort: 'latest' | 'oldest' | null;
  timeSort: 'recent' | 'past' | null;
  latSort: 'fast' | 'slow' | null;
  reasonFilterMode: 'most' | 'least' | null;
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
    dateSort: null,
    timeSort: null,
    latSort: null,
    reasonFilterMode: null,
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

    if (st.tab === 'failures') all = all.filter((e) => e.status === 'fail');
    else if (st.tab === 'slow') all = all.filter((e) => e.status === 'slow' || e.status === 'warn');

    const pred = st.srcFilter ? srcPred(st.srcFilter) : null;
    const src = st.src.toLowerCase(), reason = st.reason.toLowerCase(), search = st.search.toLowerCase();
    let filtered = all.filter((e) => {
        if (pred && !pred(e)) return false;
        if (st.ucFilter && !(e.uc || '').toLowerCase().includes(st.ucFilter.toLowerCase())) return false;
        if (st.segFilter) {
          if (st.segFilter === 'hub_app') { if (e.hub_app_lat == null) return false; }
          else if (st.segFilter === 'hub_snap') { if (e.segType !== 'hub_snap_hub' as any) return false; }
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
        if (search && !`${e.ts} ${e.dev} ${e.room} ${e.uc} ${e.hub} ${e.dock || ''}`.toLowerCase().includes(search)) return false;
        return true;
      });

      if (st.reasonFilterMode) {
        const freqs: Record<string, number> = {};
        for (const e of filtered) {
          if (e.reason) freqs[e.reason] = (freqs[e.reason] || 0) + 1;
        }
        const sortedReasons = Object.entries(freqs).sort((a, b) => b[1] - a[1]);
        if (sortedReasons.length > 0) {
          const targetReason = st.reasonFilterMode === 'most' ? sortedReasons[0]![0] : sortedReasons[sortedReasons.length - 1]![0];
          filtered = filtered.filter(e => e.reason === targetReason);
        }
      }

      filtered.sort((a, b) => {
        if (st.latSort) {
          const la = parseFloat(String(a.lat)) || Infinity;
          const lb = parseFloat(String(b.lat)) || Infinity;
          if (la !== lb) return st.latSort === 'fast' ? la - lb : lb - la;
        }
        const dir = (st.dateSort === 'oldest' || st.timeSort === 'past') ? 1 : -1;
        return (a.ts || '').localeCompare(b.ts || '') * dir;
      });

      return filtered;
  }, [D, st]);

  const clearFilters = () => {
    setSt((s) => ({ ...s, hub: null, src: '', reason: '', search: '', context: null, srcFilter: null, ucFilter: null, segFilter: null, latMin: null, latMax: null, hourFilter: null, dayFilter: null, dateSort: null, timeSort: null, latSort: null, reasonFilterMode: null }));
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

  const allEvents = useMemo(() => {
    const hList = Object.keys(D);
    let all: PoolEvent[] = [];
    hList.forEach((h) => { const d = D[h]; if (d) all = all.concat(buildEventPool(h, d)); });
    all.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
    return all;
  }, [D]);

  const devRoomOptions = useMemo(() => {
    const set = new Set<string>();
    allEvents.forEach(e => {
       if (e.dev && e.dev !== '—') set.add(e.dev);
       if (e.room && e.room !== '—') set.add(e.room);
    });
    return Array.from(set).map(x => ({ label: x, value: x })).sort((a,b) => a.label.localeCompare(b.label));
  }, [allEvents]);

  const hubOptions = Object.keys(D).map(h => ({ label: h.toUpperCase(), value: h }));
  
  const srcOptions = [
    { label: 'App Control (Local)', value: 'app' },
    { label: 'Remote App', value: 'remote' },
    { label: 'Dock Control', value: 'docklet' },
    { label: 'Hub (Direct / Scene / Automation)', value: 'direct' }
  ];

  const reasonOptions = [
    { label: 'TIMEOUT', value: 'TIMEOUT' },
    { label: 'NO_RESPONSE', value: 'NO_RESPONSE' },
    { label: 'DEVICE_OFFLINE', value: 'DEVICE_OFFLINE' },
    { label: 'DEVICE_UNAVAILABLE', value: 'DEVICE_UNAVAILABLE' },
    { label: 'THREAD_MESH_FAIL', value: 'THREAD_MESH_FAIL' },
  ];

  const origin = dash.view.kind === 'logcenter' ? dash.view.origin : null as any;

  return (
    <div style={{ padding: '20px 28px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          {origin && (
            <div style={{ paddingTop: 2 }}>
              <button className="btn" onClick={dash.lcGoBack} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '5px 12px' }}>
                <span style={{ fontSize: 14, lineHeight: 1 }}>←</span>
              </button>
            </div>
          )}
          <div>
            <h2 style={{ fontSize: 17, color: '#fafafa', fontWeight: 700, letterSpacing: '-.3px', textTransform: 'uppercase', margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
              LOG CENTER
            </h2>
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button 
            onClick={() => { setSt(s => ({ ...s, tab: 'all' })); setExpanded(null); }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: `1px solid var(--border)`, borderRadius: 20, padding: '6px 14px', fontSize: 11, fontWeight: 500, cursor: 'pointer', opacity: st.tab === 'all' ? 1 : 0.5 }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface2)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--muted)', display: 'inline-block' }} />
            <span style={{ color: 'var(--text)' }}>ALL EVENTS</span>
          </button>
          <button 
            onClick={() => { setSt(s => ({ ...s, tab: 'slow' })); setExpanded(null); }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: `1px solid var(--yellow)`, borderRadius: 20, padding: '6px 14px', fontSize: 11, fontWeight: 500, cursor: 'pointer', opacity: st.tab === 'slow' ? 1 : 0.5 }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(234, 179, 8, 0.25)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--yellow)', display: 'inline-block' }} />
            <span style={{ color: 'var(--yellow)' }}>SLOW EVENTS</span>
          </button>
          <button 
            onClick={() => { setSt(s => ({ ...s, tab: 'failures' })); setExpanded(null); }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: `1px solid var(--red)`, borderRadius: 20, padding: '6px 14px', fontSize: 11, fontWeight: 500, cursor: 'pointer', opacity: st.tab === 'failures' ? 1 : 0.5 }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.25)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--red)', display: 'inline-block' }} />
            <span style={{ color: 'var(--red)' }}>FAILED EVENTS</span>
          </button>
        </div>
      </div>

      {hasFilter && (
        <div className="lc-context-banner" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FilterIcon />
            <div className="lc-context-label">FILTER</div>
            <div className="lc-context-desc" style={{ marginLeft: 10, marginTop: 0 }}>
              {st.context?.label || (filterParts.length ? `Filter: ${filterParts.join(' · ')}` : '')}
            </div>
          </div>
        </div>
      )}

      <div style={{ background: 'rgba(0,0,0,0.4)', borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>LOGS</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <SearchableSelect label="HUBS" value={st.hub || ''} onChange={v => { setSt(s => ({ ...s, hub: v || null })); setExpanded(null); }} options={hubOptions} />
            <SearchableSelect label="SOURCE" value={st.src || ''} onChange={v => { setSt(s => ({ ...s, src: v })); setExpanded(null); }} options={srcOptions} />
            <SearchableSelect label="FAILED REASON" value={st.reason || ''} onChange={v => { setSt(s => ({ ...s, reason: v })); setExpanded(null); }} options={reasonOptions} />
            <SearchableSelect label="DEVICE, ROOM, FLOOR" value={st.search || ''} onChange={v => { setSt(s => ({ ...s, search: v })); setExpanded(null); }} options={devRoomOptions} />
            <button className="card-btn-view-red" onClick={clearFilters}>CLEAR</button>
          </div>
        </div>

        <div>
          {events.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '56px 20px', color: 'var(--muted)', fontSize: 12 }}>
              No events match the current filters.
            </div>
          ) : (
            <div ref={parentRef} style={{ overflowY: 'auto', overflowX: 'auto', maxHeight: 620 }}>
              <div className="lcv-head" style={{ gridTemplateColumns: gridTemplate, minWidth: 900 }}>
                {(segCols ? segCols.heads : DEFAULT_HEADS).map((h, i) => {
                  if (h === 'DATE') return <div key={i}><HeaderFilter label="DATE" value={st.dateSort || ''} onChange={v => setSt(s => ({ ...s, dateSort: (v || null) as any }))} options={[{label: 'LATEST', value: 'latest'}, {label: 'OLDEST', value: 'oldest'}]} /></div>;
                  if (h === 'TIME') return <div key={i}><HeaderFilter label="TIME" value={st.timeSort || ''} onChange={v => setSt(s => ({ ...s, timeSort: (v || null) as any }))} options={[{label: 'RECENT', value: 'recent'}, {label: 'PAST', value: 'past'}]} /></div>;
                  if (h === 'LATENCY') return <div key={i}><HeaderFilter label="LATENCY" value={st.latSort || ''} onChange={v => setSt(s => ({ ...s, latSort: (v || null) as any }))} options={[{label: 'FAST', value: 'fast'}, {label: 'SLOW', value: 'slow'}]} /></div>;
                  if (h === 'FAILED REASON') return <div key={i}><HeaderFilter label="FAILED REASON" value={st.reasonFilterMode || ''} onChange={v => setSt(s => ({ ...s, reasonFilterMode: (v || null) as any }))} options={[{label: 'MOST', value: 'most'}, {label: 'LEAST', value: 'least'}]} /></div>;
                  return <div key={i}>{h}</div>;
                })}
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


// ── Row layouts ───────────────────────────────────────────────────────────────
const DEFAULT_GRID = '22px 0.7fr 0.7fr 1fr 1fr 1.2fr 0.8fr 0.6fr 0.8fr 0.8fr 1.1fr 0.7fr';
const DEFAULT_HEADS = ['', 'DATE', 'TIME', 'HUB', 'USE CASE', 'DEVICE', 'ROOM', 'FLOOR', 'LATENCY', 'STATE', 'FAILED REASON', 'NETWORK'];

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
  const chev = <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 11, userSelect: 'none' }}>{isExp ? '▼' : '▶'}</div>;

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
    let dateStr = '—', timeStr = '—';
    if (ev.ts) {
      const d = new Date(ev.ts);
      if (!isNaN(d.getTime())) {
        dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\//g, '-');
        timeStr = d.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }
    }

    const statusCell = ev.status === 'fail'
      ? <span className="tag tag-red">FAILED</span>
      : ev.status === 'slow' || ev.status === 'warn'
        ? <span className="tag tag-yellow">SLOW</span>
        : <span className="tag tag-green">OK</span>;

    cells = (<>
      {chev}
      <div style={mono}>{dateStr}</div>
      <div style={mono}>{timeStr}</div>
      <div>{hubPill}</div>
      <div style={{ fontSize: 11 }}>{ev.uc || '—'}</div>
      <div style={{ fontFamily: 'monospace', fontSize: 10 }}>{dev}</div>
      <div style={{ fontSize: 11 }}>{ev.room || '—'}</div>
      <div style={{ fontSize: 11 }}>—</div>
      <div style={{ fontWeight: 700, color: latColor, fontSize: 13 }}>{latDisp}</div>
      <div>{statusCell}</div>
      <div style={{ fontSize: 10, color: 'var(--text)' }}>{ev.reason || '—'}</div>
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
