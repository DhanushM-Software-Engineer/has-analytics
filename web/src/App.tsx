/** App shell — header, nav bar with date-range picker, view routing, modal host. */
import { useEffect, useState } from 'react';
import { DashboardProvider, useDash } from './state/DashboardContext';
import { ModalHost } from './components/common';
import { Landing } from './views/Landing';
import { HubDetail } from './views/HubDetail';
import { LogCenter } from './views/LogCenter';

function Shell() {
  const dash = useDash();
  const { view, isLoading, error } = dash;
  const [fromInput, setFromInput] = useState(dash.from);
  const [toInput, setToInput] = useState(dash.to);

  useEffect(() => { setFromInput(dash.from); setToInput(dash.to); }, [dash.from, dash.to]);

  return (
    <>
      <div className="header">
        <h1>Home Automation Debugging Dashboard</h1>
      </div>
      <div className="nav-bar" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex' }}>
          <button className={`nav-item ${view.kind !== 'logcenter' ? 'active' : ''}`} onClick={dash.showLanding}>Fleet Overview</button>
          <button className={`nav-item ${view.kind === 'logcenter' ? 'active' : ''}`} onClick={() => dash.openLogCenter({})}>Log Center</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '0 4px' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>Period:</span>
          <input type="date" className="date-input" value={fromInput} onChange={(e) => setFromInput(e.target.value)} />
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>—</span>
          <input type="date" className="date-input" value={toInput} onChange={(e) => setToInput(e.target.value)} />
          <button className="apply-btn" onClick={() => dash.applyRange(fromInput, toInput)}>Apply</button>
        </div>
      </div>

      {isLoading && (
        <div className="full-loader">
          <svg viewBox="0 0 24 24" width="48" height="48" style={{ animation: 'spin 1s linear infinite', fill: 'currentColor' }}>
            <path d="M12,4V2A10,10 0 0,0 2,12H4A8,8 0 0,1 12,4Z" />
          </svg>
        </div>
      )}

      {error ? (
        <div className="main">
          <div className="panel" style={{ borderColor: 'var(--red)' }}>
            <div style={{ color: 'var(--red)', fontWeight: 600, marginBottom: 6 }}>Failed to load data</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{String(error)}</div>
          </div>
        </div>
      ) : view.kind === 'logcenter' ? (
        <LogCenter key={JSON.stringify(view.opts)} opts={view.opts} />
      ) : (
        <div className="main">
          {view.kind === 'landing' && !isLoading && <Landing />}
          {view.kind === 'hub' && <HubDetail hub={view.hub} tab={view.tab} />}
        </div>
      )}

      <ModalHost />
    </>
  );
}

export default function App() {
  return (
    <DashboardProvider>
      <Shell />
    </DashboardProvider>
  );
}
