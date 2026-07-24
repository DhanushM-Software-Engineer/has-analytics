/** App shell — header, nav bar with date-range picker, view routing, modal host. */
import { useEffect, useState } from 'react';
import { LayoutGrid, ScrollText, LoaderCircle } from 'lucide-react';
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#fff', padding: 4,
            boxShadow: '0 0 0 1px var(--border2), 0 4px 16px -4px rgba(0,0,0,.5)',
          }}>
            <img src="/assets/images/schnell_logo.png" alt="Schnell"
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
          </div>
          <div>
            <h1>Schnell Fleet Analytics</h1>
            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 1 }}>Home Automation Debugging Dashboard</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.05em' }}>PERIOD</span>
          <input type="date" className="date-input" value={fromInput} onChange={(e) => setFromInput(e.target.value)} />
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>—</span>
          <input type="date" className="date-input" value={toInput} onChange={(e) => setToInput(e.target.value)} />
          <button className="card-btn-view" style={{ padding: '6px 14px', fontSize: 11 }} onClick={() => dash.applyRange(fromInput, toInput)}>Apply</button>
        </div>
      </div>
      <div className="nav-bar">
        <button className={`nav-item ${view.kind !== 'logcenter' ? 'active' : ''}`} onClick={dash.showLanding}
          style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <LayoutGrid size={13.5} /> Fleet Overview
        </button>
        <button className={`nav-item ${view.kind === 'logcenter' ? 'active' : ''}`} onClick={() => dash.openLogCenter({})}
          style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <ScrollText size={13.5} /> Log Center
        </button>
      </div>

      {isLoading && (
        <div className="full-loader">
          <LoaderCircle size={44} style={{ animation: 'spin 1s linear infinite' }} />
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
