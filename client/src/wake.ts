import type { InstanceNode } from './types';

export type WakeKind = 'next-run' | 'next-tick' | 'timeout' | 'wake';

export interface WakeInfo {
  kind: WakeKind;
  at: string;
}

// A pending timer means different things depending on what node is waiting on
// it: WAIT_SCHEDULE's timer is the next cron fire (Airflow's "next run"),
// SLEEP's is the next loop iteration, but SIGNAL's is just when it gives up
// waiting — calling that one "next run" would be actively misleading.
const KIND_BY_NODE_TYPE: Record<string, WakeKind> = {
  WAIT_SCHEDULE: 'next-run',
  SLEEP: 'next-tick',
  SIGNAL: 'timeout',
  WAIT_INSTANCE: 'timeout',
};

/** The node currently parked waiting for something, if any. */
export function waitingNode(nodes: InstanceNode[]): InstanceNode | null {
  return (
    nodes.find((n) => {
      const status = (n.inferred_status || n.status || '').toLowerCase();
      return status === 'running' && n.node_type in KIND_BY_NODE_TYPE;
    }) ?? null
  );
}

/** Combines the waiting node's type with the raw timestamp from the server. */
export function classifyWake(
  nodes: InstanceNode[],
  visibleAt: string | null
): WakeInfo | null {
  if (!visibleAt) return null;
  const node = waitingNode(nodes);
  return { kind: node ? KIND_BY_NODE_TYPE[node.node_type]! : 'wake', at: visibleAt };
}

export const WAKE_LABEL: Record<WakeKind, string> = {
  'next-run': 'next run',
  'next-tick': 'next tick',
  timeout: 'times out',
  wake: 'wakes',
};

/** "in 4m 12s" / "3m ago" for a timestamp that's usually in the future. */
export function relativeToNow(iso: string): string {
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  const past = seconds < 0;
  const abs = Math.abs(seconds);
  const text =
    abs < 60
      ? `${Math.round(abs)}s`
      : abs < 3600
        ? `${Math.floor(abs / 60)}m ${Math.round(abs % 60)}s`
        : `${Math.floor(abs / 3600)}h ${Math.round((abs % 3600) / 60)}m`;
  return past ? `${text} ago` : `in ${text}`;
}
