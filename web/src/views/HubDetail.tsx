/** Hub detail — top KPI row (all-source), empty-period banner, tabs
 *  (Overall / Speed / Reliability / Usage / Node / Thread). */
import type { HubTabId } from '../state/DashboardContext';
import { useDash } from '../state/DashboardContext';
import { relColor } from '../lib/format';
import { TARGETS, matterUrl, MATTER_UI } from '../lib/constants';
import { InfoButton, TargetPill } from '../components/common';
import { useHubModals } from '../modals/hubModals';
import { OverallTab } from './tabs/OverallTab';
import { SpeedTab } from './tabs/SpeedTab';
import { ReliabilityTab } from './tabs/ReliabilityTab';
import { UsageTab } from './tabs/UsageTab';

const TABS: { id: HubTabId; label: string }[] = [
  { id: 'overall', label: 'Overall' },
  { id: 'speed', label: 'Speed' },
  { id: 'reliability', label: 'Reliability' },
  { id: 'usage', label: 'Usage' },
  { id: 'node', label: 'Node' },
  { id: 'thread', label: 'Thread' },
];

const titleStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  fontSize: 12, fontWeight: 700, color: '#fafafa',
};

export function HubDetail({ hub, tab }: { hub: string; tab: HubTabId }) {
  const dash = useDash();
  const { D, showLanding, setHubTab, openLogCenter } = dash;
  const { showRel, showSpeed, showNS } = useHubModals(hub);
  const d = D[hub];
  if (!d) return null;

  const act = d.total_activity ?? d.total;
  const arel = d.activity_reliability ?? d.reliability;
  const f = d.activity_fail ?? (d.total - d.success);
  const nsAvg = d.daily && d.daily.length ? +(d.daily.reduce((s, dy) => s + (dy.ns || 0), 0) / d.daily.length).toFixed(1) : 0;
  const nsC = nsAvg >= 95 ? 'var(--green)' : nsAvg >= 80 ? 'var(--yellow)' : 'var(--red)';
  const hubUse = d.usage?.hub_total ?? ((d.usage?.hub_scene_total || 0) + (d.usage?.hub_auto_total || 0) + (d.usage?.hub_direct_total || 0));
  const appFails = (d.failures || []).filter((x) => x.src === 'App Control' || x.src === 'Remote App').length;
  const dockFails = (d.failures || []).filter((x) => x.src === 'Dock Control').length;
  const hubFails = f - appFails - dockFails;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20, gap: 12 }}>
        <button className="btn" onClick={showLanding} style={{ padding: '6px 12px', fontSize: 16, lineHeight: 1 }}>←</button>
        <h2 style={{ fontSize: 20, color: '#fafafa', fontWeight: 700, margin: 0, fontFamily: 'monospace' }}>{hub.toUpperCase()}</h2>
      </div>

      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(5,1fr)' }}>
        <div className="kpi" onClick={() => openLogCenter({ hub, tab: 'all', context: { label: `${hub.toUpperCase()} — All Activity`, desc: `All reliable events · ${dash.periodLabel()}` } })}>
          <div className="label" style={titleStyle}>TOTAL EVENTS<InfoButton k="hub_total" withHr /></div>
          <div className="value">{act.toLocaleString()}</div>
          <div className="sub">App {d.usage?.app || 0} · Dock {d.usage?.docklet || 0} · Hub {hubUse}</div>
        </div>
        <div className="kpi" onClick={showRel}>
          <div className="label" style={titleStyle}>RELIABILITY<InfoButton k="hub_reliability" withHr /></div>
          <div className="value" style={{ color: act ? relColor(arel) : 'var(--muted)' }}>{act ? `${arel}%` : '—'}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
            <span className="sub" style={{ margin: 0 }}>
              {act ? `${(act - f).toLocaleString()} Success, ${f.toLocaleString()} Failures` : 'No activity in range'}
            </span>
            {act ? <TargetPill t={TARGETS.reliability!} /> : null}
          </div>
        </div>
        <div className="kpi" onClick={showSpeed}>
          <div className="label" style={titleStyle}>P50 SPEED<InfoButton k="hub_latency" withHr /></div>
          <div className="value" style={{ color: d.speed.local_e2e.p50 > 800 ? 'var(--yellow)' : '#fafafa' }}>
            {d.total && d.speed.local_e2e.p50 != null ? `${d.speed.local_e2e.p50}ms` : '—'}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
            <span className="sub" style={{ margin: 0 }}>Median Response Time</span>
            <TargetPill t={TARGETS.p50Local!} />
          </div>
        </div>
        <div className="kpi" style={{ cursor: 'pointer' }} onClick={showNS}>
          <div className="label" style={titleStyle}>NORTH STAR<InfoButton k="fleet_northstar" withHr /></div>
          <div className="value" style={{ color: nsC }}>{nsAvg}%</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
            <span className="sub" style={{ margin: 0 }}>Actions completed in &lt; 1 second</span>
            <TargetPill t={TARGETS.northStar!} />
          </div>
        </div>
        <div className="kpi" style={{ cursor: 'pointer' }} onClick={() => openLogCenter({ hub, tab: 'failures', context: { label: `${hub.toUpperCase()} — All Failures`, desc: `${f} failures · ${dash.periodLabel()}` } })}>
          <div className="label" style={titleStyle}>FAILURES<InfoButton k="hub_failures" withHr /></div>
          <div className="value" style={{ color: 'var(--red)' }}>{f}</div>
          <div className="sub" style={{ marginTop: 4 }}>App {appFails} · Dock {dockFails} · Hub {hubFails}</div>
        </div>
      </div>

      {!act ? (
        <div style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.35)', borderRadius: 8, padding: '14px 18px', marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--yellow)', marginBottom: 3 }}>No activity recorded in {dash.periodLabel()}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
            No app commands, dock presses, scene activations, or automation runs from any source in this date range. Pick a range that includes days with activity.
          </div>
        </div>
      ) : !d.total ? (
        <div style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.35)', borderRadius: 8, padding: '14px 18px', marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--blue)', marginBottom: 3 }}>No app commands in {dash.periodLabel()} — showing hub-recorded activity</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
            The app initiated nothing in this range, so app reliability/latency read “—”. The {act} event(s) shown come from the hub (dock presses, scene activations, automation runs) — see the heatmap, Usage, and Log Center.
          </div>
        </div>
      ) : null}

      <div className="tabs">
        {TABS.map((t) => (
          <div key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setHubTab(t.id)}>{t.label}</div>
        ))}
      </div>

      {tab === 'overall' && <OverallTab hub={hub} d={d} />}
      {tab === 'speed' && <SpeedTab hub={hub} d={d} />}
      {tab === 'reliability' && <ReliabilityTab hub={hub} d={d} />}
      {tab === 'usage' && <UsageTab hub={hub} d={d} />}
      {(tab === 'node' || tab === 'thread') && <MatterEmbed kind={tab} />}
    </div>
  );
}

/** Node / Thread pane — same-origin iframe of the built Matter UI (unchanged). */
function MatterEmbed({ kind }: { kind: 'node' | 'thread' }) {
  const url = matterUrl(kind);
  const label = kind === 'thread' ? 'Thread Network Mesh' : 'Nodes / Devices';
  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#fafafa' }}>
          Matter Server — {label}{' '}
          <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}>· live from hub {MATTER_UI.hub}</span>
        </div>
        <a href={url} target="_blank" rel="noopener noreferrer" className="btn" style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}>
          Open in new tab ↗
        </a>
      </div>
      <iframe src={url} title={`Matter ${label}`} style={{ width: '100%', height: '78vh', border: 0, background: '#fff', display: 'block' }} />
    </div>
  );
}
