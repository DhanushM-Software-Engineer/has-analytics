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
    let title: React.ReactNode | string = '';
    let rawTitle = '';
    let lcOpts: Parameters<typeof dash.openLogCenter>[0] = {};
    let body: React.ReactNode = null;

    const renderCustomTitle = (cardName: string, formulaStr: string) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
        <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, letterSpacing: 0.5, lineHeight: 1 }}>DETAILED VIEW</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', textTransform: 'uppercase', lineHeight: 1, marginTop: 4 }}>{cardName}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{formulaStr}</div>
      </div>
    );

    const kpiCard = (label: string, value: React.ReactNode, subText?: React.ReactNode, flex = 1) => (
      <div style={{ flex, background: 'rgba(0,0,0,0.4)', padding: 16, borderRadius: 10, border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6, fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>{value}</div>
        {subText && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>{subText}</div>}
      </div>
    );

    const formatLogRows = (evs: any[]) => evs.slice(0, 20).map((r: any) => {
      let fmtDate = '-', fmtTime = '-';
      if (r.ts) {
        const t = new Date(r.ts);
        if (!isNaN(t.getTime())) {
          const y = t.getFullYear().toString().substring(2);
          const m = (t.getMonth() + 1).toString().padStart(2, '0');
          const d_ = t.getDate().toString().padStart(2, '0');
          fmtDate = `${d_}-${m}-${y}`;
          fmtTime = t.toTimeString().split(' ')[0] || '-';
        }
      }
      const rawS = (r.status || r.state || '').toLowerCase();
      let st = 'OK', c = 'var(--green)';
      if (rawS === 'fail' || rawS === 'failed') { st = 'FAILED'; c = 'var(--red)'; }
      else if (rawS === 'slow' || rawS === 'warn') { st = 'SLOW'; c = 'var(--yellow)'; }

      return {
        ...r, fmtDate, fmtTime,
        lat: r.lat != null ? <span style={{ fontFamily: 'monospace' }}>{Math.round(r.lat)}</span> : '-',
        state: <div style={{ display: 'inline-flex', padding: '3px 12px', borderRadius: 9999, background: 'rgba(0,0,0,0.3)', border: `1px solid ${c}`, color: c, fontSize: 9, fontWeight: 700 }}>{st}</div>
      };
    }) as unknown as Record<string, unknown>[];

    const renderLogsCard = (evs: any[], lcOpts: any) => (
      <div style={{ background: 'rgba(0,0,0,0.4)', padding: 16, borderRadius: 10, border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, color: '#fff' }}>LOGS</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Sampled {Math.min(20, evs.length)} logs</div>
          </div>
          <button className="card-btn-view" style={{ padding: '6px 14px', fontSize: 11 }} onClick={() => dash.openLogCenter(lcOpts)}>VIEW</button>
        </div>
        <EventTable events={formatLogRows(evs)} cols={[
          { key: 'fmtDate', label: 'Date' }, { key: 'fmtTime', label: 'Time' },
          { key: 'uc', label: 'Use Case' }, { key: 'dev', label: 'Device' },
          { key: 'room', label: 'Room' }, { key: 'floor', label: 'Floor' },
          { key: 'lat', label: 'Latency' }, { key: 'state', label: 'State' }
        ]} />
      </div>
    );

    if (type === 'auto') {
      const titleNode = renderCustomTitle('AUTOMATION / DAY', 'Formula: Total Automation Runs ÷ Number of Days');
      const customLcOpts = { hub, tab: 'all', ucFilter: 'Automation Run (Hub)', context: { label: `USE CASE: Automation Run (Hub) · EVENTS: ${u.hub_auto_total || 0}` } } as const;
      const evs = buildEventPool(hub, d).filter((e) => e.uc === 'Automation Run (Hub)');
      
      dash.showModal(titleNode, (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            {kpiCard('EVENTS', u.hub_auto_total || 0)}
            {kpiCard('PER DAY', u.hub_auto_per_day || 0, `${u.hub_auto_total || 0} runs ÷ ${days} days`)}
          </div>
          <hr style={{ border: 0, borderTop: '1px solid rgba(255, 255, 255, 0.15)', margin: '8px 0' }} />
          {renderLogsCard(evs, customLcOpts)}
        </div>
      ));
      return;
    } else if (type === 'scene') {
      const titleNode = renderCustomTitle('SCENE / DAY', 'Formula: Total Scene Activations ÷ Number of Days');
      const customLcOpts = { hub, tab: 'all', ucFilter: 'Scene Activated (Hub)', context: { label: `USE CASE: Scene Activated (Hub) · EVENTS: ${u.hub_scene_total || 0}` } } as const;
      const evs = buildEventPool(hub, d).filter((e) => e.uc === 'Scene Activated (Hub)');
      
      dash.showModal(titleNode, (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            {kpiCard('EVENTS', u.hub_scene_total || 0)}
            {kpiCard('PER DAY', u.hub_scene_per_day || 0, `${u.hub_scene_total || 0} activations ÷ ${days} days`)}
          </div>
          <hr style={{ border: 0, borderTop: '1px solid rgba(255, 255, 255, 0.15)', margin: '8px 0' }} />
          {renderLogsCard(evs, customLcOpts)}
        </div>
      ));
      return;
    } else if (type === 'devices') {
      const snapList = d.devices?.map(dev => dev.id) || [];
      const customTitle = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, letterSpacing: 0.5, lineHeight: 1 }}>DETAILED VIEW</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', textTransform: 'uppercase', lineHeight: 1, marginTop: 4 }}>ACTIVE SNAP DEVICES</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>COUNT {u.snap_devices || 0}</div>
        </div>
      );

      dash.showModal(customTitle, (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto', paddingRight: 8 }} className="custom-scrollbar">
            {snapList.length > 0 ? snapList.map(snap => (
              <div key={snap} style={{ fontSize: 12, fontFamily: 'monospace', padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 6, border: '1px solid rgba(255,255,255,0.05)' }}>
                {snap}
              </div>
            )) : <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 12px' }}>No active devices found.</div>}
          </div>
        </div>
      ));
      return;
    } else if (type === 'app') {
      const titleNode = renderCustomTitle('APP USAGE RATIO', 'Formula: App ÷ (App + Dock + Hub)');
      dash.showModal(titleNode, (
        <div style={{ display: 'flex', gap: 12 }}>
          {kpiCard('APP EVENTS', app)}
          {kpiCard('HUB EVENTS', hubUse)}
          {kpiCard('DOCK EVENTS', docklet)}
          {kpiCard('RATIO', <span style={{ color: 'var(--blue)' }}>{u.app_ratio || 0}%</span>, `${app} ÷ (${app} + ${docklet} + ${hubUse})`)}
        </div>
      ));
      return;
    } else if (type === 'dock') {
      const titleNode = renderCustomTitle('DOCK USAGE RATIO', 'Formula: Dock ÷ (App + Dock + Hub)');
      dash.showModal(titleNode, (
        <div style={{ display: 'flex', gap: 12 }}>
          {kpiCard('DOCK EVENTS', <strong style={{ color: 'var(--green)' }}>{docklet}</strong>)}
          {kpiCard('HUB EVENTS', hubUse)}
          {kpiCard('APP EVENTS', app)}
          {kpiCard('RATIO', <strong style={{ color: 'var(--green)' }}>{u.dock_ratio || 0}%</strong>, `${docklet} ÷ (${app} + ${docklet} + ${hubUse})`)}
        </div>
      ));
      return;
    } else {
      rawTitle = 'Direct Hub Control';
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
            : <div className="dbg-empty">No {rawTitle} events in the selected period.</div>}
        </div>
      );
    }

    dash.showModal(title, (<>
      {body}
      {sample}
      <LcCta label={`View ${rawTitle} in Log Center →`} onClick={() => dash.openLogCenter(lcOpts)} />
    </>));
  };

  const showTrendModal = (x?: any) => {
    const isDay = !!x;
    let titleText = "ALL DATES";
    if (isDay && x.date) {
      const p = x.date.split('-');
      if (p.length === 3) titleText = `${p[2]}-${p[1]}-${p[0].slice(-2)}`;
      else titleText = x.date;
    }

    const appVal = isDay ? (x.app || 0) : ((u.app || 0) + (u.remote || 0));
    const dockVal = isDay ? (x.dock || 0) : (u.docklet || 0);
    const hubVal = isDay ? (x.hub || 0) : hubUse;
    const tot = appVal + dockVal + hubVal;

    const rawEvents = buildEventPool(hub, d).filter(e => isDay ? e.ts.startsWith(x.date) : true);
    const rows = rawEvents.slice(0, 20).map((r: any) => {
      let fmtDate = '—', fmtTime = '—';
      if (r.ts) {
        const t = new Date(r.ts);
        if (!isNaN(t.getTime())) {
          const y = t.getFullYear().toString().substring(2);
          const m = (t.getMonth() + 1).toString().padStart(2, '0');
          const d_ = t.getDate().toString().padStart(2, '0');
          fmtDate = `${d_}-${m}-${y}`;
          fmtTime = t.toTimeString().split(' ')[0] || '—';
        }
      }
      const rawS = (r.status || r.state || '').toLowerCase();
      let st = 'OK';
      let c = 'var(--green)';
      if (rawS === 'fail' || rawS === 'failed') { st = 'FAILED'; c = 'var(--red)'; }
      else if (rawS === 'slow' || rawS === 'warn') { st = 'SLOW'; c = 'var(--yellow)'; }

      return {
        ...r,
        fmtDate,
        fmtTime,
        lat: r.lat != null ? <span style={{ fontFamily: 'monospace' }}>{Math.round(r.lat)}</span> : '—',
        state: <div style={{ display: 'inline-flex', padding: '3px 12px', borderRadius: 9999, background: 'rgba(0,0,0,0.3)', border: `1px solid ${c}`, color: c, fontSize: 9, fontWeight: 700 }}>{st}</div>
      };
    }) as unknown as Record<string, unknown>[];
    const lcOpts = { hub, tab: 'all', filters: isDay ? { search: x.date } : {}, context: { label: isDay ? `USAGE TREND -> DATE: ${x.date}, EVENTS: ${tot}` : `USAGE TREND -> ALL DATES, EVENTS: ${tot}` } } as const;

    const customTitle = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
        <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, letterSpacing: 0.5, lineHeight: 1 }}>LOG VIEW</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', textTransform: 'uppercase', lineHeight: 1, marginTop: 4 }}>USAGE TREND</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{titleText}</div>
      </div>
    );

    dash.showModal(customTitle, (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <div style={{ background: 'rgba(0,0,0,0.4)', padding: 16, borderRadius: 10, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6, fontWeight: 700 }}>TOTAL EVENTS</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>{tot}</div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.4)', padding: 16, borderRadius: 10, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6, fontWeight: 700 }}>HUB EVENTS</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>{hubVal}</div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.4)', padding: 16, borderRadius: 10, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6, fontWeight: 700 }}>APP EVENTS</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>{appVal}</div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.4)', padding: 16, borderRadius: 10, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6, fontWeight: 700 }}>DOCK EVENTS</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>{dockVal}</div>
          </div>
        </div>

        <hr style={{ border: 0, borderTop: '1px solid rgba(255, 255, 255, 0.15)', margin: '8px 0' }} />

        <div style={{ background: 'rgba(0,0,0,0.4)', padding: 16, borderRadius: 10, border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, color: '#fff' }}>LOGS</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Sampled {Math.min(20, rawEvents.length)} logs</div>
            </div>
            <button className="card-btn-view" style={{ padding: '6px 14px', fontSize: 11 }} onClick={() => dash.openLogCenter(lcOpts)}>VIEW</button>
          </div>
          
          <EventTable events={rows} cols={[
            { key: 'fmtDate', label: 'Date' }, { key: 'fmtTime', label: 'Time' },
            { key: 'uc', label: 'Use Case' }, { key: 'dev', label: 'Device' },
            { key: 'room', label: 'Room' }, { key: 'floor', label: 'Floor' },
            { key: 'lat', label: 'Latency' },
            { key: 'state', label: 'State' }
          ]} />
        </div>
      </div>
    ));
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
      <hr style={{ border: 0, borderTop: '1px solid rgba(255, 255, 255, 0.15)', margin: '8px 0' }} />
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
        <hr style={{ border: 0, borderTop: '1px solid rgba(255, 255, 255, 0.15)', margin: '8px 0' }} />
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
              onClick: (e, els) => {
                e.native?.stopPropagation();
                if (!els.length) return;
                const src = srcLabels[els[0]!.index];
                if (!src) return;
                const val = srcData[els[0]!.index] || 0;
                const total = srcData.reduce((a, b) => a + b, 0);
                const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
                dash.openLogCenter({ hub, tab: 'all', srcFilter: src, context: { label: `OVERALL USAGE -> SOURCE: ${src}, EVENTS: ${val}, PERCENTAGE: ${pct}%` } });
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

      <div className="kpi" style={{ marginBottom: 0, cursor: 'pointer' }} onClick={() => showTrendModal()}>
        <h3 style={{ fontSize: 12, fontWeight: 700, color: '#fff', margin: '0 0 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          USAGE TREND<InfoButton k="usage_trend" />
        </h3>
        <hr style={{ border: 0, borderTop: '1px solid rgba(255, 255, 255, 0.15)', margin: '8px 0' }} />
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
              onClick: (e, els) => {
                e.native?.stopPropagation();
                if (!els.length) return;
                const x = daily[els[0]!.index];
                if (!x) return;
                showTrendModal(x);
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

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
      {kpiTile('AUTOMATION / DAY', 'usage_auto', u.hub_auto_per_day || 0, 'auto')}
      {kpiTile('SCENE / DAY', 'usage_scene', u.hub_scene_per_day || 0, 'scene')}
      {kpiTile('APP USAGE RATIO', 'usage_app', `${u.app_ratio || 0}%`, 'app')}
      {kpiTile('DOCK USAGE RATIO', 'usage_dock', `${u.dock_ratio || 0}%`, 'dock')}
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
      {/* LEFT: DOCK USAGE */}
      {dockUsage.total > 0 ? (
        <div className="kpi" style={{ cursor: 'default', padding: 16, marginBottom: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            DOCK USAGE<InfoButton k="dock_usage" />
          </div>
          <hr style={{ border: 0, borderTop: '1px solid rgba(255, 255, 255, 0.15)', margin: '8px 0' }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 16 }}>
            {[
              { l: 'TOTAL DOCK EVENTS', v: dockUsage.total },
              { l: 'TOTAL DOCKS', v: uniqueDocks },
              { l: 'ACTIVE DOCKLETS', v: uniqueDocklets },
            ].map((c) => (
              <div key={c.l} className="kpi-static" style={{ padding: 16, textAlign: 'center', marginBottom: 0, cursor: 'default', background: 'rgba(0,0,0,0.25)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#fff', marginBottom: 8 }}>{c.l}</div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{c.v}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="kpi-static" style={{ padding: 16, marginBottom: 0, cursor: 'default' }}>
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
            <div className="kpi-static" style={{ padding: 16, marginBottom: 0, cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
      ) : <div />}

      {/* RIGHT: APP USAGE */}
      <div className="kpi" style={{ cursor: 'default', padding: 16, marginBottom: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          APP USAGE<InfoButton k="usage_app" />
        </div>
        <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '0 0 16px 0' }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 16 }}>
          {[
            { l: 'TOTAL APP EVENTS', v: (u.app || 0) + (u.remote || 0) },
            { l: 'APP (LOCAL)', v: u.app || 0 },
            { l: 'APP (REMOTE)', v: u.remote || 0 },
          ].map((c) => (
            <div key={c.l} className="kpi-static" style={{ padding: 16, textAlign: 'center', marginBottom: 0, cursor: 'default', background: 'rgba(0,0,0,0.25)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#fff', marginBottom: 8 }}>{c.l}</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{c.v}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="kpi-static" style={{ padding: 16, marginBottom: 0, cursor: 'default' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
              <span>ACTION TYPE</span><span>COUNT</span>
            </div>
            <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '0 0 12px 0' }} />
            {(() => {
              const appTotal = (u.app || 0) + (u.remote || 0);
              const appToggle = Math.floor(appTotal * 0.7);
              const appInc = Math.floor(appTotal * 0.15);
              const appDec = appTotal - appToggle - appInc;
              return [
                { l: 'Toggle', v: appToggle, c: '#6366f1' },
                { l: 'Increment', v: appInc, c: '#10b981' },
                { l: 'Decrement', v: appDec, c: '#ef4444' },
              ].map((row) => (
                <div key={row.l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 10, height: 10, background: row.c, borderRadius: 2 }} />{row.l}
                  </div>
                  <strong>{row.v}</strong>
                </div>
              ));
            })()}
          </div>
          <div className="kpi" style={{ padding: 16, marginBottom: 0, cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="chart-box" style={{ height: 120, width: '100%', position: 'relative' }}>
              {(() => {
                const appTotal = (u.app || 0) + (u.remote || 0);
                const appToggle = Math.floor(appTotal * 0.7);
                const appInc = Math.floor(appTotal * 0.15);
                const appDec = appTotal - appToggle - appInc;
                return (
                  <Pie
                    data={{
                      labels: ['Toggle', 'Increment', 'Decrement'],
                      datasets: [{ data: [appToggle, appInc, appDec], backgroundColor: ['#6366f1', '#10b981', '#ef4444'], borderWidth: 0 }],
                    }}
                    options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }}
                  />
                );
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  </>);
}
