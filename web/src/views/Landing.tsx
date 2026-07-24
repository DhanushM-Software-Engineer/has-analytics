/** Fleet Overview landing — fleet KPIs, status badge, hub health grid. */
import { useMemo, useState } from 'react';
import { useDash } from '../state/DashboardContext';
import { relColor, statusLabel } from '../lib/format';
import { TARGETS } from '../lib/constants';
import { InfoButton, TargetPill } from '../components/common';
import { useFleetModal, useHubListModal } from '../modals/fleetModals';

const titleStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  fontSize: 12, fontWeight: 700, color: '#fafafa',
};

export function Landing() {
  const dash = useDash();
  const { D, openHub, openLogCenter } = dash;
  const showFleetModal = useFleetModal();
  const showHubList = useHubListModal();
  const [search, setSearch] = useState('');

  const hubs = Object.keys(D);

  const fleet = useMemo(() => {
    let fActivity = 0, fActSucc = 0, fActFail = 0;
    const fLatencies: number[] = [], fNS: number[] = [];
    hubs.forEach((h) => {
      const d = D[h]!;
      fActivity += d.total_activity ?? d.total;
      fActSucc += d.activity_success ?? d.success;
      fActFail += d.activity_fail ?? (d.total - d.success);
      const p = d.speed.local_e2e.p50;
      if (d.total && p != null) fLatencies.push(p);
      (d.daily || []).forEach((dy) => { if (dy.ns != null) fNS.push(dy.ns); });
    });
    const fRel = fActivity > 0 ? +((fActSucc / fActivity) * 100).toFixed(2) : 0;
    const fP50 = (() => {
      if (!fLatencies.length) return 0;
      const s = [...fLatencies].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 === 0 ? Math.round((s[m - 1]! + s[m]!) / 2) : Math.round(s[m]!);
    })();
    const fNSavg = fNS.length > 0 ? +(fNS.reduce((a, b) => a + b, 0) / fNS.length).toFixed(1) : 0;
    return { fActivity, fActSucc, fActFail, fRel, fP50, fNSavg };
  }, [D, hubs]);

  const hubRel = (h: string) => D[h]!.activity_reliability ?? D[h]!.reliability;
  const actHubs = hubs.filter((h) => (D[h]!.total_activity ?? D[h]!.total) > 0);
  const anyCritical = actHubs.some((h) => hubRel(h) <= 93);
  const anyWarning = actHubs.some((h) => hubRel(h) <= 97 && hubRel(h) > 93);
  const badge = !actHubs.length
    ? { color: 'var(--muted)', label: 'No activity in range', pulse: false }
    : anyCritical ? { color: 'var(--red)', label: 'Critical', pulse: false }
    : anyWarning ? { color: 'var(--yellow)', label: 'Warning', pulse: false }
    : { color: 'var(--green)', label: 'All Systems Operational', pulse: true };

  const getScore = (h: string) => {
    const d = D[h];
    if (!d) return 4;
    const act = d.total_activity ?? d.total;
    if (!act || act <= 0) return 4;
    const rel = d.activity_reliability ?? d.reliability;
    if (rel < 95 || (d.total && d.speed && d.speed.local_e2e.p50 > 1000)) return 1;
    if (rel < 97 || (d.total && d.speed && d.speed.local_e2e.p50 > 800)) return 2;
    return 3;
  };

  const term = search.toLowerCase().trim();
  const shownHubs = [...hubs].sort((a, b) => getScore(a) - getScore(b))
    .filter((h) => !term || h.toLowerCase().includes(term));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <h2 style={{ fontSize: 17, color: '#fafafa', fontWeight: 700, letterSpacing: '-.3px', textTransform: 'uppercase' }}>FLEET OVERVIEW</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="hub-count-btn" onClick={showHubList}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--muted)', display: 'inline-block' }} />
            <span>{hubs.length} Hubs</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: `1px solid ${badge.color}`, borderRadius: 20, padding: '6px 14px', fontSize: 11, fontWeight: 500 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: badge.color, display: 'inline-block', animation: badge.pulse ? 'pulse 2s infinite' : undefined }} />
            <span style={{ color: badge.color }}>{badge.label}</span>
          </div>
        </div>
      </div>

      <div className="kpi-row">
        <div className="kpi">
          <div className="label" style={titleStyle}>TOTAL EVENTS<InfoButton k="fleet_total" withHr /></div>
          <div className="value">{fleet.fActivity.toLocaleString()}</div>
          <div className="sub">{hubs.length} Hubs</div>
        </div>
        <div className="kpi" onClick={() => showFleetModal('reliability')}>
          <div className="label" style={titleStyle}>RELIABILITY<InfoButton k="fleet_reliability" withHr /></div>
          <div className="value" style={{ color: fleet.fActivity ? relColor(fleet.fRel) : 'var(--muted)' }}>
            {fleet.fActivity ? `${fleet.fRel}%` : '—'}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
            <span className="sub" style={{ margin: 0 }}>
              {fleet.fActivity ? `${fleet.fActSucc.toLocaleString()} Success, ${fleet.fActFail.toLocaleString()} Failures` : 'no activity'}
            </span>
            {fleet.fActivity ? <TargetPill t={TARGETS.reliability!} /> : null}
          </div>
        </div>
        <div className="kpi" onClick={() => showFleetModal('latency')}>
          <div className="label" style={titleStyle}>P50 SPEED<InfoButton k="fleet_latency" withHr /></div>
          <div className="value">{fleet.fP50}ms</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
            <span className="sub" style={{ margin: 0 }}>Median Response Time</span>
            <TargetPill t={TARGETS.p50Local!} />
          </div>
        </div>
        <div className="kpi" onClick={() => showFleetModal('northstar')}>
          <div className="label" style={titleStyle}>NORTH STAR<InfoButton k="fleet_northstar" withHr /></div>
          <div className="value" style={{ color: fleet.fNSavg >= 95 ? 'var(--green)' : fleet.fNSavg >= 80 ? 'var(--yellow)' : 'var(--red)' }}>
            {fleet.fNSavg}%
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
            <span className="sub" style={{ margin: 0 }}>Actions completed in &lt; 1 second</span>
            <TargetPill t={TARGETS.northStar!} />
          </div>
        </div>
      </div>

      <div className="hub-fleet-section">
        <div className="hub-fleet-bar">
          <div><div style={{ fontSize: 13, fontWeight: 600, color: '#fafafa' }}>HUB HEALTH FLEET</div></div>
          <div className="hub-search-wrap">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input className="hub-search-input" type="text" placeholder="Search Any Hub"
              value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
          </div>
        </div>
        <div className="hub-fleet-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))', gap: 16 }}>
            {shownHubs.map((h) => {
              const d = D[h]!;
              const activity = d.total_activity ?? d.total;
              const arel = d.activity_reliability ?? d.reliability;
              const hasAct = activity > 0;
              const rc = hasAct ? relColor(arel) : 'var(--muted)';
              const sl = hasAct ? statusLabel(arel) : 'No activity';
              const failCount = d.activity_fail ?? (d.total - d.success);
              const nsNS = d.daily && d.daily.length
                ? (d.daily.reduce((s, dy) => s + (dy.ns || 0), 0) / d.daily.length).toFixed(1) + '%'
                : '—';
              const metric = (label: string, val: React.ReactNode, color = '#fafafa') => (
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap', marginBottom: 8 }}>{label}</div>
                  <div style={{ fontSize: 15, color, fontWeight: 700 }}>{val}</div>
                </div>
              );
              const div = <div style={{ width: 1, height: 44, background: 'var(--border2)' }} />;
              return (
                <div key={h} className="hub-grid-card" onClick={() => openHub(h)}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 16 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#fafafa', fontFamily: 'monospace', letterSpacing: '0.5px' }}>{h.toUpperCase()}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: `1px solid ${rc}`, borderRadius: 20, padding: '4px 12px', fontSize: 11, fontWeight: 500 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: rc, display: 'inline-block' }} />
                      <span style={{ color: rc }}>{sl}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, marginBottom: 30, gap: 4 }}>
                    {metric('TOTAL EVENTS', activity.toLocaleString())}
                    {div}
                    {metric('RELIABILITY', hasAct ? `${arel}%` : '—', rc)}
                    {div}
                    {metric('P50 SPEED', d.total && d.speed.local_e2e.p50 != null ? `${d.speed.local_e2e.p50}ms` : '—')}
                    {div}
                    {metric('NORTH STAR', nsNS)}
                    {div}
                    {metric('FAILURES', hasAct ? failCount : '—')}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button className="card-btn-investigate"
                      onClick={(e) => { e.stopPropagation(); openLogCenter({ hub: h, tab: 'failures' }); }}>Investigate</button>
                    <button className="card-btn-view">View</button>
                  </div>
                </div>
              );
            })}
          </div>
          {shownHubs.length === 0 && <div className="hub-empty-state">No hubs match your search.</div>}
        </div>
      </div>
    </div>
  );
}
