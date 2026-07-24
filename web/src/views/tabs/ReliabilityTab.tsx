/** Reliability tab — trend, by-source (App/Dock/Hub), dock reliability table,
 *  failures by reason (donut) and by device. Drill-downs ported 1:1 (incl. the
 *  showDockModal/showDevModal that were missing in the vanilla build). */
import { useMemo, useState } from 'react';
import { Line, Doughnut } from 'react-chartjs-2';
import '../../charts/setup';
import type { HubDetail, DockStats } from '../../types/api';
import { allSourceDaily, failuresFor, srcPred, buildEventPool } from '../../lib/pool';
import { relColor, relTag, devShort } from '../../lib/format';
import { ucLabel } from '../../lib/constants';
import { InfoButton, EventTable } from '../../components/common';
import { useDash } from '../../state/DashboardContext';

const relIconCanvas = document.createElement('canvas');
relIconCanvas.width = 24;
relIconCanvas.height = 10;
const relIconCtx = relIconCanvas.getContext('2d');
if (relIconCtx) {
  relIconCtx.fillStyle = '#10b981';
  relIconCtx.fillRect(0, 4, 24, 2);
  relIconCtx.beginPath();
  relIconCtx.arc(12, 5, 3, 0, 2 * Math.PI);
  relIconCtx.fill();
}

const targetIconCanvas = document.createElement('canvas');
targetIconCanvas.width = 24;
targetIconCanvas.height = 10;
const targetIconCtx = targetIconCanvas.getContext('2d');
if (targetIconCtx) {
  targetIconCtx.strokeStyle = 'rgba(228,228,231,0.5)';
  targetIconCtx.setLineDash([3, 2]);
  targetIconCtx.lineWidth = 2;
  targetIconCtx.beginPath();
  targetIconCtx.moveTo(0, 5);
  targetIconCtx.lineTo(24, 5);
  targetIconCtx.stroke();
}

export function ReliabilityTab({ hub, d }: { hub: string; d: HubDetail }) {
  const dash = useDash();
  const r = d.reliability_detail;
  const daily = useMemo(() => allSourceDaily(hub, d), [hub, d]);
  const dates = daily.map((x) => { const p = x.date.split('-'); return `${p[2]}-${p[1]}`; });
  const [dockSort, setDockSort] = useState<'most' | 'least'>('most');
  const [devSort, setDevSort] = useState<'most' | 'least'>('most');

  // ── Source cards data (App / Dock / Hub) ──────────────────────────────────
  const appRel = r.app_trigger_feedback;
  const appTot = r.app_triggers || 0;
  const appFail = appTot - (r.app_feedbacks || 0);
  const dockStats = r.dock_stats || [];
  const dockTot = dockStats.reduce((s, dk) => s + dk.total, 0);
  const dockSucc = dockStats.reduce((s, dk) => s + dk.success, 0);
  const dockFail = dockTot - dockSucc;
  const dockRel = dockTot > 0 ? +((100 * dockSucc) / dockTot).toFixed(2) : (r.dock_trigger_feedback || 0);
  const hubV = r.src_rel?.['Hub'] ?? { rel: 100, fail: 0, total: 0, success: 0 };

  const showSrcRelModal = (src: string, total: number, success: number, fail: number, rel: number) => {
    const lbl = ucLabel(src);
    const allEvents = buildEventPool(hub, d).filter(srcPred(src));
    const sorted = [...allEvents].sort((a, b) => {
      const aFail = a.status === 'fail' ? 0 : 1;
      const bFail = b.status === 'fail' ? 0 : 1;
      if (aFail !== bFail) return aFail - bFail;
      return (b.ts || '').localeCompare(a.ts || '');
    });
    const lcOpts = { hub, tab: 'all' as const, srcFilter: src, context: { label: `RELIABILITY BY SOURCE: ${lbl}, EVENTS: ${sorted.length}, FAILURES: ${sorted.filter((e: any) => e.status==='fail').length}` } };
    
    const rows = sorted.slice(0, 20).map((e: any) => {
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
        else if (e.lat > 1000) s = 'slow';
        else s = 'ok';
      }
      
      let statusTag = <span className="tag">{e.status?.toUpperCase() || 'OK'}</span>;
      if (s === 'ok') statusTag = <span className="tag tag-green">OK</span>;
      if (s === 'fail' || s === 'failed') statusTag = <span className="tag tag-red">FAILED</span>;
      if (s === 'slow' || s === 'warn') statusTag = <span className="tag tag-yellow">SLOW</span>;

      return { ...e, fmtDate, fmtTime, status: statusTag };
    });

    const MetricCard = ({ label, val, color }: { label: string; val: string | number; color?: string }) => (
      <div style={{ flex: '1 1 0', minWidth: 100, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px 20px', display: 'flex', gap: 16, alignItems: 'center' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fafafa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>{label}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: color || '#fafafa', lineHeight: 1 }}>{val}</div>
          </div>
        </div>
      </div>
    );

    const customTitle = (
      <div style={{ textAlign: 'left', lineHeight: 1.2 }}>
        <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '1px', marginBottom: 8, fontWeight: 400 }}>LOG VIEW</div>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.3px', marginBottom: 8 }}>RELIABILITY BY SOURCE</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{lbl.toUpperCase()}</div>
      </div>
    );

    const customBody = (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 16, width: '100%', marginBottom: 24, flexWrap: 'wrap' }}>
          <MetricCard label="Total Events" val={total.toLocaleString()} color="#fafafa" />
          <MetricCard label="Success" val={success.toLocaleString()} color="var(--green)" />
          <MetricCard label="Failures" val={fail.toLocaleString()} color={fail > 0 ? 'var(--red)' : '#fafafa'} />
          <MetricCard label="Reliability" val={`${rel}%`} color={relColor(rel)} />
        </div>
        <hr style={{ width: '100%', border: 0, borderTop: '1px solid var(--border)', margin: '0 0 20px 0' }} />
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px', width: '100%', textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>LOGS</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sorted.length > 0 ? `Sampled ${Math.min(20, sorted.length)} logs` : 'No events for this source'}</div>
            </div>
            {sorted.length > 0 && <button className="card-btn-view" style={{ padding: '6px 14px', fontSize: 11 }} onClick={() => dash.openLogCenter(lcOpts)}>VIEW</button>}
          </div>
          {sorted.length > 0 ? (
            <EventTable events={rows} cols={[
              { key: 'fmtDate', label: 'Date' }, { key: 'fmtTime', label: 'Time' },
              { key: 'uc', label: 'Use Case' }, { key: 'dev', label: 'Device' },
              { key: 'room', label: 'Room' }, { key: 'floor', label: 'Floor' }, 
              { key: 'lat', label: 'Latency' }, { key: 'reason', label: 'Failed Reason' },
              { key: 'status', label: 'State' },
            ]} />
          ) : (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No Data</div>
          )}
        </div>
      </div>
    );

    dash.showModal(customTitle, customBody);
  };

  const showDockModal = (dk: DockStats) => {
    const fail = dk.total - dk.success;
    const rel = dk.total ? +((100 * dk.success) / dk.total).toFixed(2) : 0;

    const MetricCard = ({ label, val, color }: { label: string; val: string | number; color?: string }) => (
      <div style={{ flex: '1 1 0', minWidth: 100, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px 20px', display: 'flex', gap: 16, alignItems: 'center' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fafafa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>{label}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: color || '#fafafa', lineHeight: 1 }}>{val}</div>
          </div>
        </div>
      </div>
    );

    const customTitle = (
      <div style={{ textAlign: 'left', lineHeight: 1.2 }}>
        <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '1px', marginBottom: 8, fontWeight: 400 }}>LOG VIEW</div>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.3px', marginBottom: 8 }}>DOCK RELIABILITY</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{dk.dock_id}</div>
      </div>
    );

    const dockletsList = dk.docklets || [];

    const customBody = (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 16, width: '100%', marginBottom: 24, flexWrap: 'wrap' }}>
          <MetricCard label="TOTAL PRESSES" val={dk.total.toLocaleString()} color="#fafafa" />
          <MetricCard label="SUCCESS" val={dk.success.toLocaleString()} color="var(--green)" />
          <MetricCard label="FAILURES" val={fail.toLocaleString()} color={fail > 0 ? 'var(--red)' : '#fafafa'} />
          <MetricCard label="RELIABILITY" val={`${rel}%`} color={relColor(rel)} />
        </div>
        <hr style={{ width: '100%', border: 0, borderTop: '1px solid var(--border)', margin: '0 0 20px 0' }} />
        
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px', width: '100%', textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>DOCKLET BREAKDOWN</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{dockletsList.length} Docklets</div>
            </div>
            <button className="card-btn-view" style={{ padding: '6px 14px', fontSize: 11 }} onClick={() => dash.openLogCenter({ hub, tab: 'all', srcFilter: 'Dock Control', filters: { search: dk.dock_id }, context: { label: `DOCK RELIABILITY -> DEVICE: ${dk.dock_id}, EVENTS: ${dk.total}, FAILURES: ${fail}` } })}>VIEW DOCK EVENTS</button>
          </div>
          {dockletsList.length > 0 ? (
            <EventTable
              events={dockletsList.map((x) => {
                const xfail = x.total - x.success;
                const xrel = x.total ? +((100 * x.success) / x.total).toFixed(1) : 0;
                const buildStateTag = (label: string, color: string) => (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: `1px solid ${color}`, borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 500 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
                    <span style={{ color: color }}>{label}</span>
                  </div>
                );

                let stateTag = buildStateTag('Critical', 'var(--red)');
                if (xrel >= 97) stateTag = buildStateTag('Healthy', 'var(--green)');
                else if (xrel >= 95) stateTag = buildStateTag('Warning', 'var(--yellow)');
                
                return {
                  docklet: x.docklet_id,
                  total: x.total,
                  success: x.success,
                  fail: xfail,
                  relStr: <span style={{ color: relColor(xrel) }}>{xrel}%</span>,
                  state: stateTag
                };
              })}
              cols={[
                { key: 'docklet', label: 'DOCKLET' }, 
                { key: 'total', label: 'TOTAL PRESSES' },
                { key: 'success', label: 'SUCCESS' }, 
                { key: 'fail', label: 'FAILURES' }, 
                { key: 'relStr', label: 'RELIABILITY' },
                { key: 'state', label: 'STATE' }
              ]} 
            />
          ) : (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No Docklets Found</div>
          )}
        </div>
      </div>
    );

    dash.showModal(customTitle, customBody);
  };

  const showDevModal = (dev: { id: string; room: string; total: number; rel: number; p50: number; failC: number; reasons: Record<string, number> }) => {
    const rawEvents = failuresFor(hub, d, (f) => f.dev === dev.id);

    const MetricCard = ({ label, val, color }: { label: string; val: string | number; color?: string }) => (
      <div style={{ flex: '1 1 0', minWidth: 100, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px 20px', display: 'flex', gap: 16, alignItems: 'center' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fafafa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>{label}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: color || '#fafafa', lineHeight: 1 }}>{val}</div>
          </div>
        </div>
      </div>
    );

    const customTitle = (
      <div style={{ textAlign: 'left', lineHeight: 1.2 }}>
        <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '1px', marginBottom: 8, fontWeight: 400 }}>LOG VIEW</div>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.3px', marginBottom: 8 }}>FAILURES BY DEVICE</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{dev.id}</div>
      </div>
    );

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
      return { ...e, fmtDate, fmtTime };
    });

    const lcOpts = { hub, tab: 'failures' as const, filters: { search: (dev.id || '').split('.').pop() || '' }, context: { label: `FAILURES BY DEVICE -> DEVICE: ${dev.id}, EVENTS: ${dev.total}, FAILURES: ${dev.failC}` } };

    const customBody = (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 16, width: '100%', marginBottom: 24, flexWrap: 'wrap' }}>
          <MetricCard label="Total Events" val={dev.total.toLocaleString()} color="#fafafa" />
          <MetricCard label="Failures" val={dev.failC.toLocaleString()} color={dev.failC > 0 ? 'var(--red)' : '#fafafa'} />
          <MetricCard label="Reliability" val={`${dev.rel}%`} color={relColor(dev.rel)} />
        </div>
        <hr style={{ width: '100%', border: 0, borderTop: '1px solid var(--border)', margin: '0 0 20px 0' }} />
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px', width: '100%', textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>LOGS</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Sampled {Math.min(20, rawEvents.length)} logs</div>
            </div>
            <button className="card-btn-view-red" style={{ padding: '6px 14px', fontSize: 11 }} onClick={() => dash.openLogCenter(lcOpts)}>VIEW</button>
          </div>
          <EventTable events={rows} cols={[
            { key: 'fmtDate', label: 'Date' }, { key: 'fmtTime', label: 'Time' },
            { key: 'uc', label: 'Use Case' }, { key: 'room', label: 'Room' },
            { key: 'floor', label: 'Floor' }, { key: 'lat', label: 'Latency' }, { key: 'reason', label: 'Failed Reason' }
          ]} />
        </div>
      </div>
    );

    dash.showModal(customTitle, customBody);
  };

  const showReasonModal = (reason: string, count: number) => {
    const v = d.fail_by_reason?.[reason];
    const rawEvents = v?.events || [];
    
    const MetricCard = ({ label, val, color }: { label: string; val: string | number; color?: string }) => (
      <div style={{ flex: '1 1 0', minWidth: 100, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px 20px', display: 'flex', gap: 16, alignItems: 'center' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fafafa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>{label}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: color || '#fafafa', lineHeight: 1 }}>{val}</div>
          </div>
        </div>
      </div>
    );

    const customTitle = (
      <div style={{ textAlign: 'left', lineHeight: 1.2 }}>
        <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '1px', marginBottom: 8, fontWeight: 400 }}>LOG VIEW</div>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.3px', marginBottom: 8 }}>FAILURES BY REASON</div>
      </div>
    );

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
      return { ...e, fmtDate, fmtTime };
    });

    const lcOpts = { hub, tab: 'failures' as const, filters: { reason }, context: { label: `FAILURES BY REASON -> REASON: ${reason}, FAILURES: ${count}` } };

    const customBody = (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 16, width: '100%', marginBottom: 24, flexWrap: 'wrap' }}>
          <MetricCard label="Reason" val={reason} color="#fafafa" />
          <MetricCard label="Failures" val={count.toLocaleString()} color="var(--red)" />
        </div>
        <hr style={{ width: '100%', border: 0, borderTop: '1px solid var(--border)', margin: '0 0 20px 0' }} />
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px', width: '100%', textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>LOGS</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Sampled {Math.min(20, rawEvents.length)} logs</div>
            </div>
            <button className="card-btn-view-red" style={{ padding: '6px 14px', fontSize: 11 }} onClick={() => dash.openLogCenter(lcOpts)}>VIEW</button>
          </div>
          <EventTable events={rows} cols={[
            { key: 'fmtDate', label: 'Date' }, { key: 'fmtTime', label: 'Time' },
            { key: 'uc', label: 'Use Case' }, { key: 'dev', label: 'Device' },
            { key: 'room', label: 'Room' }, { key: 'floor', label: 'Floor' }, { key: 'lat', label: 'Latency' }
          ]} />
        </div>
      </div>
    );

    dash.showModal(customTitle, customBody);
  };

  const openTrendModal = (day: any) => {
    const pool = buildEventPool(hub, d);
    const dayEvents = pool.filter(e => e.ts && e.ts.startsWith(day.date));
    const dayFails = dayEvents.filter(e => e.status === 'fail');
    const lcOpts = { hub, tab: 'failures' as const, filters: { search: day.date }, context: { label: `RELIABILITY TREND -> DATE: ${day.date}, EVENTS: ${dayEvents.length}, FAILURES: ${day.fail || 0}` } };
    
    const rows = dayFails.slice(0, 20).map((e: any) => {
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
      
      let s = e.status?.toLowerCase() || 'ok';
      let statusTag = <span className="tag">{s.toUpperCase()}</span>;
      if (s === 'ok') statusTag = <span className="tag tag-green">OK</span>;
      if (s === 'fail' || s === 'failed') statusTag = <span className="tag tag-red">FAILED</span>;
      if (s === 'slow' || s === 'warn') statusTag = <span className="tag tag-yellow">SLOW</span>;

      return { ...e, fmtDate, fmtTime, status: statusTag };
    });

    const MetricCard = ({ label, val, color }: { label: string; val: string | number; color?: string }) => (
      <div style={{ flex: '1 1 0', minWidth: 100, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px 20px', display: 'flex', gap: 16, alignItems: 'center' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fafafa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>{label}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: color || '#fafafa', lineHeight: 1 }}>{val}</div>
          </div>
        </div>
      </div>
    );

    const customTitle = (
      <div style={{ textAlign: 'left', lineHeight: 1.2 }}>
        <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '1px', marginBottom: 8, fontWeight: 400 }}>LOG VIEW</div>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.3px', marginBottom: 8 }}>FAILURES TREND</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          {day.date ? `${day.date.slice(8, 10)}-${day.date.slice(5, 7)}-${day.date.slice(2, 4)}` : day.date}
        </div>
      </div>
    );

    const customBody = (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 16, width: '100%', marginBottom: 24, flexWrap: 'wrap' }}>
          <MetricCard label="Total Events" val={day.total.toLocaleString()} color="#fafafa" />
          <MetricCard label="Success" val={(day.total - day.fail).toLocaleString()} color="var(--green)" />
          <MetricCard label="Failures" val={(day.fail || 0).toLocaleString()} color={(day.fail || 0) > 0 ? 'var(--red)' : '#fafafa'} />
          <MetricCard label="Reliability" val={`${day.rel}%`} color={relColor(day.rel)} />
        </div>
        <hr style={{ width: '100%', border: 0, borderTop: '1px solid var(--border)', margin: '0 0 20px 0' }} />
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px', width: '100%', textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>LOGS</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Sampled {Math.min(20, dayFails.length)} logs</div>
            </div>
            <button className="card-btn-view" style={{ padding: '6px 14px', fontSize: 11 }} onClick={() => dash.openLogCenter(lcOpts)}>VIEW</button>
          </div>
          <EventTable events={rows} cols={[
            { key: 'fmtDate', label: 'Date' }, { key: 'fmtTime', label: 'Time' },
            { key: 'uc', label: 'Use Case' }, { key: 'dev', label: 'Device' },
            { key: 'room', label: 'Room' }, { key: 'floor', label: 'Floor' }, 
            { key: 'lat', label: 'Latency' }, { key: 'reason', label: 'Failed Reason' },
            { key: 'status', label: 'State' },
          ]} />
        </div>
      </div>
    );

    dash.showModal(customTitle, customBody);
  };

  // ── Failures by reason (donut) ────────────────────────────────────────────
  const reasonEntries = Object.entries(d.fail_by_reason || {}).sort((a, b) => b[1].count - a[1].count);
  const palette = ['#f97316', '#f59e0b', '#0ea5e9', '#8b5cf6', '#64748b'];
  let pIdx = 0;
  const reasonColors = reasonEntries.map(([label]) =>
    label === 'DEVICE_UNAVAILABLE' || label === 'DEVICE_OFFLINE' ? '#ef4444' : palette[pIdx++ % palette.length]!);

  // ── Failures by device rows ───────────────────────────────────────────────
  const failDevData = useMemo(() =>
    (d.devices || [])
      .filter((dev) => dev.total > dev.success)
      .map((dev) => ({
        ...dev,
        failC: dev.total - dev.success,
        reasons: d.fail_by_device?.[dev.id]?.reasons ?? {},
      }))
      .sort((a, b) => (a.rel !== b.rel ? a.rel - b.rel : b.failC - a.failC)),
  [d]);
  const sortedFailDev = [...failDevData].sort((a, b) => (devSort === 'most' ? b.failC - a.failC : a.failC - b.failC));
  const sortedDocks = [...dockStats].sort((a, b) => {
    const fa = a.total - a.success, fb = b.total - b.success;
    return dockSort === 'most' ? fb - fa : fa - fb;
  });

  const srcCard = (title: string, rel: number, fail: number, total: number, srcKey: string, isLast: boolean) => {
    const isRed = rel < 97;
    const rc = isRed ? 'var(--red)' : rel === 100 ? 'var(--green)' : 'var(--yellow)';
    return (
      <div key={title} className="hover-card-row"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', cursor: 'pointer', borderRadius: 10, borderBottom: isLast ? '1px solid transparent' : '1px solid var(--border)' }}
        onClick={() => showSrcRelModal(srcKey, total, total - fail, fail, rel)}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: '0.5px', marginBottom: 6 }}>
            {title}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fail} Failed &nbsp;•&nbsp; {total} Total</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: rc, lineHeight: 1 }}>{rel}%</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>Target: &gt;=97%</div>
        </div>
      </div>
    );
  };

  const sortPopup = (current: 'most' | 'least', set: (m: 'most' | 'least') => void) => (
    <SortMenu current={current} onPick={set} />
  );

  return (<>
    <div className="grid-2" style={{ marginBottom: 16, alignItems: 'stretch' }}>
      <div className="panel" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ flexShrink: 0 }}>RELIABILITY TREND<InfoButton k="rel_trend" /></h3>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginBottom: 12, fontSize: 12, color: 'var(--text)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 24, height: 2, background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 8, height: 8, background: '#10b981', borderRadius: '50%' }} />
            </div>
            Reliability %
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 24, height: 2, borderBottom: '2px dashed rgba(228,228,231,.25)' }} />
            Target %
          </div>
        </div>
        <div className="chart-box" style={{ flex: 1, minHeight: 220, position: 'relative' }}>
          <Line
            data={{
              labels: dates,
              datasets: [
                { label: 'Reliability %', data: daily.map((x) => x.rel), borderColor: '#10b981', tension: 0.3, pointRadius: 3, fill: true, backgroundColor: 'rgba(16,185,129,.06)' },
                { label: 'Target %', data: dates.map(() => 97), borderColor: 'rgba(228,228,231,.25)', borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0 },
              ],
            }}
            options={{
              responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
              onClick: (_e, els) => {
                if (!els.length) return;
                const day = daily[els[0]!.index];
                if (!day) return;
                openTrendModal(day);
              },
              plugins: { 
                legend: { display: false }, 
                tooltip: { 
                  usePointStyle: true,
                  callbacks: { 
                    labelPointStyle: (ctx) => {
                      return { pointStyle: ctx.datasetIndex === 0 ? relIconCanvas : targetIconCanvas, rotation: 0 };
                    },
                    label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}` 
                  } 
                } 
              },
              scales: { y: { title: { display: true, text: 'Reliability %' }, min: 0, max: 102 }, x: { title: { display: true, text: 'Date' } } },
            }}
          />
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ flexShrink: 0 }}>RELIABILITY BY SOURCE<InfoButton k="rel_source" /></h3>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, paddingTop: 8 }}>
          {srcCard('APP CONTROL', appRel, appFail, appTot, 'App Control', false)}
          {srcCard('DOCK CONTROL', dockRel, dockFail, dockTot, 'Dock Control', false)}
          {srcCard('HUB', hubV.rel, hubV.fail, hubV.total, 'Hub', true)}
        </div>
      </div>
    </div>

    <div className="grid-2" style={{ marginBottom: 16, alignItems: 'stretch' }}>
      <div className="panel" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <h3 style={{ flexShrink: 0, textTransform: 'uppercase', display: 'flex', alignItems: 'center', position: 'relative' }}>
          DOCK RELIABILITY
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {sortPopup(dockSort, setDockSort)}
            <InfoButton k="dock_rel" />
          </div>
        </h3>
        <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto', marginTop: 12, maxHeight: 220, paddingRight: 8 }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr>
                <th>Dock ID</th><th style={{ textAlign: 'center' }}>Presses</th><th style={{ textAlign: 'center' }}>Success</th>
                <th style={{ textAlign: 'center' }}>Failures</th><th>Reliability</th><th>State</th>
              </tr>
            </thead>
            <tbody>
              {sortedDocks.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 11, padding: 14 }}>No dock failures recorded</td></tr>
              )}
              {sortedDocks.map((dk) => {
                const dkFail = dk.total - dk.success;
                const rel = dk.total > 0 ? +((100 * dk.success) / dk.total).toFixed(2) : 0;
                const rc = relTag(rel) === 'tag-red' ? 'var(--red)' : relTag(rel) === 'tag-yellow' ? 'var(--yellow)' : 'var(--green)';
                const stateText = rel < 93 ? 'Critical' : rel < 97 ? 'Warning' : 'Healthy';
                return (
                  <tr key={dk.dock_id} className="clickable hover-card-row" onClick={() => showDockModal(dk)}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{dk.dock_id}</td>
                    <td style={{ textAlign: 'center', fontSize: 13 }}>{dk.total}</td>
                    <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--text)', fontSize: 13 }}>{dk.success}</td>
                    <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--text)', fontSize: 13 }}>{dkFail}</td>
                    <td style={{ color: rc, fontWeight: 700, fontSize: 13 }}>{rel}%</td>
                    <td>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: 'rgba(0,0,0,0.3)', color: rc, border: `1px solid ${rc}`, margin: 0 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: rc }} />{stateText}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ flexShrink: 0 }}>FAILURES BY REASON<InfoButton k="fail_reason" /></h3>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 0' }}>
          {reasonEntries.length ? (<>
            <div style={{ height: 140, width: '35%', position: 'relative' }}>
              <Doughnut
                data={{
                  labels: reasonEntries.map(([k]) => k),
                  datasets: [{ data: reasonEntries.map(([, v]) => v.count), backgroundColor: reasonColors, borderWidth: 0 }],
                }}
                options={{
                  responsive: true, maintainAspectRatio: false, cutout: '65%',
                  onClick: (_e, els) => {
                    if (!els.length) return;
                    const entry = reasonEntries[els[0]!.index];
                    if (entry) showReasonModal(entry[0], entry[1].count);
                  },
                  plugins: { legend: { display: false } },
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 10px', width: '45%' }}>
              {reasonEntries.map(([k, v], i) => (
                <div key={k} className="clickable" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer' }}
                  onClick={() => showReasonModal(k, v.count)}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: reasonColors[i], flexShrink: 0 }} />
                  <span style={{ color: 'var(--text)' }}>{k}</span>
                  <strong style={{ marginLeft: 'auto' }}>{v.count}</strong>
                </div>
              ))}
            </div>
          </>) : <div className="dbg-empty">No failures recorded in this period.</div>}
        </div>
      </div>
    </div>

    <div className="panel" style={{ position: 'relative', display: 'flex', flexDirection: 'column', paddingBottom: 12 }}>
      <h3 style={{ flexShrink: 0, textTransform: 'uppercase', display: 'flex', alignItems: 'center', position: 'relative' }}>
        FAILURES BY DEVICE
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {sortPopup(devSort, setDevSort)}
          <InfoButton k="fail_device" />
        </div>
      </h3>
      <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto', marginTop: 12, maxHeight: 300, paddingRight: 8 }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr>
              <th>Device</th><th style={{ textAlign: 'center' }}>Reliability</th><th style={{ textAlign: 'center' }}>Total Failures</th>
              <th style={{ textAlign: 'center' }}>No Response</th><th style={{ textAlign: 'center' }}>Timeout</th>
              <th style={{ textAlign: 'center' }}>Device Offline</th><th style={{ textAlign: 'center' }}>Device Unavailable</th>
              <th style={{ textAlign: 'center' }}>Thread Mesh Fail</th>
            </tr>
          </thead>
          <tbody>
            {sortedFailDev.length === 0 && (
              <tr><td colSpan={8} style={{ color: 'var(--muted)', fontSize: 11, textAlign: 'center', padding: 14 }}>No device failures recorded</td></tr>
            )}
            {sortedFailDev.map((dev) => {
              const rc = relTag(dev.rel) === 'tag-red' ? 'var(--red)' : relTag(dev.rel) === 'tag-yellow' ? 'var(--yellow)' : 'var(--green)';
              return (
                <tr key={dev.id} className="clickable hover-card-row" onClick={() => showDevModal(dev)}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{devShort(dev.id)}</td>
                  <td style={{ color: rc, fontWeight: 700, fontSize: 13, textAlign: 'center' }}>{dev.rel}%</td>
                  <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--red)', fontSize: 13 }}>{dev.failC}</td>
                  <td style={{ textAlign: 'center', fontSize: 13 }}>{dev.reasons['NO_RESPONSE'] || 0}</td>
                  <td style={{ textAlign: 'center', fontSize: 13 }}>{dev.reasons['TIMEOUT'] || 0}</td>
                  <td style={{ textAlign: 'center', fontSize: 13 }}>{dev.reasons['DEVICE_OFFLINE'] || 0}</td>
                  <td style={{ textAlign: 'center', fontSize: 13 }}>{dev.reasons['DEVICE_UNAVAILABLE'] || 0}</td>
                  <td style={{ textAlign: 'center', fontSize: 13 }}>{dev.reasons['THREAD_MESH_FAIL'] || 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  </>);
}

/** Funnel-icon sort popup (Most / Least failures) — ported behavior. */
function SortMenu({ current, onPick }: { current: 'most' | 'least'; onPick: (m: 'most' | 'least') => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: 'relative' }}>
      <button className="info-btn" style={{ border: 'none', background: 'none', padding: 0 }}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="1.5" fill="none"
          strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', opacity: 0.6 }}>
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
      </button>
      {open && (<>
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 99 }} onClick={() => setOpen(false)} />
        <div style={{ position: 'absolute', top: 24, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, zIndex: 100, boxShadow: '0 8px 24px rgba(0,0,0,0.6)', minWidth: 140, textTransform: 'none', fontWeight: 'normal', letterSpacing: 'normal' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, fontWeight: 600, paddingLeft: 6 }}>Sort by Failures</div>
          {(['most', 'least'] as const).map((m) => (
            <div key={m} className="clickable" style={{ padding: '8px 6px', fontSize: 13, cursor: 'pointer', borderRadius: 4, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 12 }}
              onClick={() => { onPick(m); setOpen(false); }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', border: '1px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: current === m ? 'var(--blue)' : 'transparent' }} />
              </div>
              {m === 'most' ? 'Most' : 'Least'}
            </div>
          ))}
        </div>
      </>)}
    </span>
  );
}
