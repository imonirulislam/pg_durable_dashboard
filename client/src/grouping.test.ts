import { afterEach, describe, expect, it, vi } from 'vitest';
import { groupRuns, relativeTime, runDuration } from './grouping';
import type { InstanceSummary } from './types';

function run(partial: Partial<InstanceSummary> & { instance_id: string }): InstanceSummary {
  return {
    label: 'process-order',
    function_name: 'pg_durable::orchestration::execute-function-graph',
    status: 'completed',
    execution_count: '1',
    output: null,
    created_at: '2026-08-24T10:00:00.000Z',
    completed_at: null,
    next_cursor: null,
    ...partial,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('groupRuns', () => {
  it('collapses repeat runs of a label into one workflow', () => {
    const workflows = groupRuns([
      run({ instance_id: 'a' }),
      run({ instance_id: 'b' }),
      run({ instance_id: 'c', label: 'nightly-rollup' }),
    ]);

    expect(workflows).toHaveLength(2);
    expect(workflows.find((w) => w.key === 'process-order')?.runs).toHaveLength(2);
  });

  it('orders runs newest first', () => {
    const [workflow] = groupRuns([
      run({ instance_id: 'old', created_at: '2026-08-24T09:00:00.000Z' }),
      run({ instance_id: 'new', created_at: '2026-08-24T11:00:00.000Z' }),
      run({ instance_id: 'mid', created_at: '2026-08-24T10:00:00.000Z' }),
    ]);
    expect(workflow!.runs.map((r) => r.instance_id)).toEqual(['new', 'mid', 'old']);
    expect(workflow!.latest.instance_id).toBe('new');
  });

  it('counts runs per status', () => {
    const [workflow] = groupRuns([
      run({ instance_id: 'a', status: 'failed' }),
      run({ instance_id: 'b', status: 'failed' }),
      run({ instance_id: 'c', status: 'running' }),
      run({ instance_id: 'd', status: 'completed' }),
    ]);
    expect(workflow!.counts).toEqual({ failed: 2, running: 1, completed: 1 });
    expect(workflow!.failed).toBe(2);
    expect(workflow!.running).toBe(1);
  });

  it('surfaces running workflows first, then failing ones', () => {
    const workflows = groupRuns([
      run({ instance_id: 'a', label: 'quiet', status: 'completed' }),
      run({ instance_id: 'b', label: 'broken', status: 'failed' }),
      run({ instance_id: 'c', label: 'busy', status: 'running' }),
    ]);
    expect(workflows.map((w) => w.key)).toEqual(['busy', 'broken', 'quiet']);
  });

  it('falls back to the function name when a run has no label', () => {
    // df.start() without a label: every instance shares the orchestrator's
    // function name, so they land in one bucket. Documented behaviour, not a bug.
    const workflows = groupRuns([
      run({ instance_id: 'a', label: null }),
      run({ instance_id: 'b', label: null }),
    ]);
    expect(workflows).toHaveLength(1);
    expect(workflows[0]!.key).toBe('pg_durable::orchestration::execute-function-graph');
    expect(workflows[0]!.label).toBeNull();
  });

  it('tolerates runs with no created_at', () => {
    const workflows = groupRuns([run({ instance_id: 'a', created_at: null })]);
    expect(workflows[0]!.runs).toHaveLength(1);
  });

  it('returns nothing for no instances', () => {
    expect(groupRuns([])).toEqual([]);
  });
});

describe('relativeTime', () => {
  it('scales the unit to the age', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-24T12:00:00.000Z'));

    expect(relativeTime('2026-08-24T11:59:30.000Z')).toBe('30s ago');
    expect(relativeTime('2026-08-24T11:45:00.000Z')).toBe('15m ago');
    expect(relativeTime('2026-08-24T09:00:00.000Z')).toBe('3h ago');
    expect(relativeTime('2026-08-22T12:00:00.000Z')).toBe('2d ago');
  });

  it('shows a dash rather than "NaN ago" when there is no timestamp', () => {
    expect(relativeTime(null)).toBe('—');
  });
});

describe('runDuration', () => {
  it('measures a finished run between its own timestamps', () => {
    expect(
      runDuration(
        run({
          instance_id: 'a',
          created_at: '2026-08-24T10:00:00.000Z',
          completed_at: '2026-08-24T10:00:02.500Z',
        })
      )
    ).toBe('2.5s');
  });

  it('measures a running instance against now, so it climbs', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-24T10:05:30.000Z'));
    expect(
      runDuration(run({ instance_id: 'a', created_at: '2026-08-24T10:00:00.000Z' }))
    ).toBe('5m 30s');
  });

  it('switches to hours for long runs', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-24T12:30:00.000Z'));
    expect(
      runDuration(run({ instance_id: 'a', created_at: '2026-08-24T10:00:00.000Z' }))
    ).toBe('2h 30m');
  });
});
