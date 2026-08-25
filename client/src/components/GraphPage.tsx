import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { pollInstanceInfo, pollUnlessSettled } from '../polling';
import { isTerminal } from '../types';
import GraphOrCode from './GraphOrCode';
import Logo from './Logo';

interface Props {
  target: string | null;
  instanceId: string;
}

/**
 * Standalone page for one run's graph, opened in its own browser tab from
 * InstanceDetail — a fixed 340px panel doesn't do a 20+ node tree justice.
 * Reads target/instance straight from the URL since it has no App state to
 * fall back on; see main.tsx for the routing.
 */
export default function GraphPage({ target, instanceId }: Props) {
  const infoQuery = useQuery({
    queryKey: ['instance', target, instanceId],
    queryFn: () => api.instance(target, instanceId),
    refetchInterval: pollInstanceInfo,
    placeholderData: keepPreviousData,
  });

  const settled = isTerminal(infoQuery.data?.status);

  const nodesQuery = useQuery({
    queryKey: ['instance-nodes', target, instanceId],
    queryFn: () => api.instanceNodes(target, instanceId),
    refetchInterval: pollUnlessSettled(settled),
    placeholderData: keepPreviousData,
  });

  const title = infoQuery.data?.label || infoQuery.data?.function_name || instanceId;

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <Logo size={19} />
          <span>{title}</span>
        </h1>
        <span className="graph-page-meta">
          run <code>{instanceId}</code>
          {infoQuery.data?.status && <> · {infoQuery.data.status}</>}
        </span>
      </header>
      <div className="graph-page-body">
        <GraphOrCode nodes={nodesQuery.data ?? []} label={infoQuery.data?.label ?? null} />
      </div>
    </div>
  );
}
