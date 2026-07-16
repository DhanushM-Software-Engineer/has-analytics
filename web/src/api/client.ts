/**
 * Typed API client — the ONLY place the app talks to the backend.
 * Endpoints, params and response shapes are identical to what the vanilla
 * dashboard uses; the backend is unchanged.
 */
import type { HubDetail, HubsResponse } from '../types/api';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${url} → HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchHubs(): Promise<HubsResponse> {
  return getJson<HubsResponse>('/api/hubs');
}

export function fetchHubDetail(
  hubId: string,
  fromDate?: string,
  toDate?: string,
): Promise<HubDetail> {
  const params = new URLSearchParams();
  if (fromDate) params.set('from_date', fromDate);
  if (toDate) params.set('to_date', toDate);
  const qs = params.toString();
  return getJson<HubDetail>(`/api/hub/${encodeURIComponent(hubId)}${qs ? `?${qs}` : ''}`);
}
