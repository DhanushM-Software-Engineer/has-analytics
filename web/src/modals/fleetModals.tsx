/** Fleet-level drill-down modals (reliability / latency / northstar) and the
 *  hubs-overview modal — ported from showFleetModal / showHubListModal. */
import type { ReactNode } from 'react';
import { useDash } from '../state/DashboardContext';
import { relColor, statusLabel } from '../lib/format';

const th: React.CSSProperties = { textAlign: 'left', padding: 8, color: 'var(--muted)', borderBottom: '1px solid var(--border)' };
const td: React.CSSProperties = { padding: '10px 8px', borderBottom: '1px solid var(--border)' };

export function DebugHeader({ metric, formula }: { metric: string; formula: string }) {
  return (<>
    <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4, fontWeight: 'normal', marginTop: -24 }}>Debug View</div>
    <div style={{ fontSize: 18, fontWeight: 700, color: '#fafafa', marginBottom: 8 }}>{metric}</div>
    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 24, fontFamily: 'monospace' }}>Formula: {formula}</div>
  </>);
}

export function StatCells({ cells }: { cells: { label: string; val: ReactNode; color?: string }[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cells.length},1fr)`, gap: 12, marginBottom: 24 }}>
      {cells.map((c) => (
        <div key={c.label} style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 6, padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, marginBottom: 8 }}>{c.label}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: c.color || '#fafafa' }}>{c.val}</div>
        </div>
      ))}
    </div>
  );
}

export function BreakdownBox({ title, children }: { title: string; children: ReactNode }) {
  return (<>
    <div style={{ height: 1, background: 'var(--border)', marginBottom: 20 }} />
    <div style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 6, padding: 20, marginBottom: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#fafafa', marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  </>);
}

export function PillState({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--surface)', border: `1px solid ${color}`, borderRadius: 12, padding: '3px 8px', fontSize: 10 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      <span style={{ color }}>{label}</span>
    </div>
  );
}

export function useFleetModal() {
  const dash = useDash();
  const { D, showModal, closeModal, openLogCenter } = dash;

  return (type: 'reliability' | 'latency' | 'northstar') => {
    const hubs = Object.keys(D);
    let fTotal = 0, fSuccess = 0, fFail = 0;
    const fLatencies: { hub: string; p50: number }[] = [];
    const fNS: number[] = [];
    hubs.forEach((h) => {
      const d = D[h]!;
      fTotal += d.total_activity ?? d.total;
      fSuccess += d.activity_success ?? d.success;
      fFail += d.activity_fail ?? (d.total - d.success);
      if (d.total && d.speed.local_e2e.p50 != null) fLatencies.push({ hub: h, p50: d.speed.local_e2e.p50 });
      (d.daily || []).forEach((dy) => { if (dy.ns !== undefined && dy.ns !== null) fNS.push(dy.ns); });
    });
    const fRel = fTotal > 0 ? +((fSuccess / fTotal) * 100).toFixed(2) : 0;
    const fP50 = fLatencies.length ? Math.round(fLatencies.reduce((a, b) => a + b.p50, 0) / fLatencies.length) : 0;
    const fNSavg = fNS.length > 0 ? +(fNS.reduce((a, b) => a + b, 0) / fNS.length).toFixed(1) : 0;

    if (type === 'reliability') {
      showModal('', (<>
        <DebugHeader metric="RELIABILITY" formula="Σ Successful ÷ Σ Total (All Hubs)" />
        <StatCells cells={[
          { label: 'RELIABILITY', val: `${fRel}%`, color: relColor(fRel) },
          { label: 'SUCCESS', val: fSuccess.toLocaleString() },
          { label: 'FAILURES', val: fFail.toLocaleString() },
        ]} />
        <BreakdownBox title="HUB - WISE BREAKDOWN">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead><tr><th style={th}>HUB</th><th style={th}>RELIABILITY</th><th style={th}>FAILURES</th><th style={th}>STATE</th><th style={th}>ACTION</th></tr></thead>
            <tbody>
              {hubs.map((h) => {
                const d = D[h]!;
                const f = d.total - d.success;
                const rc = relColor(d.reliability);
                return (
                  <tr key={h}>
                    <td style={{ ...td, fontWeight: 600 }}>{h.toUpperCase()}</td>
                    <td style={{ ...td, color: rc, fontWeight: 600 }}>{d.reliability}%</td>
                    <td style={{ ...td, color: '#fafafa' }}>{f.toLocaleString()}</td>
                    <td style={td}><PillState color={rc} label={statusLabel(d.reliability)} /></td>
                    <td style={td}>
                      <button className="card-btn-view" style={{ padding: '4px 12px', fontSize: 10 }}
                        onClick={() => { closeModal(); openLogCenter({ hub: h, tab: 'failures' }); }}>Inspect →</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </BreakdownBox>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="card-btn-investigate" onClick={() => { closeModal(); openLogCenter({ tab: 'failures' }); }}>VIEW ALL FAILURES</button>
        </div>
      </>));
    } else if (type === 'latency') {
      showModal('', (<>
        <DebugHeader metric="AVG P50 SPEED" formula="Median Latency (50th Percentile) of all successful App events" />
        <StatCells cells={[{ label: 'AVG P50 SPEED', val: `${fP50}ms` }]} />
        <BreakdownBox title="HUB - WISE BREAKDOWN">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead><tr><th style={th}>HUB</th><th style={th}>P50</th><th style={th}>STATE</th><th style={th}>ACTION</th></tr></thead>
            <tbody>
              {fLatencies.map((l) => {
                const rc = l.p50 > 1000 ? 'var(--red)' : l.p50 > 800 ? 'var(--yellow)' : 'var(--green)';
                const sl = l.p50 > 1000 ? 'Critical' : l.p50 > 800 ? 'Warning' : 'Healthy';
                return (
                  <tr key={l.hub}>
                    <td style={{ ...td, fontWeight: 600 }}>{l.hub.toUpperCase()}</td>
                    <td style={{ ...td, color: rc, fontWeight: 600 }}>{l.p50}ms</td>
                    <td style={td}><PillState color={rc} label={sl} /></td>
                    <td style={td}>
                      <button className="card-btn-view" style={{ padding: '4px 12px', fontSize: 10 }}
                        onClick={() => { closeModal(); openLogCenter({ hub: l.hub, tab: 'slow' }); }}>Inspect →</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </BreakdownBox>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="card-btn-view" onClick={() => { closeModal(); openLogCenter({ tab: 'slow' }); }}>VIEW ALL LOGS</button>
        </div>
      </>));
    } else {
      const nsColor = fNSavg >= 95 ? 'var(--green)' : fNSavg >= 80 ? 'var(--yellow)' : 'var(--red)';
      showModal('', (<>
        <DebugHeader metric="NORTH STAR" formula="ROUND(100 × COUNT(latency_ms < 1000) / NULLIF(COUNT(latency_ms IS NOT NULL), 0), 2)" />
        <StatCells cells={[{ label: 'NORTH STAR', val: `${fNSavg}%`, color: nsColor }]} />
        <BreakdownBox title="HUB - WISE BREAKDOWN">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead><tr><th style={th}>HUB</th><th style={th}>NORTH STAR</th><th style={th}>STATE</th><th style={th}>ACTION</th></tr></thead>
            <tbody>
              {hubs.map((h) => {
                const d = D[h]!;
                const nsA = d.daily && d.daily.length ? +((d.daily.reduce((s, dy) => s + (dy.ns || 0), 0)) / d.daily.length).toFixed(1) : 0;
                const rc = nsA < 80 ? 'var(--red)' : nsA < 95 ? 'var(--yellow)' : 'var(--green)';
                const sl = nsA < 80 ? 'Critical' : nsA < 95 ? 'Warning' : 'Healthy';
                return (
                  <tr key={h}>
                    <td style={{ ...td, fontWeight: 600 }}>{h.toUpperCase()}</td>
                    <td style={{ ...td, color: rc, fontWeight: 600 }}>{nsA}%</td>
                    <td style={td}><PillState color={rc} label={sl} /></td>
                    <td style={td}>
                      <button className="card-btn-view" style={{ padding: '4px 12px', fontSize: 10 }}
                        onClick={() => { closeModal(); openLogCenter({ hub: h, tab: 'slow' }); }}>Inspect →</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </BreakdownBox>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="card-btn-view" onClick={() => { closeModal(); openLogCenter({ tab: 'slow' }); }}>VIEW ALL LOGS</button>
        </div>
      </>));
    }
  };
}

export function useHubListModal() {
  const { D, showModal, closeModal, openHub } = useDash();
  return () => {
    const hubs = Object.keys(D);
    showModal('HUBS OVERVIEW', (
      <div style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 6, padding: 20, marginBottom: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead><tr><th style={th}>HUB MAC ID</th><th style={th}>STATE</th><th style={th}>ACTION</th></tr></thead>
          <tbody>
            {hubs.map((h) => {
              const d = D[h]!;
              const arel = d.activity_reliability ?? d.reliability;
              const rc = relColor(arel);
              return (
                <tr key={h}>
                  <td style={{ ...td, fontWeight: 600, fontFamily: 'monospace' }}>{h.toUpperCase()}</td>
                  <td style={td}><PillState color={rc} label={statusLabel(arel)} /></td>
                  <td style={td}>
                    <button className="card-btn-view" style={{ padding: '4px 12px', fontSize: 10 }}
                      onClick={() => { closeModal(); openHub(h); }}>View Hub →</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    ));
  };
}
