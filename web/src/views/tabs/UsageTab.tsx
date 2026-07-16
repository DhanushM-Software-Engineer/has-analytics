/** Usage tab — Overall Usage donut (Hub = direct + auto + scene), Usage Trend
 *  (stacked HUB/APP/DOCK), 5 KPI tiles with calculated-formula drill-downs,
 *  Active SNAP devices, Dock Usage panel. Ported 1:1 incl. our fixes. */
import { useMemo } from 'react';
import { Bar, Doughnut, Pie } from 'react-chartjs-2';
import '../../charts/setup';
import type { HubDetail } from '../../types/api';
import { allSourceDaily, buildEventPool } from '../../lib/pool';
import { InfoButton, KV, EventTable, LcCta } from '../../components/common';
import { useDash } from '../../state/DashboardContext';

type UsageModalType = 'auto' | 'scene' | 'devices' | 'app' | 'dock' | 'ha_ui';

export function UsageTab({ hub, d }: { hub: string; d: HubDetail }) {
  const dash = useDash();
  const u = d.usage;
  const daily = useMemo(() => allSourceDaily(hub, d), [hub, d]);

  const hubUse = u.hub_total ?? ((u.hub_scene_total || 0) + (u.hub_auto_total || 0) + (u.hub_direct_total || 0));

  const showUsageModal = (type: UsageModalType) => {
    const app = u.app || 0, docklet = u.docklet || 0;
    const days = dash.daysCount();
    let title = '';
    let lcOpts: Parameters<typeof dash.openLogCenter>[0] = {};
    let body: React.ReactNode = null;

    if (type === 'auto') {
      title = 'Automation / Day';
      lcOpts = { hub, tab: 'all', ucFilter: 'Automation Run (Hub)', context: { label: 'Hub-Recorded Automation Runs', desc: `${hub.toUpperCase()} · ${u.hub_auto_total || 0} runs from ha_logs · ${dash.periodLabel()}` } };
      body = (
        <table style={{ fontSize: 12 }}><tbody>
          <KV label="Formula"><code style={{ fontSize: 11, color: '#fafafa' }}>{u.hub_auto_total || 0} runs ÷ {days} days = {u.hub_auto_per_day || 0}/day</code></KV>
          <KV label="Hub-recorded runs (tile value)"><strong style={{ fontSize: 16 }}>{u.hub_auto_total || 0}</strong> <span style={{ fontSize: 10, color: 'var(--muted)' }}>ha_logs automation_triggered — recorded even when the app is closed</span></KV>
          <KV label="Per Day"><strong>{u.hub_auto_per_day || 0}</strong></KV>
          <KV label="Why hub-recorded?"><span style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--muted)' }}>The app only observes changes while it is open, so its automation counts are inconsistent. The hub records every run.</span></KV>
        </tbody></table>
      );
    } else if (type === 'scene') {
      title = 'Scene / Day';
      lcOpts = { hub, tab: 'all', ucFilter: 'Scene Activated (Hub)', context: { label: 'Hub-Recorded Scene Activations', desc: `${hub.toUpperCase()} · ${u.hub_scene_total || 0} activations from ha_logs · ${dash.periodLabel()}` } };
      body = (
        <table style={{ fontSize: 12 }}><tbody>
          <KV label="Formula"><code style={{ fontSize: 11, color: '#fafafa' }}>{u.hub_scene_total || 0} activations ÷ {days} days = {u.hub_scene_per_day || 0}/day</code></KV>
          <KV label="Hub-recorded activations (tile value)"><strong style={{ fontSize: 16 }}>{u.hub_scene_total || 0}</strong> <span style={{ fontSize: 10, color: 'var(--muted)' }}>ha_logs scene call_service — recorded even when the app is closed</span></KV>
          <KV label="Per Day"><strong>{u.hub_scene_per_day || 0}</strong></KV>
          <KV label="Why hub-recorded?"><span style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--muted)' }}>The app only observes activations while it is open and can log state-refresh bursts as activations, so its scene counts are inconsistent. The hub records every activation.</span></KV>
        </tbody></table>
      );
    } else if (type === 'devices') {
      title = 'Active SNAP Devices';
      lcOpts = { hub, tab: 'all', context: { label: 'All Device Events', desc: `${hub.toUpperCase()} · all physical SNAP device activity` } };
      body = (
        <table style={{ fontSize: 12 }}><tbody>
          <KV label="Count"><strong style={{ fontSize: 20 }}>{u.snap_devices || 0}</strong></KV>
          <KV label="What counts">Physical SNAP-connected devices that had at least one event in this period</KV>
          <KV label="Excluded">scene.*, automation.*, script.*, group.* entities — only real device domains count</KV>
        </tbody></table>
      );
    } else if (type === 'app') {
      title = 'App Usage Ratio';
      lcOpts = { hub, tab: 'all', srcFilter: 'App Control', context: { label: 'App (Local) Events', desc: `${hub.toUpperCase()} · ${app} local app events · ${dash.periodLabel()}` } };
      body = (
        <table style={{ fontSize: 12 }}><tbody>
          <KV label="Formula">App ÷ (App + Dock + Hub)</KV>
          <KV label="App Events"><strong style={{ fontSize: 16, color: 'var(--blue)' }}>{app}</strong></KV>
          <KV label="Dock Events">{docklet}</KV>
          <KV label="Hub Events">{hubUse}</KV>
          <KV label="Ratio"><strong style={{ fontSize: 16, color: 'var(--blue)' }}>{u.app_ratio || 0}%</strong></KV>
        </tbody></table>
      );
    } else if (type === 'dock') {
      title = 'Dock Usage Ratio';
      lcOpts = { hub, tab: 'all', srcFilter: 'Dock Control', context: { label: 'Dock Control Events', desc: `${hub.toUpperCase()} · ${docklet} dock events · ${dash.periodLabel()}` } };
      body = (
        <table style={{ fontSize: 12 }}><tbody>
          <KV label="Formula">Dock ÷ (App + Dock + Hub)</KV>
          <KV label="Dock Events"><strong style={{ fontSize: 16, color: 'var(--green)' }}>{docklet}</strong></KV>
          <KV label="App Events">{app}</KV>
          <KV label="Hub Events">{hubUse}</KV>
          <KV label="Ratio"><strong style={{ fontSize: 16, color: 'var(--green)' }}>{u.dock_ratio || 0}%</strong></KV>
        </tbody></table>
      );
    } else {
      title = 'Direct Hub Control';
      lcOpts = { hub, tab: 'all', ucFilter: 'Hub Control', context: { label: 'Direct Hub Control Events', desc: `${hub.toUpperCase()} · ${u.hub_direct_total || 0} devices driven directly from the hub's own Home Assistant screen` } };
      body = (
        <table style={{ fontSize: 12 }}><tbody>
          <KV label="Formula">Controllable devices (light/switch/fan/…) actuated with actuation_source ha:* — the hub UI, not the app, a dock, an automation or a scene</KV>
          <KV label="Count (tile value)"><strong style={{ fontSize: 16 }}>{u.hub_direct_total || 0}</strong></KV>
          <KV label="Per Day"><strong>{u.hub_direct_per_day || 0}</strong></KV>
          <KV label={'Part of "Hub"'}>
            <span style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--muted)' }}>
              Counted in Total Events / Reliability and grouped under the <strong>Hub</strong> source together with automation runs ({u.hub_auto_total || 0}) and scene activations ({u.hub_scene_total || 0}). The hub's <code>actuation_source</code> field records the real origin, so hub-screen control is separated from app-relayed commands.
            </span>
          </KV>
        </tbody></table>
      );
    }

    // Hub-recorded sources get a real sample of the actual events inline.
    const ucForType: Partial<Record<UsageModalType, string>> = {
      auto: 'Automation Run (Hub)', scene: 'Scene Activated (Hub)', ha_ui: 'Hub Control',
    };
    const ucMatch = ucForType[type];
    let sample: React.ReactNode = null;
    if (ucMatch) {
      const evs = buildEventPool(hub, d).filter((e) => e.uc === ucMatch);
      sample = (
        <div className="dbg-section" style={{ marginTop: 12 }}>
          <div className="dbg-section-hdr">
            <span className="dbg-section-title">Sample Events ({evs.length})</span>
            <button className="dbg-lc-link" onClick={() => dash.openLogCenter(lcOpts)}>View in Log Center →</button>
          </div>
          {evs.length
            ? (<>
                <EventTable events={evs.slice(0, 15) as unknown as Record<string, unknown>[]}
                  cols={[
                    { key: 'ts', label: 'Time' }, { key: 'dev', label: 'Device' }, { key: 'room', label: 'Room' },
                    { key: 'action', label: 'Action' }, { key: 'src', label: 'Source' },
                  ]} />
                {evs.length > 15 ? <p style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>Showing 15 of {evs.length}.</p> : null}
              </>)
            : <div className="dbg-empty">No {title} events in the selected period.</div>}
        </div>
      );
    }

    dash.showModal(title, (<>
      {body}
      {sample}
      <LcCta label={`View ${title} in Log Center →`} onClick={() => dash.openLogCenter(lcOpts)} />
    </>));
  };

  // ── Dock usage panel numbers ──────────────────────────────────────────────
  const dockUsage = d.dock_usage || { total: 0, by_action: {}, by_docklet: {}, daily: [] };
  const pool = useMemo(() => buildEventPool(hub, d), [hub, d]);
  const dockEvs = pool.filter((e) => e.src === 'docklet');
  const uniqueDocks = new Set(dockEvs.map((e) => e.dock).filter((x) => x && x !== '—')).size;
  const uniqueDocklets = new Set(dockEvs.map((e) => e.dev).filter((x) => x && x !== '—')).size;
  let toggleCnt = 0, incCnt = 0, decCnt = 0;
  for (const [k, v] of Object.entries(dockUsage.by_action)) {
    const a = (k || '').toLowerCase();
    if (a.includes('toggle')) toggleCnt += v;
    else if (a.includes('inc')) incCnt += v;
    else if (a.includes('dec')) decCnt += v;
  }

  const kpiTile = (label: string, infoKey: string, value: React.ReactNode, type: UsageModalType) => (
    <div className="kpi" style={{ padding: 16, cursor: 'pointer' }} onClick={() => showUsageModal(type)}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#fff', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {label}<InfoButton k={infoKey} />
      </div>
      <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '0 0 12px 0' }} />
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
    </div>
  );

  const legendSw = (color: string, label: string) => (
    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 10, height: 10, background: color, border: '1px solid rgba(255,255,255,0.2)' }} />
      <span>{label}</span>
    </div>
  );

  const srcLabels = ['App (Local)', 'Remote App', 'Dock Control', 'Hub'];
  const srcData = [u.app || 0, u.remote || 0, u.docklet || 0, hubUse];

  return (<>
    <div className="grid-2" style={{ marginBottom: 16 }}>
      <div className="kpi" style={{ marginBottom: 0, cursor: 'default' }}>
        <h3 style={{ fontSize: 12, fontWeight: 700, color: '#fff', margin: '0 0 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          OVERALL USAGE<InfoButton k="overall_usage" />
        </h3>
        <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '0 0 12px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'center', gap: 16, fontSize: 11, color: 'rgba(255,255,255,0.7)', marginBottom: 12, flexWrap: 'wrap' }}>
          {legendSw('#a78bfa', 'HUB')}
          {legendSw('#6366f1', 'APP (Local)')}
          {legendSw('#f59e0b', 'DOCK')}
          {legendSw('#10b981', 'APP (Remote)')}
        </div>
        <div className="chart-box" style={{ height: 260 }}>
          <Doughnut
            data={{
              labels: srcLabels,
              datasets: [{ data: srcData, backgroundColor: ['#6366f1', '#10b981', '#f59e0b', '#a78bfa'], borderWidth: 0 }],
            }}
            options={{
              responsive: true, maintainAspectRatio: false, cutout: '65%',
              onClick: (_e, els) => {
                if (!els.length) return;
                const src = srcLabels[els[0]!.index];
                if (!src) return;
                dash.openLogCenter({ hub, tab: 'all', srcFilter: src, context: { label: `${src} Events`, desc: `${hub.toUpperCase()} · all events from this source` } });
              },
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: (ctx) => {
                      const v = ctx.parsed;
                      const total = (ctx.chart.data.datasets[0]!.data as number[]).reduce((a, b) => a + b, 0);
                      const pct = total > 0 ? ((v / total) * 100).toFixed(1) : 0;
                      return ` Events: ${v} | Percentage: ${pct}%`;
                    },
                  },
                },
              },
            }}
          />
        </div>
      </div>

      <div className="kpi" style={{ marginBottom: 0, cursor: 'default' }}>
        <h3 style={{ fontSize: 12, fontWeight: 700, color: '#fff', margin: '0 0 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          USAGE TREND<InfoButton k="usage_trend" />
        </h3>
        <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '0 0 12px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'center', gap: 16, fontSize: 11, color: 'rgba(255,255,255,0.7)', marginBottom: 12, flexWrap: 'wrap' }}>
          {legendSw('#a78bfa', 'HUB')}
          {legendSw('#6366f1', 'APP')}
          {legendSw('#f59e0b', 'DOCK')}
        </div>
        <div className="chart-box" style={{ height: 260 }}>
          <Bar
            data={{
              labels: daily.map((x) => { const p = x.date.split('-'); return `${p[2]}-${p[1]}`; }),
              datasets: [
                { label: 'HUB', data: daily.map((x) => x.hub || 0), backgroundColor: '#a78bfa' },
                { label: 'APP', data: daily.map((x) => x.app || 0), backgroundColor: '#6366f1' },
                { label: 'DOCK', data: daily.map((x) => x.dock || 0), backgroundColor: '#f59e0b' },
              ],
            }}
            options={{
              responsive: true, maintainAspectRatio: false,
              onClick: (_e, els) => {
                if (!els.length) return;
                const x = daily[els[0]!.index];
                if (!x) return;
                const tot = (x.app || 0) + (x.dock || 0) + (x.hub || 0);
                dash.showModal(`Usage — ${x.date}`, (<>
                  <table style={{ fontSize: 12, marginBottom: 4 }}><tbody>
                    <KV label="Date"><strong>{x.date}</strong></KV>
                    <KV label="App"><strong style={{ color: '#6366f1' }}>{x.app || 0}</strong></KV>
                    <KV label="Dock"><strong style={{ color: '#f59e0b' }}>{x.dock || 0}</strong></KV>
                    <KV label="Hub"><strong style={{ color: '#a78bfa' }}>{x.hub || 0}</strong> <span style={{ fontSize: 10, color: 'var(--muted)' }}>(direct + automations + scenes)</span></KV>
                    <KV label="Total"><strong style={{ fontSize: 16 }}>{tot}</strong></KV>
                  </tbody></table>
                  <LcCta label={`View ${x.date} in Log Center →`}
                    onClick={() => dash.openLogCenter({ hub, tab: 'all', filters: { search: x.date }, context: { label: `Usage on ${x.date}`, desc: `${hub.toUpperCase()} · ${tot} events` } })} />
                </>));
              },
              scales: {
                x: { title: { display: true, text: 'Date' }, stacked: true, grid: { display: false } },
                y: { title: { display: true, text: 'Events' }, stacked: true, grid: { color: 'rgba(255,255,255,0.05)' } },
              },
              plugins: {
                legend: { display: false },
                tooltip: {
                  mode: 'index', intersect: false,
                  callbacks: {
                    label: (ctx) => {
                      const val = ctx.parsed.y ?? 0;
                      let total = 0;
                      ctx.chart.data.datasets.forEach((ds) => { total += Number(ds.data[ctx.dataIndex] ?? 0); });
                      const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
                      return `${ctx.dataset.label}: ${val} (${pct}%)`;
                    },
                  },
                },
              },
            }}
          />
        </div>
      </div>
    </div>

    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
      <div className="kpi" style={{ padding: '10px 20px', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}
        onClick={() => showUsageModal('devices')}>
        ACTIVE SNAP DEVICES - {u.snap_devices || 0}
        <InfoButton k="usage_snap_devices" />
      </div>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 16 }}>
      {kpiTile('AUTOMATION / DAY', 'usage_auto', u.hub_auto_per_day || 0, 'auto')}
      {kpiTile('SCENE / DAY', 'usage_scene', u.hub_scene_per_day || 0, 'scene')}
      {kpiTile('APP USAGE RATIO', 'usage_app', `${u.app_ratio || 0}%`, 'app')}
      {kpiTile('DOCK USAGE RATIO', 'usage_dock', `${u.dock_ratio || 0}%`, 'dock')}
      {kpiTile('DIRECT HUB CONTROL', 'usage_ha_ui', u.hub_direct_total || 0, 'ha_ui')}
    </div>

    {dockUsage.total > 0 && (
      <div className="kpi" style={{ marginTop: 16, cursor: 'default', padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          DOCK USAGE<InfoButton k="dock_usage" />
        </div>
        <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '0 0 16px 0' }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 16 }}>
          {[
            { l: 'TOTAL DOCK EVENTS', v: dockUsage.total },
            { l: 'TOTAL DOCKS', v: uniqueDocks },
            { l: 'ACTIVE DOCKLETS', v: uniqueDocklets },
          ].map((c) => (
            <div key={c.l} className="kpi" style={{ padding: 16, textAlign: 'center', marginBottom: 0, cursor: 'default', background: 'rgba(0,0,0,0.25)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#fff', marginBottom: 8 }}>{c.l}</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{c.v}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="kpi" style={{ padding: 16, marginBottom: 0, cursor: 'default' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
              <span>ACTION TYPE</span><span>COUNT</span>
            </div>
            <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '0 0 12px 0' }} />
            {[
              { l: 'Toggle', v: toggleCnt, c: '#6366f1' },
              { l: 'Increment', v: incCnt, c: '#10b981' },
              { l: 'Decrement', v: decCnt, c: '#ef4444' },
            ].map((row) => (
              <div key={row.l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 10, height: 10, background: row.c, borderRadius: 2 }} />{row.l}
                </div>
                <strong>{row.v}</strong>
              </div>
            ))}
          </div>
          <div className="kpi" style={{ padding: 16, marginBottom: 0, cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="chart-box" style={{ height: 120, width: '100%', position: 'relative' }}>
              <Pie
                data={{
                  labels: ['Toggle', 'Increment', 'Decrement'],
                  datasets: [{ data: [toggleCnt, incCnt, decCnt], backgroundColor: ['#6366f1', '#10b981', '#ef4444'], borderWidth: 0 }],
                }}
                options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }}
              />
            </div>
          </div>
        </div>
      </div>
    )}
  </>);
}
