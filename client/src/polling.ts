import type { Query } from '@tanstack/react-query';
import { isTerminal, type InstanceInfo } from './types';

// pg_durable has no push mechanism, so the dashboard polls and load scales with
// open tabs. See the README for the measurements behind these intervals.
export const POLL_MS = 4000;
export const SETTLED_POLL_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;

// refetchInterval's callback is parameterized per query, so a shared helper has
// to accept any of them.
/* eslint-disable @typescript-eslint/no-explicit-any */
type PollingQuery = Query<any, any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

function backoff(failures: number, base: number): number {
  if (failures <= 0) return base;
  return Math.min(base * 2 ** failures, MAX_BACKOFF_MS);
}

/** Default: poll steadily, back off on failure. */
export function pollInterval(query: PollingQuery): number {
  return backoff(query.state.fetchFailureCount, POLL_MS);
}

/** Settled runs can't change; poll them slowly. */
export function pollUnlessSettled(settled: boolean) {
  return (query: PollingQuery): number =>
    backoff(query.state.fetchFailureCount, settled ? SETTLED_POLL_MS : POLL_MS);
}

/** For instance_info, which is what reveals a run has settled. */
export function pollInstanceInfo(query: PollingQuery): number {
  const status = (query.state.data as InstanceInfo | undefined)?.status;
  return backoff(
    query.state.fetchFailureCount,
    isTerminal(status) ? SETTLED_POLL_MS : POLL_MS
  );
}
