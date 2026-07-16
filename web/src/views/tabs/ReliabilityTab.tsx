/** Reliability tab — trend, by-source (App/Dock/Hub), dock reliability table,
 *  failures by reason (donut) and by device. Drill-downs ported 1:1 (incl. the
 *  showDockModal/showDevModal that were missing in the vanilla build). */
import { useMemo, useState } from 'react';
import { Line, Doughnut } from 'react-chartjs-2';
import '../../charts/setup';
import type { HubDetail, DockStats } from '../../types/api';
import { allSourceDaily, failuresFor, srcPred } from '../../lib/pool';
import { relColor, relTag, devShort } from '../../lib/format';
import { ucLabel } from '../../lib/constants';
import { InfoButton, KV, EventTable, LcCta } from '../../components/common';
import { useDash } from '../../state/DashboardContext';

const FAIL_COLS = [
  { key: 'ts', label: 'Time' }, { key: 'uc', label: 'Use Case' }, { key: 'dev', label: 'Device' },
  { key: 'room', label: 'Room' }, { key: 'reason', label: 'Reason' }, { key: 'lat', label: 'Latency' },
];

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
    const fails = failuresFor(hub, d, srcPred(src));
    const lcOpts = { hub, tab: 'failures' as const, srcFilter: src, context: { label: `Failures — ${lbl}`, desc: `${fail} failed events from ${lbl} on ${hub.toUpperCase()}` } };
    dash.showModal(`${lbl} — Reliability Debug`, (<>
      <table style={{ fontSize: 12, marginBottom: 4 }}>
        <tbody>
          <KV label="Source"><strong>{lbl}</strong></KV>
          <KV label="Total Events"><strong style={{ fontSize: 16 }}>{total}</strong></KV>
          <KV label="Successful"><strong style={{ color: 'var(--green)' }}>{success}</strong></KV>
          <KV label="Failed"><strong style={{ color: 'var(--red)', fontSize: 16 }}>{fail}</strong></KV>
          <KV label="Reliability"><strong style={{ color: relColor(rel), fontSize: 16 }}>{rel}%</strong></KV>
        </tbody>
      </table>
      {fail > 0 ? (
        <div className="dbg-section">
          <div className="dbg-section-hdr">
            <span className="dbg-section-title">Failure Events for {lbl} ({fails.length})</span>
            <button className="dbg-lc-link" onClick={() => dash.openLogCenter(lcOpts)}>View all in Log Center →</button>
          </div>
          <EventTable events={fails.slice(0, 10) as unknown as Record<string, unknown>[]} cols={FAIL_COLS} />
          {fails.length > 10 ? <p style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>Showing 10 of {fails.length}.</p> : null}
        </div>
      ) : <div className="dbg-section"><div className="dbg-empty">No failures for this source.</div></div>}
    </>));
  };

  const showDockModal = (dk: DockStats) => {
    const fail = dk.total - dk.success;
    const rel = dk.total ? +((100 * dk.success) / dk.total).toFixed(2) : 0;
    dash.showModal(`Dock Reliability — ${dk.dock_id}`, (<>
      <table style={{ fontSize: 12, marginBottom: 4 }}>
        <tbody>
          <KV label="Dock"><strong style={{ fontFamily: 'monospace' }}>{dk.dock_id}</strong></KV>
          <KV label="Total Presses"><strong style={{ fontSize: 16 }}>{dk.total}</strong></KV>
          <KV label="Successful"><strong style={{ color: 'var(--green)' }}>{dk.success}</strong></KV>
          <KV label="Failed"><strong style={{ color: 'var(--red)', fontSize: 16 }}>{fail}</strong></KV>
          <KV label="Reliability"><strong style={{ color: relColor(rel), fontSize: 16 }}>{rel}%</strong></KV>
          <KV label="How it's measured">A press = a dock call_service tagged with this dock_id (ha_logs). Success = its context_id produced an on/off device state.</KV>
        </tbody>
      </table>
      {dk.docklets && dk.docklets.length ? (
        <div className="dbg-section">
          <div className="dbg-section-hdr"><span className="dbg-section-title">Per-docklet breakdown</span></div>
          <EventTable
            events={dk.docklets.map((x) => ({
              docklet: x.docklet_id, total: x.total, success: x.success,
              fail: x.total - x.success, rel: `${x.total ? +((100 * x.success) / x.total).toFixed(1) : 0}%`,
            }))}
            cols={[
              { key: 'docklet', label: 'Docklet' }, { key: 'total', label: 'Total' },
              { key: 'success', label: 'OK' }, { key: 'fail', label: 'Fail' }, { key: 'rel', label: 'Reliability' },
            ]} />
        </div>
      ) : null}
      <LcCta label="Inspect dock events in Log Center →"
        onClick={() => dash.openLogCenter({ hub, tab: 'all', srcFilter: 'Dock Control', filters: { search: dk.dock_id }, context: { label: `Dock ${dk.dock_id}`, desc: `${hub.toUpperCase()} · ${dk.total} presses · ${rel}% reliable` } })} />
    </>));
  };

  const showDevModal = (dev: { id: string; room: string; total: number; rel: number; p50: number; failC: number; reasons: Record<string, number> }) => {
    const fails = failuresFor(hub, d, (f) => f.dev === dev.id);
    const reasonStr = Object.keys(dev.reasons).length
      ? Object.entries(dev.reasons).map(([k, v]) => `${k}: ${v}`).join(' · ')
      : '—';
    dash.showModal(`Device — ${dev.id}`, (<>
      <table style={{ fontSize: 12, marginBottom: 4 }}>
        <tbody>
          <KV label="Device"><strong style={{ fontFamily: 'monospace' }}>{dev.id}</strong></KV>
          <KV label="Room">{dev.room || '—'}</KV>
          <KV label="Total Commands"><strong style={{ fontSize: 16 }}>{dev.total}</strong></KV>
          <KV label="Reliability"><strong style={{ color: relColor(dev.rel), fontSize: 16 }}>{dev.rel}%</strong></KV>
          <KV label="Failures"><strong style={{ color: 'var(--red)', fontSize: 16 }}>{dev.failC}</strong></KV>
          <KV label="Median (P50)">{dev.p50}ms</KV>
          <KV label="Failure Reasons"><span style={{ fontSize: 11 }}>{reasonStr}</span></KV>
        </tbody>
      </table>
      <div className="dbg-section">
        <div className="dbg-section-hdr">
          <span className="dbg-section-title">Failure Events ({fails.length} sampled)</span>
          <button className="dbg-lc-link" onClick={() => dash.openLogCenter({ hub, tab: 'failures', filters: { search: (dev.id || '').split('.').pop() || '' }, context: { label: `Failures — ${dev.id}`, desc: `${hub.toUpperCase()} · ${dev.failC} of ${dev.total} commands failed` } })}>
            Inspect in Log Center →
          </button>
        </div>
        {fails.length
          ? (<>
              <EventTable events={fails.slice(0, 12) as unknown as Record<string, unknown>[]}
                cols={[
                  { key: 'ts', label: 'Time' }, { key: 'uc', label: 'Use Case' }, { key: 'room', label: 'Room' },
                  { key: 'src', label: 'Source' }, { key: 'reason', label: 'Reason' }, { key: 'lat', label: 'Latency' },
                ]} />
              {fails.length > 12 ? <p style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>Showing 12 of {fails.length}.</p> : null}
            </>)
          : <div className="dbg-empty">No failure events in sample. Click "Inspect in Log Center →" to search all events for this device.</div>}
      </div>
    </>));
  };

  const showReasonModal = (reason: string, count: number) => {
    const v = d.fail_by_reason?.[reason];
    const remediation: Record<string, string> = {
      TIMEOUT: 'Command reached hub but did not complete within time window. Check device firmware, SNAP responsiveness, and network congestion.',
      NO_RESPONSE: 'Hub sent command but received no acknowledgement. Verify device is online and check Thread node connectivity.',
      DEVICE_OFFLINE: 'Device was not reachable when command was issued. Check power state and Thread mesh coverage.',
      THREAD_MESH_FAIL: 'Command failed at Thread mesh layer before reaching device. Check Thread border router and mesh node placement.',
      DEVICE_UNAVAILABLE: 'The bound device never reached a concrete on/off state. Check power state and Thread mesh coverage.',
    };
    dash.showModal(`${reason} — Failure Analysis`, (<>
      <table style={{ fontSize: 12, marginBottom: 4 }}>
        <tbody>
          <KV label="Failure Reason"><span className="tag tag-red">{reason}</span></KV>
          <KV label="Occurrence Count"><strong style={{ fontSize: 18, color: 'var(--red)' }}>{count}</strong></KV>
          <KV label="Diagnosis"><span style={{ fontSize: 11, lineHeight: 1.5 }}>{remediation[reason] || 'Unknown failure type.'}</span></KV>
        </tbody>
      </table>
      {v?.events?.length ? (
        <div className="dbg-section">
          <div className="dbg-section-hdr">
            <span className="dbg-section-title">Events with this failure ({v.events.length} samples)</span>
            <button className="dbg-lc-link" onClick={() => dash.openLogCenter({ hub, tab: 'failures', filters: { reason }, context: { label: `${reason} Failures`, desc: `${count} events failed with this reason` } })}>
              View all in Log Center →
            </button>
          </div>
          <EventTable events={v.events as unknown as Record<string, unknown>[]}
            cols={[
              { key: 'ts', label: 'Time' }, { key: 'dev', label: 'Device' }, { key: 'uc', label: 'Use Case' },
              { key: 'room', label: 'Room' }, { key: 'src', label: 'Source' }, { key: 'lat', label: 'Latency' },
            ]} />
        </div>
      ) : null}
    </>));
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
      <div key={title} className="clickable"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }}
        onClick={() => showSrcRelModal(srcKey, total, total - fail, fail, rel)}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', letterSpacing: '0.5px', marginBottom: 4 }}>
            {title} <span style={{ fontSize: 9, color: 'var(--blue)', fontWeight: 600 }}>Inspect →</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fail} Failed &nbsp;•&nbsp; {total} Total</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: rc, lineHeight: 1 }}>{rel}%</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>Target: &gt;=97%</div>
        </div>
      </div>
    );
  };

  const sortPopup = (current: 'most' | 'least', set: (m: 'most' | 'least') => void) => (
    <SortMenu current={current} onPick={set} />
  );

  return (<>
    <div className="grid-2" style={{ marginBottom: 16, alignItems: 'flex-start' }}>
      <div className="panel" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ flexShrink: 0 }}>RELIABILITY TREND<InfoButton k="rel_trend" /></h3>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginBottom: 12, fontSize: 12, color: 'var(--text)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 24, height: 2, background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 8, height: 8, background: '#10b981', borderRadius: '50%' }} />
            </div>
            Reliability percentage
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
                { label: 'Reliability percentage', data: daily.map((x) => x.rel), borderColor: '#10b981', tension: 0.3, pointRadius: 3, fill: true, backgroundColor: 'rgba(16,185,129,.06)' },
                { label: 'Target %', data: dates.map(() => 97), borderColor: 'rgba(228,228,231,.25)', borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0 },
              ],
            }}
            options={{
              responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
              onClick: (_e, els) => {
                if (!els.length) return;
                const day = daily[els[0]!.index];
                if (!day) return;
                dash.openLogCenter({ hub, tab: 'failures', filters: { search: day.date }, context: { label: `Failures on ${day.date}`, desc: `${hub.toUpperCase()} · Reliability was ${day.rel}%` } });
              },
              plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `Reliability %: ${ctx.parsed.y}` } } },
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

    <div className="grid-2" style={{ marginBottom: 16, alignItems: 'flex-start' }}>
      <div className="panel" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <h3 style={{ flexShrink: 0, textTransform: 'uppercase', display: 'flex', alignItems: 'center', position: 'relative' }}>
          DOCK RELIABILITY
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {sortPopup(dockSort, setDockSort)}
            <InfoButton k="dock_rel" />
          </div>
        </h3>
        <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto', marginTop: 12, maxHeight: 220, paddingRight: 8 }}>
          <table>
            <thead>
              <tr>
                <th>Dock ID</th><th style={{ textAlign: 'center' }}>Presses</th><th style={{ textAlign: 'center' }}>Success</th>
                <th style={{ textAlign: 'center' }}>Failures</th><th>Reliability</th><th>State</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {sortedDocks.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 11, padding: 14 }}>No dock failures recorded</td></tr>
              )}
              {sortedDocks.map((dk) => {
                const dkFail = dk.total - dk.success;
                const rel = dk.total > 0 ? +((100 * dk.success) / dk.total).toFixed(2) : 0;
                const rc = relTag(rel) === 'tag-red' ? 'var(--red)' : relTag(rel) === 'tag-yellow' ? 'var(--yellow)' : 'var(--green)';
                const stateText = rel < 93 ? 'Critical' : rel < 97 ? 'Warning' : 'Healthy';
                return (
                  <tr key={dk.dock_id} className="clickable" onClick={() => showDockModal(dk)}>
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
                    <td><button className="card-btn-view" style={{ padding: '4px 12px', fontSize: 11, whiteSpace: 'nowrap' }}>Inspect →</button></td>
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
        <table>
          <thead>
            <tr>
              <th>Device</th><th style={{ textAlign: 'center' }}>Reliability</th><th style={{ textAlign: 'center' }}>Total Failures</th>
              <th style={{ textAlign: 'center' }}>No Response</th><th style={{ textAlign: 'center' }}>Timeout</th>
              <th style={{ textAlign: 'center' }}>Device Offline</th><th style={{ textAlign: 'center' }}>Device Unavailable</th>
              <th style={{ textAlign: 'center' }}>Thread Mesh Fail</th><th>Action</th>
            </tr>
          </thead>
          <tbody>
            {sortedFailDev.length === 0 && (
              <tr><td colSpan={9} style={{ color: 'var(--muted)', fontSize: 11, textAlign: 'center', padding: 14 }}>No device failures recorded</td></tr>
            )}
            {sortedFailDev.map((dev) => {
              const rc = relTag(dev.rel) === 'tag-red' ? 'var(--red)' : relTag(dev.rel) === 'tag-yellow' ? 'var(--yellow)' : 'var(--green)';
              return (
                <tr key={dev.id} className="clickable" onClick={() => showDevModal(dev)}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{devShort(dev.id)}</td>
                  <td style={{ color: rc, fontWeight: 700, fontSize: 13, textAlign: 'center' }}>{dev.rel}%</td>
                  <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--red)', fontSize: 13 }}>{dev.failC}</td>
                  <td style={{ textAlign: 'center', fontSize: 13 }}>{dev.reasons['NO_RESPONSE'] || 0}</td>
                  <td style={{ textAlign: 'center', fontSize: 13 }}>{dev.reasons['TIMEOUT'] || 0}</td>
                  <td style={{ textAlign: 'center', fontSize: 13 }}>{dev.reasons['DEVICE_OFFLINE'] || 0}</td>
                  <td style={{ textAlign: 'center', fontSize: 13 }}>{dev.reasons['DEVICE_UNAVAILABLE'] || 0}</td>
                  <td style={{ textAlign: 'center', fontSize: 13 }}>{dev.reasons['THREAD_MESH_FAIL'] || 0}</td>
                  <td><button className="card-btn-view" style={{ padding: '4px 12px', fontSize: 11, whiteSpace: 'nowrap' }}>Inspect →</button></td>
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
