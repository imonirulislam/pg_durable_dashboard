import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyWake, relativeToNow, waitingNode } from './wake';
import type { InstanceNode } from './types';

function node(partial: Partial<InstanceNode> & { node_id: string }): InstanceNode {
  return {
    node_type: 'SQL',
    query: null,
    result_name: null,
    left_node: null,
    right_node: null,
    status: 'completed',
    result: null,
    status_details: null,
    inferred_status: null,
    inferred_status_from_ancestor_id: null,
    updated_at: null,
    ...partial,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('classifyWake', () => {
  it('labels a running WAIT_SCHEDULE node as next-run, matching Airflow\'s meaning', () => {
    const nodes = [node({ node_id: 'w', node_type: 'WAIT_SCHEDULE', status: 'running' })];
    expect(classifyWake(nodes, '2026-01-01T00:00:00Z')).toEqual({
      kind: 'next-run',
      at: '2026-01-01T00:00:00Z',
    });
  });

  it('labels a running SLEEP node as next-tick, not next-run', () => {
    const nodes = [node({ node_id: 's', node_type: 'SLEEP', status: 'running' })];
    expect(classifyWake(nodes, '2026-01-01T00:00:00Z')?.kind).toBe('next-tick');
  });

  it('labels a running SIGNAL node as a timeout, never next-run', () => {
    // This is the case that would have shipped wrong without checking: a
    // signal wait's pending timer is its give-up deadline, not a recurring run.
    const nodes = [node({ node_id: 'sig', node_type: 'SIGNAL', status: 'running' })];
    expect(classifyWake(nodes, '2026-01-01T00:00:00Z')?.kind).toBe('timeout');
  });

  it('returns null when there is no timestamp at all', () => {
    const nodes = [node({ node_id: 'w', node_type: 'WAIT_SCHEDULE', status: 'running' })];
    expect(classifyWake(nodes, null)).toBeNull();
  });

  it('returns null when a timer row exists but nothing is actually waiting', () => {
    // Real case, not hypothetical: pg_durable never removes a SIGNAL's
    // timeout-timer row from _duroxide.orchestrator_queue once a real signal
    // pre-empts it, so visibleAt stays non-null for a completed instance.
    // Trusting it alone showed a "wakes in 14h" badge on a finished run.
    const nodes = [node({ node_id: 'x', node_type: 'SIGNAL', status: 'completed' })];
    expect(classifyWake(nodes, '2026-01-01T00:00:00Z')).toBeNull();
  });

  it('prefers inferred_status, consistent with how the graph reads status elsewhere', () => {
    const nodes = [
      node({ node_id: 's', node_type: 'SLEEP', status: 'pending', inferred_status: 'running' }),
    ];
    expect(waitingNode(nodes)?.node_id).toBe('s');
  });
});

describe('relativeToNow', () => {
  it('renders a future timestamp as a countdown', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    expect(relativeToNow('2026-01-01T00:04:12Z')).toBe('in 4m 12s');
  });

  it('renders a past timestamp as elapsed, for a timer that already fired', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:05:00Z'));
    expect(relativeToNow('2026-01-01T00:00:00Z')).toBe('5m 0s ago');
  });

  it('scales the unit with the distance', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    expect(relativeToNow('2026-01-01T00:00:45Z')).toBe('in 45s');
    expect(relativeToNow('2026-01-01T02:30:00Z')).toBe('in 2h 30m');
  });
});
