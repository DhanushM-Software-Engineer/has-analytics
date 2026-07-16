/** Per-day drill-down shared by the daily / P50-P95 / North Star / failures /
 *  Avg-SD charts — ported from showDayDebug (focus-aware tiles, null-safe). */
import type { ReactNode } from 'react';
import { useDash } from '../state/DashboardContext';
import { buildEventPool, type DailyAgg, type PoolEvent } from '../lib/pool';
import { relColor, fmtOrDash } from '../lib/format';
import { EventTable, type EvCol } from '../components/common';

export type DayFocus = 'events' | 'reliability' | 'ns' | 'speed';

const COLS: EvCol[] = [
  { key: 'ts', label: 'Time' }, { key: 'uc', label: 'Use Case' }, { key: 'dev', label: 'Device' },
  { key: 'room', label: 'Room' }, { key: 'src', label: 'Source' }, { key: 'lat', label: 'Latency' },
  { key: 'reason', label: 'Reason' },
];

function Tile({ label, val, color }: { label: string; val: ReactNode; color?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 100, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px' }}>
      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.6px', color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || '#e8edf5' }}>{val}</div>
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

    const goLc = (tab: 'all' | 'failures' | 'slow', label: string, desc: string) =>
      dash.openLogCenter({ hub, tab, filters: { search: day.date }, context: { label, desc } });

    let tiles: ReactNode;
    if (focus === 'reliability') {
      tiles = (<>
        <Tile label="Total Events" val={day.total} />
        <Tile label="Reliability" val={fmtOrDash(day.rel, '%')} color={relC} />
        <Tile label="Failed" val={dayFails.length} color="var(--red)" />
      </>);
    } else if (focus === 'ns') {
      tiles = (<>
        <Tile label="Total Events" val={day.total} />
        <Tile label="North Star" val={day.ns != null ? (+day.ns).toFixed(1) + '%' : '—'} color={nsC} />
        <Tile label="Events >1s" val={dayNsMiss.length} color="var(--yellow)" />
      </>);
    } else if (focus === 'speed') {
      tiles = (<>
        <Tile label="Total Events" val={day.total} />
        <Tile label="P50" val={fmtOrDash(day.p50, 'ms')} color={(day.p50 ?? 0) > 800 ? 'var(--yellow)' : '#e8edf5'} />
        <Tile label="P95" val={fmtOrDash(day.p95, 'ms')} />
        <Tile label="Avg" val={fmtOrDash(day.avg != null ? Math.round(day.avg) : null, 'ms')} />
      </>);
    } else {
      tiles = (<>
        <Tile label="Total Events" val={day.total} />
        <Tile label="Reliability" val={fmtOrDash(day.rel, '%')} color={relC} />
        <Tile label="P50 Latency" val={fmtOrDash(day.p50, 'ms')} color={(day.p50 ?? 0) > 800 ? 'var(--yellow)' : '#e8edf5'} />
        <Tile label="North Star" val={day.ns != null ? (+day.ns).toFixed(1) + '%' : '—'} color={nsC} />
      </>);
    }
    const statBar = <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>{tiles}</div>;

    const section = (title: string, rows: PoolEvent[], lcLabel: string, onLc: () => void, note?: ReactNode, empty?: string) => (
      <div className="dbg-section">
        <div className="dbg-section-hdr">
          <span className="dbg-section-title">{title}</span>
          <button className="dbg-lc-link" onClick={onLc}>{lcLabel}</button>
        </div>
        {note}
        {rows.length
          ? <EventTable events={rows as unknown as Record<string, unknown>[]} cols={COLS} />
          : <div className="dbg-empty">{empty || 'No events in sample.'}</div>}
      </div>
    );

    if (focus === 'events') {
      const rows = [...dayAll].sort((a, b) => {
        const r = (s: string) => (s === 'fail' ? 0 : s === 'slow' ? 1 : s === 'warn' ? 2 : 3);
        return r(a.status) - r(b.status);
      });
      dash.showModal(`${day.date} — ${day.total} Events`, (<>
        {statBar}
        {section(`Events on ${day.date} — ${rows.length} sampled of ${day.total} total`, rows,
          `View ${day.date} in Log Center →`,
          () => goLc('all', `All Events on ${day.date}`, `${hub.toUpperCase()} · ${day.total} total events`),
          undefined,
          `No sampled events found for ${day.date}.`)}
      </>));
    } else if (focus === 'reliability') {
      dash.showModal(`${day.date} — Reliability ${day.rel}%`, (<>
        {statBar}
        {section(`Failures on ${day.date} — ${dayFails.length} found in sample`, dayFails,
          `View ${day.date} failures in Log Center →`,
          () => goLc('failures', `Failures on ${day.date}`, `${hub.toUpperCase()} · Reliability was ${day.rel}%`),
          undefined,
          `No failures in sample for ${day.date}. Click "View in Log Center →" — it will search all events for this date.`)}
      </>));
    } else if (focus === 'ns') {
      const nsFail = Math.round(day.total * (1 - (day.ns || 0) / 100));
      dash.showModal(`${day.date} — North Star ${(day.ns || 0).toFixed(1)}%`, (<>
        {statBar}
        {section(`Events >1s on ${day.date} — ${dayNsMiss.length} sampled · ~${nsFail} missed target`, dayNsMiss,
          `View ${day.date} slow events in Log Center →`,
          () => goLc('slow', `Slow Events on ${day.date}`, `${hub.toUpperCase()} · North Star was ${(day.ns || 0).toFixed(1)}%`),
          undefined,
          `No >1s events in sample for ${day.date}. ~${nsFail} events missed the 1s target.`)}
      </>));
    } else {
      const timed = dayAll
        .filter((e) => { const l = parseFloat(String(e.lat)); return !isNaN(l) && l > 0; })
        .sort((a, b) => parseFloat(String(b.lat ?? 0)) - parseFloat(String(a.lat ?? 0)));
      dash.showModal(`${day.date} — Speed (P50 ${fmtOrDash(day.p50, 'ms')} · P95 ${fmtOrDash(day.p95, 'ms')})`, (<>
        {statBar}
        {section(`Timed app commands on ${day.date} — ${timed.length} sampled (slowest first)`, timed,
          `View ${day.date} in Log Center →`,
          () => goLc('all', `All Events on ${day.date}`, `${hub.toUpperCase()} · ${day.total} total events`),
          <p style={{ fontSize: 10, color: 'var(--muted)', margin: '0 0 8px' }}>
            Speed (P50/P95/Avg/StdDev) is measured from app-command round-trips only — hub-initiated and dock events have no app latency.
          </p>,
          `No timed events in sample for ${day.date}.`)}
      </>));
    }
  };
}
