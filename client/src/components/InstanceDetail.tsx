import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api';
import type { Workflow } from '../grouping';
import { pollInstanceInfo, pollUnlessSettled } from '../polling';
import { isTerminal } from '../types';
import EmptyDetail from './EmptyDetail';
import InstanceGraph from './InstanceGraph';
import { LiveDuration, LiveRelativeTime } from './LiveTime';
import RunStrip from './RunStrip';

interface Props {
  target: string | null;
  workflow: Workflow | null;
  workflowCount: number;
  instanceId: string | null;
  onSelectRun: (instanceId: string) => void;
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
        </span>
      </h3>

      <InstanceGraph nodes={nodesQuery.data ?? []} />

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
