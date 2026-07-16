/** Shared small components: Modal, InfoButton, TargetPill, EventTable,
 *  StatusPill, KV row — visually identical to the vanilla templates. */
import type { CSSProperties, ReactNode } from 'react';
import { useDash } from '../state/DashboardContext';
import { INFO, infoBodyHtml } from '../lib/info';
import type { Target } from '../lib/constants';

export function ModalHost() {
  const { modal, closeModal } = useDash();
  if (!modal) return null;
  return (
    <div className="modal-overlay show" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal">
        <h2>
          <span>{modal.title}</span>
          <span className="close" onClick={closeModal}>✕</span>
        </h2>
        <div>{modal.body}</div>
      </div>
    </div>
  );
}

const INFO_ICON = (
  <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="1.5" fill="none"
    strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', opacity: 0.6 }}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

/** ⓘ button that opens the ported info text. `plain` renders the text "ⓘ" style. */
export function InfoButton({ k, plain, style }: { k: string; plain?: boolean; style?: CSSProperties }) {
  const { showModal } = useDash();
  const open = (e: React.MouseEvent) => {
    e.stopPropagation();
    const item = INFO[k];
    if (!item) return;
    showModal(item.title, (
      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.9 }}
        dangerouslySetInnerHTML={{ __html: infoBodyHtml(item.body) }} />
    ));
  };
  if (plain) return <button className="info-btn" onClick={open} style={style}>ⓘ</button>;
  return (
    <button className="info-btn" onClick={open} style={{ border: 'none', background: 'none', padding: 0, ...style }}>
      {INFO_ICON}
    </button>
  );
}

export function TargetPill({ t }: { t: Target }) {
  return (
    <span style={{
      fontSize: 9, color: 'var(--muted)', background: 'var(--surface2)',
      border: '1px solid var(--border)', borderRadius: 12, padding: '3px 8px',
      fontWeight: 500, whiteSpace: 'nowrap',
    }}>
      Target {t.lbl}
    </span>
  );
}

/** Coloured status pill (Healthy / Warning / Critical / …). */
export function StatusPill({ color, label }: { color: string; label: string }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--surface)',
      border: `1px solid ${color}`, borderRadius: 12, padding: '3px 8px', fontSize: 10,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      <span style={{ color }}>{label}</span>
    </div>
  );
}

/** Key/value row used across drill-down modals (mirrors the vanilla row()). */
export function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr>
      <td style={{ color: 'var(--muted)', padding: '6px 16px 6px 0', whiteSpace: 'nowrap' }}>{label}</td>
      <td style={{ padding: '6px 0' }}>{children}</td>
    </tr>
  );
}

export interface EvCol { key: string; label: string }

/** Sample-events table (mirrors evTable): generic rows keyed by col.key. */
export function EventTable({ events, cols }: { events: Record<string, unknown>[]; cols: EvCol[] }) {
  if (!events || !events.length) return <p className="dbg-empty">No events in sample.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>{cols.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c.key} style={{ fontSize: 10 }}>
                  {e[c.key] !== undefined && e[c.key] !== null ? String(e[c.key]) : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "View in Log Center →" CTA footer. */
export function LcCta({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="modal-cta">
      <button className="modal-cta-btn" onClick={onClick}>{label}</button>
    </div>
  );
}
