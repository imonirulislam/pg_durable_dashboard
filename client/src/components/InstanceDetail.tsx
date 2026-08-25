import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api';
import type { Workflow } from '../grouping';
import { pollInstanceInfo, pollUnlessSettled } from '../polling';
import { isTerminal } from '../types';
import { classifyWake } from '../wake';
import EmptyDetail from './EmptyDetail';
import GraphOrCode from './GraphOrCode';
import { LiveDuration, LiveRelativeTime, LiveWake } from './LiveTime';
import RunStrip from './RunStrip';

interface Props {
  target: string | null;
  workflow: Workflow | null;
  workflowCount: number;
  instanceId: string | null;
  onSelectRun: (instanceId: string) => void;
}

// GraphPage (see main.tsx) reads these same two params straight from the URL —
// there's no router, so this is the entire "link" between the two pages.
function openGraphPage(target: string | null, instanceId: string): void {
  const params = new URLSearchParams({ instance: instanceId });
  if (target) params.set('target', target);
  window.open(`${window.location.pathname}?${params}`, '_blank');
}

export default function InstanceDetail({
  target,
  workflow,
  workflowCount,
  instanceId,
  onSelectRun,
}: Props) {
  const enabled = !!instanceId && !!target;

  // keepPreviousData: switching runs changes the key, and blanking the pane
  // until new data lands reads as a flash.
  const infoQuery = useQuery({
    queryKey: ['instance', target, instanceId],
    queryFn: () => api.instance(target, instanceId!),
    enabled,
    refetchInterval: pollInstanceInfo,
    placeholderData: keepPreviousData,
  });

  const settled = isTerminal(infoQuery.data?.status);

  const nodesQuery = useQuery({
    queryKey: ['instance-nodes', target, instanceId],
    queryFn: () => api.instanceNodes(target, instanceId!),
    enabled,
    refetchInterval: pollUnlessSettled(settled),
    placeholderData: keepPreviousData,
  });

  const execQuery = useQuery({
    queryKey: ['instance-executions', target, instanceId],
    queryFn: () => api.instanceExecutions(target, instanceId!),
    enabled,
    refetchInterval: pollUnlessSettled(settled),
    placeholderData: keepPreviousData,
  });

  // Only meaningful while running, and reads an internal pg_durable table —
  // see routes/wake.ts. Never queried for a settled run.
  const wakeQuery = useQuery({
    queryKey: ['instance-wake', target, instanceId],
    queryFn: () => api.instanceWake(target, instanceId!),
    enabled: enabled && !settled,
    refetchInterval: pollUnlessSettled(settled),
    placeholderData: keepPreviousData,
  });

  const wake = classifyWake(nodesQuery.data ?? [], wakeQuery.data?.visibleAt ?? null);

  if (!workflow || !instanceId) {
    return <EmptyDetail workflowCount={workflowCount} />;
  }

  const run = workflow.runs.find((r) => r.instance_id === instanceId);

  return (
    <div className="instance-detail">
      <h2>{workflow.label || workflow.functionName}</h2>
      <div className="instance-meta">
        <span>
          function <code>{infoQuery.data?.function_name ?? workflow.functionName}</code>
        </span>
        <span>
          version <code>{infoQuery.data?.function_version}</code>
        </span>
        <span>
          {workflow.runs.length} {workflow.runs.length === 1 ? 'run' : 'runs'}
        </span>
      </div>

      <h3>runs</h3>
      <RunStrip
        workflow={workflow}
        selectedRunId={instanceId}
        onSelectRun={onSelectRun}
      />

      <h3>
        run <code className="run-id">{instanceId}</code>
        <span className="run-headline">
          {infoQuery.data?.status ?? run?.status}
          {run && (
            <>
              {' · '}
              <LiveDuration run={run} />
            </>
          )}
          {wake && (
            <>
              {' · '}
              <LiveWake wake={wake} />
            </>
          )}
        </span>
      </h3>

      <GraphOrCode
        nodes={nodesQuery.data ?? []}
        label={workflow.label}
        actions={
          <button type="button" onClick={() => openGraphPage(target, instanceId)}>
            open in new tab ↗
          </button>
        }
      />

      <h3>execution history</h3>
      <table className="exec-table">
        <thead>
          <tr>
            <th>execution</th>
            <th>started</th>
            <th>status</th>
            <th>events</th>
            <th>duration (ms)</th>
          </tr>
        </thead>
        <tbody>
          {(execQuery.data ?? []).map((ex) => (
            <tr key={ex.execution_id}>
              <td>
                <code>{ex.execution_id}</code>
              </td>
              <td title={ex.started_at ? new Date(ex.started_at).toLocaleString() : undefined}>
                <LiveRelativeTime iso={ex.started_at} />
              </td>
              <td>{ex.status}</td>
              <td>{ex.event_count}</td>
              <td>{ex.duration_ms}</td>
            </tr>
          ))}
          {(execQuery.data ?? []).length === 0 && (
            <tr>
              <td colSpan={5} className="empty">
                no execution history yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
