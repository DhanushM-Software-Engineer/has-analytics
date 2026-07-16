/** Formatting / classification helpers — ported 1:1 from dashboard_app.js. */

export function tsMs(ts: string | null | undefined): number | null {
  if (!ts || ts === '—') return null;
  try {
    const t = new Date(ts.replace(' ', 'T')).getTime();
    return isNaN(t) ? null : t;
  } catch {
    return null;
  }
}

export function msDiff(a: string | null | undefined, b: string | null | undefined): number | null {
  const t1 = tsMs(a), t2 = tsMs(b);
  return t1 && t2 ? Math.abs(t2 - t1) : null;
}

export function segStatus(ms: number | null): 'tp-ok' | 'tp-warn' | 'tp-slow' {
  return !ms ? 'tp-ok' : ms > 500 ? 'tp-slow' : ms > 200 ? 'tp-warn' : 'tp-ok';
}

export function relColor(r: number): string {
  return r > 97 ? 'var(--green)' : r > 93 ? 'var(--yellow)' : 'var(--red)';
}

export function relTag(r: number): string {
  return r > 97 ? 'tag-green' : r > 93 ? 'tag-yellow' : 'tag-red';
}

export function statusLabel(r: number): string {
  return r > 97 ? 'Healthy' : r > 93 ? 'Warning' : 'Critical';
}

/** null/NaN-safe display: app-latency metrics are null on app-quiet days —
 *  render “—”, never "nullms". */
export function fmtOrDash(v: number | null | undefined, suffix = ''): string {
  return v == null || (typeof v === 'number' && isNaN(v)) ? '—' : `${v}${suffix}`;
}

export function periodLabel(from: string, to: string): string {
  if (!from || !to) return '30-day window';
  const f = (s: string) => {
    const [y, m, d] = s.split('-');
    return `${m}/${d}/${(y ?? '').slice(2)}`;
  };
  return `${f(from)}–${f(to)}`;
}

export function daysCount(from: string, to: string): number {
  if (!from || !to) return 30;
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 864e5) + 1;
}

export function defaultDates(): { from: string; to: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const f = new Date(now);
  f.setDate(f.getDate() - 30);
  return { from: fmt(f), to: fmt(now) };
}

export function devShort(dev: string | null | undefined): string {
  return (dev || '—').replace('light.snap_', '').replace('switch.snap_', '');
}
