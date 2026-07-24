/** Hub KPI drill-downs (Reliability / P50 Speed / North Star) with 14-day
 *  trends — ported from showHubRelModal / showHubSpeedModal / showHubNSModal. */
import { useDash } from '../state/DashboardContext';
import { allSourceDaily } from '../lib/pool';
import { relColor, statusLabel } from '../lib/format';
import { DebugHeader, StatCells, BreakdownBox, PillState } from './fleetModals';

const th: React.CSSProperties = { textAlign: 'left', padding: 8, color: 'var(--muted)', borderBottom: '1px solid var(--border)' };
const td: React.CSSProperties = { padding: '10px 8px', borderBottom: '1px solid var(--border)' };
const tdDate: React.CSSProperties = { ...td, fontFamily: 'monospace', fontSize: 10, color: 'var(--muted)' };

export function useHubModals(hub: string) {
  const dash = useDash();
  const { D, showModal, closeModal, openLogCenter } = dash;
  const d = D[hub];

  const inspectBtn = (onClick: () => void) => (
    <button className="card-btn-view" style={{ padding: '4px 12px', fontSize: 10 }}
      onClick={() => { closeModal(); onClick(); }}>Inspect →</button>
  );

  const showRel = () => {
    if (!d) return;
    const act = d.total_activity ?? d.total;
    const f = d.activity_fail ?? (d.total - d.success);
    const arel = act ? +(((act - f) / act) * 100).toFixed(2) : 0;
    const recent = [...allSourceDaily(hub, d)].reverse().slice(0, 14);
    showModal('', (<>
      <DebugHeader metric="RELIABILITY" formula="(Successful Commands / Total Attempted Commands) × 100" />
      <StatCells cells={[
        { label: 'RELIABILITY', val: `${arel}%`, color: relColor(arel) },
        { label: 'SUCCESS', val: (act - f).toLocaleString() },
        { label: 'FAILURES', val: f.toLocaleString() },
      ]} />
      <BreakdownBox title="DAILY TREND">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead><tr><th style={th}>DATE</th><th style={th}>RELIABILITY</th><th style={th}>FAILURES</th><th style={th}>STATE</th><th style={th}>ACTION</th></tr></thead>
          <tbody>
            {recent.map((dy) => {
              const rc = relColor(dy.rel);
              return (
                <tr key={dy.date}>
                  <td style={tdDate}>{dy.date}</td>
                  <td style={{ ...td, color: rc, fontWeight: 600 }}>{dy.rel}%</td>
                  <td style={{ ...td, color: '#fafafa' }}>{(dy.fail || 0).toLocaleString()}</td>
                  <td style={td}><PillState color={rc} label={statusLabel(dy.rel)} /></td>
                  <td style={td}>{inspectBtn(() => openLogCenter({ hub, tab: 'failures', filters: { search: dy.date } }))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </BreakdownBox>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="card-btn-investigate" onClick={() => { closeModal(); openLogCenter({ hub, tab: 'failures' }); }}>VIEW ALL FAILURES</button>
      </div>
    </>));
  };

  const showSpeed = () => {
    if (!d) return;
    const p50 = d.total && d.speed.local_e2e.p50 != null ? `${d.speed.local_e2e.p50}ms` : '—';
    const recent = [...allSourceDaily(hub, d)].reverse().slice(0, 14);
    showModal('', (<>
      <DebugHeader metric="P50 SPEED" formula="Median Latency (50th Percentile) of all successful App events" />
      <StatCells cells={[{ label: 'P50 SPEED', val: p50 }]} />
      <BreakdownBox title="DAILY TREND">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead><tr><th style={th}>DATE</th><th style={th}>P50</th><th style={th}>STATE</th><th style={th}>ACTION</th></tr></thead>
          <tbody>
            {recent.map((dy) => {
              const v = dy.p50;
              const rc = v != null && v > 1000 ? 'var(--red)' : v != null && v > 800 ? 'var(--yellow)' : 'var(--green)';
              const sl = v != null && v > 1000 ? 'Critical' : v != null && v > 800 ? 'Warning' : 'Healthy';
              return (
                <tr key={dy.date}>
                  <td style={tdDate}>{dy.date}</td>
                  <td style={{ ...td, color: rc, fontWeight: 600 }}>{v != null ? `${v}ms` : '—'}</td>
                  <td style={td}><PillState color={rc} label={sl} /></td>
                  <td style={td}>{inspectBtn(() => openLogCenter({ hub, tab: 'slow', filters: { search: dy.date } }))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </BreakdownBox>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="card-btn-view" onClick={() => { closeModal(); openLogCenter({ hub, tab: 'slow' }); }}>VIEW ALL LOGS</button>
      </div>
    </>));
  };

  const showNS = () => {
    if (!d) return;
    const nsAvg = d.daily && d.daily.length ? +(d.daily.reduce((s, dy) => s + (dy.ns || 0), 0) / d.daily.length).toFixed(1) : 0;
    const nsC = nsAvg >= 95 ? 'var(--green)' : nsAvg >= 80 ? 'var(--yellow)' : 'var(--red)';
    const recent = [...allSourceDaily(hub, d)].reverse().slice(0, 14);
    showModal('', (<>
      <DebugHeader metric="NORTH STAR" formula="ROUND(100 × COUNT(latency_ms < 1000) / NULLIF(COUNT(latency_ms IS NOT NULL), 0), 2)" />
      <StatCells cells={[{ label: 'NORTH STAR', val: `${nsAvg}%`, color: nsC }]} />
      <BreakdownBox title="DAILY TREND">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead><tr><th style={th}>DATE</th><th style={th}>TOTAL EVENTS</th><th style={th}>EVENTS UNDER 1 SEC</th><th style={th}>NORTH STAR</th><th style={th}>STATE</th><th style={th}>ACTION</th></tr></thead>
          <tbody>
            {recent.map((dy) => {
              const c = (dy.ns || 0) >= 95 ? 'var(--green)' : (dy.ns || 0) >= 80 ? 'var(--yellow)' : 'var(--red)';
              const sl = (dy.ns || 0) >= 95 ? 'Healthy' : (dy.ns || 0) >= 80 ? 'Warning' : 'Critical';
              const under1s = Math.round((dy.total * (dy.ns || 0)) / 100);
              return (
                <tr key={dy.date}>
                  <td style={tdDate}>{dy.date}</td>
                  <td style={{ ...td, color: '#fafafa', fontWeight: 600 }}>{dy.total.toLocaleString()}</td>
                  <td style={{ ...td, color: '#fafafa' }}>{under1s.toLocaleString()}</td>
                  <td style={{ ...td, color: c, fontWeight: 600 }}>{(dy.ns || 0).toFixed(1)}%</td>
                  <td style={td}><PillState color={c} label={sl} /></td>
                  <td style={td}>{inspectBtn(() => openLogCenter({ hub, tab: 'slow', filters: { search: dy.date } }))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </BreakdownBox>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="card-btn-view" onClick={() => { closeModal(); openLogCenter({ hub, tab: 'slow' }); }}>VIEW ALL LOGS</button>
      </div>
    </>));
  };

  return { showRel, showSpeed, showNS };
}
