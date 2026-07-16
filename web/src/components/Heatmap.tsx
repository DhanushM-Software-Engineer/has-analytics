/** Activity / Failures heatmap — built from the SAME event pool the Log Center
 *  uses, so a cell count always equals its day+hour drill-down. */
import { useMemo } from 'react';
import { buildEventPool, eventSrcClass, evDow, evHour } from '../lib/pool';
import type { HubDetail } from '../types/api';
import { useDash } from '../state/DashboardContext';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

interface CellDet { app: number; remote: number; dock: number; hub: number }

export function Heatmap({ hub, d, mode }: { hub: string; d: HubDetail; mode: 'activity' | 'failures' }) {
  const { openLogCenter } = useDash();

  const { counts, det, maxV } = useMemo(() => {
    const pool = buildEventPool(hub, d);
    const counts: Record<string, number> = {};
    const det: Record<string, CellDet> = {};
    pool.forEach((e) => {
      if (mode === 'failures' && e.status !== 'fail') return;
      const dw = evDow(e.ts), hr = evHour(e.ts);
      if (dw === null || hr < 0) return;
      const k = `${dw}_${hr}`;
      counts[k] = (counts[k] || 0) + 1;
      const dd = det[k] || (det[k] = { app: 0, remote: 0, dock: 0, hub: 0 });
      dd[eventSrcClass(e)]++;
    });
    const maxV = Math.max(...Object.values(counts), 1);
    return { counts, det, maxV };
  }, [hub, d, mode]);

  const isFail = mode === 'failures';

  return (
    <div style={{ display: 'flex', marginTop: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingBottom: 20 }}>
        <div className="y-label">Day of the Week</div>
      </div>
      <div style={{ flex: 1 }}>
        <div className="heatmap-grid" style={{ background: 'rgba(255,255,255,0.02)' }}>
          {DAYS.map((day) => (
            <HeatRow key={day} day={day} counts={counts} det={det} maxV={maxV} isFail={isFail}
              onCell={(h, v, dd) =>
                openLogCenter({
                  hub, tab: isFail ? 'failures' : 'all', dayFilter: day, hourFilter: h,
                  context: {
                    label: `${day} ${h}:00 - ${v} ${isFail ? 'Failures' : 'Events'}`,
                    desc: isFail
                      ? 'Failures in this time slot'
                      : `App: ${dd.app} · Remote: ${dd.remote} · Dock: ${dd.dock} · Hub: ${dd.hub}`,
                  },
                })}
            />
          ))}
          <div className="heatmap-label" style={{ borderRight: '1px solid var(--border)', borderTop: '1px solid var(--border)' }} />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="heatmap-label" style={{ textAlign: 'center', borderTop: '1px solid var(--border)' }}>{h}</div>
          ))}
        </div>
        <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>Hour of the Day</div>
      </div>
    </div>
  );
}

function HeatRow({ day, counts, det, maxV, isFail, onCell }: {
  day: string;
  counts: Record<string, number>;
  det: Record<string, CellDet>;
  maxV: number;
  isFail: boolean;
  onCell: (hour: number, v: number, det: CellDet) => void;
}) {
  return (
    <>
      <div className="heatmap-label" style={{ borderRight: '1px solid var(--border)' }}>{day.slice(0, 3)}</div>
      {Array.from({ length: 24 }, (_, h) => {
        const k = `${day}_${h}`;
        const v = counts[k] || 0;
        const intensity = v / maxV;
        const bg = intensity > 0
          ? (isFail ? `rgba(239,68,68,${0.1 + intensity * 0.8})` : `rgba(99,102,241,${0.08 + intensity * 0.72})`)
          : '#101013';
        const dd = det[k] || { app: 0, remote: 0, dock: 0, hub: 0 };
        return (
          <div key={h} className="heatmap-cell"
            style={{ background: bg, color: intensity > 0.5 ? '#fff' : 'var(--muted)' }}
            onClick={() => onCell(h, v, dd)}>
            {v || ''}
            <div className="heatmap-tooltip">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontWeight: 'bold' }}>
                <span>{day.toUpperCase()}</span><span>{h}:00</span>
              </div>
              <hr style={{ border: 0, borderTop: '1px solid rgba(255,255,255,0.15)', margin: '4px 0 8px 0' }} />
              {(['hub', 'app', 'dock', 'remote'] as const).map((s) => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', margin: '3px 0' }}>
                  <span style={{ display: 'inline-block', width: 6, height: 6, background: '#888888', borderRadius: '50%', marginRight: 6 }} />
                  {s.toUpperCase()}: {dd[s]}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
