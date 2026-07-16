/**
 * App-level state: date range, all-hub data (D), view routing
 * (landing / hub detail / log center), the shared modal, and Log Center opts.
 * Mirrors the vanilla globals: D, activeHub, activeFrom/activeTo, lcState, lcOrigin.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchHubs, fetchHubDetail } from '../api/client';
import type { HubDetail } from '../types/api';
import { defaultDates, periodLabel, daysCount } from '../lib/format';

export type HubTabId = 'overall' | 'speed' | 'reliability' | 'usage' | 'node' | 'thread';

export interface LcFilters { src?: string; reason?: string; search?: string }

/** openLogCenter(opts) — same shape the vanilla accepted. */
export interface LcOpts {
  hub?: string | null;
  tab?: 'failures' | 'slow' | 'all';
  filters?: LcFilters;
  context?: { label: string; desc?: string } | null;
  srcFilter?: string | null;
  ucFilter?: string | null;
  segFilter?: string | null;
  latMin?: number | null;
  latMax?: number | null;
  hourFilter?: number | null;
  dayFilter?: string | null;
}

export type View =
  | { kind: 'landing' }
  | { kind: 'hub'; hub: string; tab: HubTabId }
  | { kind: 'logcenter'; opts: LcOpts; origin: LcOrigin | null };

export interface LcOrigin { view: 'landing' | 'detail'; hub?: string; tabId?: HubTabId }

interface ModalState { title: string; body: ReactNode }

interface Ctx {
  // data
  D: Record<string, HubDetail>;
  hubs: string[];
  isLoading: boolean;
  error: unknown;
  // date range
  from: string;
  to: string;
  applyRange(from: string, to: string): void;
  periodLabel(): string;
  daysCount(): number;
  // routing
  view: View;
  openHub(hub: string): void;
  showLanding(): void;
  setHubTab(tab: HubTabId): void;
  openLogCenter(opts?: LcOpts): void;
  lcGoBack(): void;
  // modal
  modal: ModalState | null;
  showModal(title: string, body: ReactNode): void;
  closeModal(): void;
}

const DashCtx = createContext<Ctx | null>(null);

export function useDash(): Ctx {
  const ctx = useContext(DashCtx);
  if (!ctx) throw new Error('useDash outside provider');
  return ctx;
}

async function fetchAll(from: string, to: string): Promise<{ hubs: string[]; D: Record<string, HubDetail> }> {
  const { hubs } = await fetchHubs();
  const D: Record<string, HubDetail> = {};
  await Promise.all(
    hubs.map(async (h) => {
      D[h] = await fetchHubDetail(h, from, to);
    }),
  );
  return { hubs, D };
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [{ from, to }, setRange] = useState(defaultDates());
  const [view, setView] = useState<View>({ kind: 'landing' });
  const [modal, setModal] = useState<ModalState | null>(null);

  const q = useQuery({
    queryKey: ['all-hubs', from, to],
    queryFn: () => fetchAll(from, to),
  });

  const D = q.data?.D ?? {};
  const hubs = q.data?.hubs ?? [];

  const applyRange = useCallback((f: string, t: string) => {
    if (!f || !t) return;
    if (new Date(f) > new Date(t)) { alert('Start date must be before end date.'); return; }
    if ((new Date(t).getTime() - new Date(f).getTime()) / 864e5 > 90) { alert('Maximum range is 90 days.'); return; }
    setRange({ from: f, to: t });
  }, []);

  const openHub = useCallback((hub: string) => setView({ kind: 'hub', hub, tab: 'overall' }), []);
  const showLanding = useCallback(() => setView({ kind: 'landing' }), []);
  const setHubTab = useCallback((tab: HubTabId) => {
    setView((v) => (v.kind === 'hub' ? { ...v, tab } : v));
  }, []);

  const openLogCenter = useCallback((opts: LcOpts = {}) => {
    setView((v) => {
      const origin: LcOrigin | null =
        v.kind === 'hub' ? { view: 'detail', hub: v.hub, tabId: v.tab }
        : v.kind === 'landing' ? { view: 'landing' }
        : (v as Extract<View, { kind: 'logcenter' }>).origin;
      return { kind: 'logcenter', opts, origin };
    });
    setModal(null);
  }, []);

  const lcGoBack = useCallback(() => {
    setView((v) => {
      if (v.kind !== 'logcenter' || !v.origin) return { kind: 'landing' };
      if (v.origin.view === 'detail' && v.origin.hub)
        return { kind: 'hub', hub: v.origin.hub, tab: v.origin.tabId ?? 'overall' };
      return { kind: 'landing' };
    });
  }, []);

  const showModal = useCallback((title: string, body: ReactNode) => setModal({ title, body }), []);
  const closeModal = useCallback(() => setModal(null), []);

  const value = useMemo<Ctx>(() => ({
    D, hubs, isLoading: q.isLoading, error: q.error,
    from, to, applyRange,
    periodLabel: () => periodLabel(from, to),
    daysCount: () => daysCount(from, to),
    view, openHub, showLanding, setHubTab, openLogCenter, lcGoBack,
    modal, showModal, closeModal,
  }), [D, hubs, q.isLoading, q.error, from, to, applyRange, view, openHub, showLanding, setHubTab, openLogCenter, lcGoBack, modal, showModal, closeModal]);

  return <DashCtx.Provider value={value}>{children}</DashCtx.Provider>;
}
