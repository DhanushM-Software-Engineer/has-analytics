/** Per-day drill-down shared by the daily / P50-P95 / North Star / failures /
 *  Avg-SD charts — ported from showDayDebug (focus-aware tiles, null-safe). */
import type { ReactNode } from 'react';
import { useDash } from '../state/DashboardContext';
import { buildEventPool, type DailyAgg, type PoolEvent } from '../lib/pool';
import { relColor, fmtOrDash } from '../lib/format';
import { EventTable, type EvCol } from '../components/common';

export type DayFocus = 'events' | 'reliability' | 'ns' | 'speed';

function MetricCard({ label, val, color, subText, targetNode }: { label: string; val: ReactNode; color?: string; subText?: ReactNode; targetNode?: ReactNode }) {
  return (
    <div style={{ flex: 1, position: 'relative', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#fafafa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>{label}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: color || '#fafafa', lineHeight: 1 }}>{val}</div>
          {targetNode && <div>{targetNode}</div>}
        </div>
      </div>
      {subText && (
        <div style={{ marginTop: 12, fontSize: 11, color: 'var(--muted)' }}>{subText}</div>
      )}
    </div>
  );
}

export function useShowDayDebug(hub: string) {
  const dash = useDash();
  const d = dash.D[hub];

  return (day: DailyAgg | undefined, focus: DayFocus) => {
    if (!day || !d) return;
    const nsC = (day.ns || 0) >= 95 ? 'var(--green)' : (day.ns || 0) >= 80 ? 'var(--yellow)' : 'var(--red)';
    const relC = relColor(day.rel);
    const pool = buildEventPool(hub, d);
    const dayAll = pool.filter((e) => (e.ts || '').startsWith(day.date));
    const dayFails = dayAll.filter((e) => e.status === 'fail');
    const dayNsMiss = dayAll.filter((e) => parseFloat(String(e.lat ?? 0)) > 1000);

    const goLc = (tab: 'all' | 'failures' | 'slow', label: string, desc?: string) =>
      dash.openLogCenter({ hub, tab, filters: { search: day.date }, context: { label, ...(desc ? { desc } : {}) } });

    const renderUnifiedModal = (
      title: string,
      cards: ReactNode,
      logsTitle: string,
      logsSub: string,
      onLc: () => void,
      rawRows: PoolEvent[],
      emptyMsg: string,
      note?: ReactNode,
      btnClass = 'card-btn-view'
    ) => {
      const rows = rawRows.slice(0, 20).map(e => {
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
        
        const s = e.status?.toLowerCase() || 'ok';
        let statusTag = <span className="tag">{e.status?.toUpperCase() || 'OK'}</span>;
        if (s === 'ok') statusTag = <span className="tag tag-green">OK</span>;
        if (s === 'fail' || s === 'failed') statusTag = <span className="tag tag-red">FAILED</span>;
        if (s === 'slow' || s === 'warn') statusTag = <span className="tag tag-yellow">SLOW</span>;

        return { ...e, fmtDate, fmtTime, status: statusTag };
      });

      const UNIFIED_COLS: EvCol[] = [
        { key: 'fmtDate', label: 'Date' },
        { key: 'fmtTime', label: 'Time' },
        { key: 'uc', label: 'Use Case' },
        { key: 'dev', label: 'Device' },
        { key: 'room', label: 'Room' },
        { key: 'floor', label: 'Floor' },
        { key: 'lat', label: 'Latency' },
        { key: 'reason', label: 'Failed Reason' },
        { key: 'status', label: 'State' }
      ];

      const customTitle = (
        <div style={{ textAlign: 'left', lineHeight: 1.2 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '1px', marginBottom: 8, fontWeight: 400 }}>LOG VIEW</div>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.3px', marginBottom: 8 }}>{title}</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400 }}>{day.date}</div>
        </div>
      );

      const customBody = (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          
          <div style={{ display: 'flex', gap: 16, width: '100%', marginBottom: 24, flexWrap: 'wrap' }}>
            {cards}
          </div>

          <hr style={{ width: '100%', border: 0, borderTop: '1px solid var(--border)', margin: '0 0 20px 0' }} />

          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px', width: '100%', textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{logsTitle}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{logsSub}</div>
              </div>
              <button className={btnClass} style={{ padding: '6px 14px', fontSize: 11 }} onClick={onLc}>VIEW</button>
            </div>
            
            {note && <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 12 }}>{note}</div>}

            {rows.length
              ? <EventTable 
                  events={rows as unknown as Record<string, unknown>[]} 
                  cols={UNIFIED_COLS} 
                />
              : <div className="dbg-empty">{emptyMsg}</div>}
          </div>
        </div>
      );

      dash.showModal(customTitle, customBody);
    };

    if (focus === 'events') {
      const sortedRows = [...dayAll].sort((a, b) => {
        const r = (s: string) => (s === 'fail' ? 0 : s === 'slow' ? 1 : s === 'warn' ? 2 : 3);
        return r(a.status) - r(b.status);
      });
      const hubCount = dayAll.filter(e => e.src === 'direct_hub' || e.src === 'direct_hub_ui').length;
      const appCount = dayAll.filter(e => e.src === 'app').length;
      const dockCount = dayAll.filter(e => e.src === 'docklet').length;
      
      renderUnifiedModal(
        'DAILY EVENTS & RELIABILITY',
        <>
          <MetricCard 
            label="Total Events" 
            val={day.total.toLocaleString()} 
            subText={`App ${appCount} \u00B7 Dock ${dockCount} \u00B7 Hub ${hubCount}`}
          />
          <MetricCard 
            label="Failures" 
            val={dayFails.length.toLocaleString()} 
            color="var(--red)" 
          />
          <MetricCard 
            label="Reliability" 
            val={fmtOrDash(day.rel, '%')} 
            color={relC} 
            targetNode={<span style={{ fontSize: 11, color: 'var(--muted)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 12, padding: '4px 10px', fontWeight: 600, letterSpacing: '.3px', whiteSpace: 'nowrap' }}>Target &ge; 97%</span>} 
          />
        </>,
        'LOGS',
        `Sampled ${Math.min(20, sortedRows.length)} logs`,
        () => goLc('all', `DAILY EVENTS & RELIABILITY -> DATE: ${day.date}, EVENTS: ${day.total}`),
        sortedRows,
        `No sampled events found for ${day.date}.`
      );
    } else if (focus === 'reliability') {
      const hubFails = dayFails.filter(e => e.src === 'direct_hub' || e.src === 'direct_hub_ui').length;
      const appFails = dayFails.filter(e => e.src === 'app').length;
      const dockFails = dayFails.filter(e => e.src === 'docklet').length;
      renderUnifiedModal(
        'FAILURES TREND',
        <>
          <MetricCard label="Total Events" val={day.total.toLocaleString()} />
          <MetricCard label="Failed" val={dayFails.length.toLocaleString()} color="var(--red)" />
          <MetricCard label="Hub" val={hubFails.toLocaleString()} color="var(--red)" />
          <MetricCard label="App" val={appFails.toLocaleString()} color="var(--red)" />
          <MetricCard label="Dock" val={dockFails.toLocaleString()} color="var(--red)" />
        </>,
        'LOGS',
        `Sampled ${Math.min(20, dayFails.length)} logs`,
        () => goLc('failures', `FAILURES TREND -> DATE: ${day.date}, TOTAL FAILURES: ${dayFails.length}, HUB FAILED: ${hubFails}, APP FAILED: ${appFails}, DOCK FAILED: ${dockFails}`),
        dayFails,
        `No failures in sample for ${day.date}.`,
        undefined,
        'card-btn-view-red'
      );
    } else if (focus === 'ns') {
      const nsSuccess = Math.round(day.total * ((day.ns || 0) / 100));
      renderUnifiedModal(
        'NORTH STAR TREND',
        <>
          <MetricCard label="Total Events" val={day.total.toLocaleString()} />
          <MetricCard label="Events Under 1 Sec" val={nsSuccess.toLocaleString()} color="#fafafa" />
          <MetricCard label="North Star" val={day.ns != null ? (+day.ns).toFixed(1) + '%' : '—'} color={nsC} targetNode={<span style={{ fontSize: 11, color: 'var(--muted)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 12, padding: '4px 10px', fontWeight: 600, letterSpacing: '.3px', whiteSpace: 'nowrap' }}>Target &ge; 95%</span>} />
        </>,
        'LOGS',
        `Sampled ${Math.min(20, dayNsMiss.length)} logs`,
        () => goLc('slow', `NORTH STAR TREND -> DATE: ${day.date}, TOTAL EVENTS: ${day.total}, EVENTS UNDER 1 SEC: ${nsSuccess}`),
        dayNsMiss,
        `No >1s events in sample for ${day.date}.`
      );
    } else {
      const timed = dayAll
        .filter((e) => { const l = parseFloat(String(e.lat)); return !isNaN(l) && l > 0; })
        .sort((a, b) => parseFloat(String(b.lat ?? 0)) - parseFloat(String(a.lat ?? 0)));
      renderUnifiedModal(
        'P50 & P95 LATENCY TREND',
        <>
          <MetricCard label="P50" val={fmtOrDash(day.p50, 'ms')} color={(day.p50 ?? 0) > 800 ? 'var(--yellow)' : '#fafafa'} />
          <MetricCard label="P95" val={fmtOrDash(day.p95, 'ms')} />
          <MetricCard label="Avg" val={fmtOrDash(day.avg != null ? Math.round(day.avg) : null, 'ms')} />
        </>,
        'LOGS',
        `Sampled ${Math.min(20, timed.length)} logs (slowest first)`,
        () => {
          const p50Events = dayAll.filter(e => parseFloat(String(e.lat)) <= (day.p50 || 0)).length;
          const p95Events = dayAll.filter(e => parseFloat(String(e.lat)) <= (day.p95 || 0)).length;
          goLc('all', `P50 & P95 SPEED TREND -> DATE: ${day.date}, P50 EVENTS: ${p50Events}, P95 EVENTS: ${p95Events}`);
        },
        timed,
        `No timed events in sample for ${day.date}.`
      );
    }
  };
}
