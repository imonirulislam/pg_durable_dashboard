import type { InstanceSummary } from './types';

/**
 * pg_durable has no concept of a "workflow definition" — df.start() creates an
 * instance and the label you pass is the only thing tying repeat runs of the
 * same thing together. So the dashboard groups by label the way Airflow groups
 * runs under a DAG: one row per workflow, expanded into its runs.
 *
 * Instances started without a label fall back to their function name, which is
 * shared by everything pg_durable runs through its graph orchestrator — those
 * end up in one bucket, which is the honest representation of "unlabelled".
 */
export interface Workflow {
  /** Group key: the label, or the function name when unlabelled. */
  key: string;
  label: string | null;
  functionName: string;
  runs: InstanceSummary[];
  /** Run counts per status, lowercased. */
  counts: Record<string, number>;
  /** Most recent run — what the workflow's own status badge reflects. */
  latest: InstanceSummary;
  running: number;
  failed: number;
}

function startedAt(run: InstanceSummary): number {
  return run.created_at ? Date.parse(run.created_at) : 0;
}

export function groupRuns(instances: InstanceSummary[]): Workflow[] {
  const groups = new Map<string, InstanceSummary[]>();

  for (const inst of instances) {
    const key = inst.label || inst.function_name;
    const bucket = groups.get(key);
    if (bucket) bucket.push(inst);
    else groups.set(key, [inst]);
  }

  const workflows: Workflow[] = [];

  for (const [key, runs] of groups) {
    // Newest first, matching how the runs strip reads left-to-right.
    runs.sort((a, b) => startedAt(b) - startedAt(a));

    const counts: Record<string, number> = {};
    for (const run of runs) {
      const status = (run.status || 'unknown').toLowerCase();
      counts[status] = (counts[status] ?? 0) + 1;
    }

    const latest = runs[0]!;
    workflows.push({
      key,
      label: latest.label,
      functionName: latest.function_name,
      runs,
      counts,
      latest,
      running: counts.running ?? 0,
      failed: counts.failed ?? 0,
    });
  }

  // Anything currently running first, then anything failing, then by recency —
  // the things you'd open a dashboard to look at.
  workflows.sort((a, b) => {
    if (!!b.running !== !!a.running) return b.running - a.running;
    if (!!b.failed !== !!a.failed) return b.failed - a.failed;
    return startedAt(b.latest) - startedAt(a.latest);
  });

  return workflows;
}

/** "3 minutes ago"-ish, short enough for a dense list. */
export function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** Wall-clock duration of a run, or how long it's been going. */
export function runDuration(run: InstanceSummary): string {
  if (!run.created_at) return '—';
  const start = Date.parse(run.created_at);
  const end = run.completed_at ? Date.parse(run.completed_at) : Date.now();
  const seconds = Math.max(0, (end - start) / 1000);
  if (seconds < 1) return '<1s';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
}
