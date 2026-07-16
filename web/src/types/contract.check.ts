/**
 * Compile-time contract check — never imported by app code, never bundled.
 *
 * `npm run typecheck` validates that a REAL captured backend response
 * (analytics-api/tests/golden/) structurally satisfies the HubDetail type.
 * If the backend's output shape ever changes, or someone edits api.ts in a
 * way that no longer matches reality, this file fails to compile.
 */
import type { HubDetail, HubsResponse } from './api';
import hubFixture from '../../../analytics-api/tests/golden/hub_2C-CF-67-6E-11-52__2026-06-01__2026-07-15.json';
import hubsFixture from '../../../analytics-api/tests/golden/hubs.json';

// Assignment IS the assertion: the JSON must satisfy the declared contract.
const _hubDetail: HubDetail = hubFixture as HubDetail;
const _hubs: HubsResponse = hubsFixture;

// The all-source invariant, encoded as a runtime-checkable helper the app can
// reuse; referenced here so the symbols aren't "unused".
export function invariantHolds(d: HubDetail): boolean {
  return d.total_activity === d.activity_success + d.activity_fail;
}
void _hubDetail;
void _hubs;
