/** Shared small components: Modal, InfoButton, TargetPill, EventTable,
 *  KV row — visually identical to the vanilla templates. */
import { useState, useRef, useEffect, type CSSProperties, type ReactNode } from 'react';
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
        <div style={{ position: 'relative' }}>{modal.body}</div>
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
export function InfoButton({ k, plain, style, withHr }: { k: string; plain?: boolean; style?: CSSProperties; withHr?: boolean }) {
  const { showModal } = useDash();
  const open = (e: React.MouseEvent) => {
    e.stopPropagation();
    const item = INFO[k];
    if (!item) return;
    showModal(item.title, (
      <>
        {withHr && <hr style={{ border: 'none', borderBottom: '1px solid var(--border)', margin: '0 0 16px 0' }} />}
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.9 }}
          dangerouslySetInnerHTML={{ __html: infoBodyHtml(item.body) }} />
      </>
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
      fontSize: 9, color: 'var(--muted)', background: 'var(--bg)',
      border: '1px solid var(--border2)', borderRadius: 12, padding: '3px 8px',
      fontWeight: 500, whiteSpace: 'nowrap',
    }}>
      Target {t.lbl}
    </span>
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
  const hasEvents = events && events.length > 0;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>{cols.map((c) => <th key={c.key} style={{ whiteSpace: 'nowrap', padding: '8px 12px' }}>{c.label}</th>)}</tr>
        </thead>
        {hasEvents && (
          <tbody>
            {events.map((e, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c.key} style={{ fontSize: 10, whiteSpace: 'nowrap', padding: '8px 12px' }}>
                    {e[c.key] !== undefined && e[c.key] !== null ? (typeof e[c.key] === 'object' ? e[c.key] as ReactNode : String(e[c.key])) : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        )}
      </table>
      {!hasEvents && (
        <div style={{ textAlign: 'center', padding: '24px 0', fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>
          No Data
        </div>
      )}
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

export function SearchableSelect({
  label,
  value,
  onChange,
  options,
  placeholder = "Search...",
  minWidth = 160,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  options: { label: string; value: string }[];
  placeholder?: string;
  minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClick);
    }
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const filtered = options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()));
  const selectedLabel = options.find(o => o.value === value)?.label || label;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button 
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
          background: 'var(--surface2)', border: '1px solid var(--border)',
          borderRadius: 6, color: value ? '#fff' : 'var(--muted)', fontSize: 11, fontWeight: 600,
          cursor: 'pointer'
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface2)'; }}
      >
        {selectedLabel}
        <span style={{ fontSize: 12 }}>▾</span>
      </button>
      
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 100,
          background: 'var(--surface2)', border: '1px solid var(--border2)',
          borderRadius: 8, padding: 6, minWidth, boxShadow: 'var(--shadow-pop)',
          display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 300
        }}>
          <input 
            autoFocus
            type="text"
            placeholder={placeholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: '6px 10px', fontSize: 11, background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 4, color: '#fff', outline: 'none', marginBottom: 4
            }}
          />
          <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div
              onClick={() => { onChange(''); setOpen(false); setSearch(''); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 4,
                cursor: 'pointer', fontSize: 11, fontWeight: value === '' ? 600 : 400,
                color: value === '' ? '#fff' : 'var(--muted)', background: value === '' ? 'var(--blue-soft)' : 'transparent'
              }}
              onMouseEnter={(e) => { if (value !== '') e.currentTarget.style.background = 'var(--surface)'; }}
              onMouseLeave={(e) => { if (value !== '') e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ width: 14, height: 14, borderRadius: '50%', border: value === '' ? '2px solid #fff' : '2px solid var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {value === '' && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1' }} />}
              </div>
              All {label}
            </div>
            {filtered.map(opt => (
              <div
                key={opt.value}
                onClick={() => { onChange(opt.value); setOpen(false); setSearch(''); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 4,
                  cursor: 'pointer', fontSize: 11, fontWeight: value === opt.value ? 600 : 400,
                  color: value === opt.value ? '#fff' : 'var(--muted)', background: value === opt.value ? 'var(--blue-soft)' : 'transparent'
                }}
                onMouseEnter={(e) => { if (value !== opt.value) e.currentTarget.style.background = 'var(--surface)'; }}
                onMouseLeave={(e) => { if (value !== opt.value) e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ width: 14, height: 14, borderRadius: '50%', border: value === opt.value ? '2px solid #fff' : '2px solid var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {value === opt.value && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1' }} />}
                </div>
                {opt.label}
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: '6px 8px', fontSize: 11, color: 'var(--muted)' }}>No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
