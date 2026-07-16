/** Ported 1:1 from public/dashboard_app.js — values are the contract. */

export const MATTER_UI = {
  base: '/matter',
  hub: '192.168.0.41',
  ip: '192.168.0.41:8123',
  user: 'dhanush',
} as const;

export function matterUrl(kind: 'node' | 'thread'): string {
  const q =
    '?ac=1&ip=' + encodeURIComponent(MATTER_UI.ip) + '&user=' + encodeURIComponent(MATTER_UI.user);
  return MATTER_UI.base.replace(/\/$/, '') + '/index.html' + q + (kind === 'thread' ? '#thread' : '');
}

export interface Target {
  val: number;
  dir: 'gte' | 'lte';
  lbl: string;
}

export const TARGETS: Record<string, Target> = {
  reliability: { val: 97, dir: 'gte', lbl: '≥97%' },
  northStar: { val: 95, dir: 'gte', lbl: '≥95%' },
  p50Local: { val: 1000, dir: 'lte', lbl: '<1000ms' },
  hubSnap: { val: 300, dir: 'lte', lbl: '<300ms' },
  hubApp: { val: 200, dir: 'lte', lbl: '<200ms' },
  localE2e: { val: 1000, dir: 'lte', lbl: '<1000ms' },
  remoteE2e: { val: 3000, dir: 'lte', lbl: '<3000ms' },
  dockRel: { val: 97, dir: 'gte', lbl: '≥97%' },
  appTrigger: { val: 97, dir: 'gte', lbl: '≥97%' },
};

export const UC_DESC: Record<string, string> = {
  'Local App Control':
    'User controls device via mobile app over local Wi-Fi — App Tap → REST to Hub → SNAP device → WS push back to App',
  'Device Bind (App)':
    'User commissions or binds a device from the app — App → Hub (HA) → SNAP → WebSocket → App',
  'Docklet Press (App)':
    'User presses a physical dock button → Hub processes it → the app observes and records the resulting state change with its timing',
  'Remote App Control':
    'User controls device via mobile app over the Internet — same flow as local control but routed remotely',
  'Observed Change (App)':
    'State change the app observed but did not initiate — dock presses, automations, scene activations, manual switches',
  'Hub Control (Direct)':
    "Device driven directly from the hub's own Home Assistant screen (not the app). There is no app round-trip, so the speed shown is the Hub → SNAP → Hub device round-trip (snap_state_change_ts − matter_command_ts).",
};

export function ucLabel(uc: string): string {
  if (uc === 'Docklet Press (App)') return 'Docklet Press (Observed from App)';
  if (uc === 'Local App Control') return 'App Control (Local)';
  if (uc === 'Remote App Control') return 'App Control (Remote)';
  return uc;
}

export const LATENCY_BUCKETS = [
  { k: '<500ms', color: '#10b981', label: '<500ms' },
  { k: '500-1000ms', color: '#f59e0b', label: '500ms–1s' },
  { k: '1-2s', color: '#f97316', label: '1–2s' },
  { k: '2-5s', color: '#ef4444', label: '2–5s' },
  { k: '>5s', color: '#be123c', label: '>5s' },
] as const;
