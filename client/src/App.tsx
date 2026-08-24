import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './api';
import { groupRuns } from './grouping';
import ConnectionManager from './components/ConnectionManager';
import ConnectionPicker from './components/ConnectionPicker';
import InstanceDetail from './components/InstanceDetail';
import Logo from './components/Logo';
import MetricsBar from './components/MetricsBar';
import VariablesPanel from './components/VariablesPanel';
import WorkflowList from './components/WorkflowList';

// The only thing this app stores in the browser.
const TARGET_KEY = 'pg-durable-dashboard.target';

export default function App() {
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [viewingVars, setViewingVars] = useState(false);
  const [target, setTarget] = useState<string | null>(() =>
    localStorage.getItem(TARGET_KEY)
  );

  const connectionsQuery = useQuery({
    queryKey: ['connections'],
    queryFn: api.connections,
    // Changes only when someone edits them, and mutations invalidate this.
    refetchInterval: false,
  });
  // Memoized: it's a useEffect dependency below.
  const connections = useMemo(
    () => connectionsQuery.data?.connections ?? [],
    [connectionsQuery.data]
  );

  // Remembered connection may have been deleted since.
  useEffect(() => {
    if (!connectionsQuery.data) return;
    const known = connections.some((c) => c.id === target);
    if (!known) setTarget(connectionsQuery.data.defaultId);
  }, [connectionsQuery.data, connections, target]);

  useEffect(() => {
    if (target) localStorage.setItem(TARGET_KEY, target);
  }, [target]);

  const ready = !!target;

  const metricsQuery = useQuery({
    queryKey: ['metrics', target],
    queryFn: () => api.metrics(target),
    enabled: ready,
  });

  const instancesQuery = useQuery({
    queryKey: ['instances', target, statusFilter],
    // Grouping is client-side, so counts mean "runs in this page".
    queryFn: () => api.listInstances(target, { status: statusFilter, limit: 200 }),
    enabled: ready,
    placeholderData: keepPreviousData,
  });

  const workflows = useMemo(
    () => groupRuns(instancesQuery.data?.instances ?? []),
    [instancesQuery.data]
  );

  const selected = workflows.find((w) => w.key === selectedKey) ?? null;

  // Selected run can leave the page on a filter change.
  useEffect(() => {
    if (!selected) return;
    const stillThere = selected.runs.some((r) => r.instance_id === selectedRunId);
    if (!stillThere) setSelectedRunId(selected.latest.instance_id);
  }, [selected, selectedRunId]);

  const switchTarget = (id: string) => {
    setTarget(id);
    // Labels are per-database; nothing carries over.
    setSelectedKey(null);
    setSelectedRunId(null);
  };

  const listError = connectionsQuery.error ?? instancesQuery.error;

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <Logo size={19} />
          <span>
            pg_durable <span className="accent">dashboard</span>
          </span>
        </h1>
        <ConnectionPicker
          connections={connections}
          selectedId={target}
          onSelect={switchTarget}
          onManage={() => setManaging(true)}
        />
        {ready && (
          <button type="button" className="header-button" onClick={() => setViewingVars(true)}>
            variables
          </button>
        )}
        {metricsQuery.isError && (
          <span className="connection-error">{(metricsQuery.error as Error).message}</span>
        )}
      </header>

      <MetricsBar metrics={metricsQuery.data} loading={ready && metricsQuery.isLoading} />

      <div className="app-body">
        {connectionsQuery.isSuccess && connections.length === 0 ? (
          <div className="empty setup-prompt">
            No database configured yet.{' '}
            <button type="button" className="link" onClick={() => setManaging(true)}>
              Add a connection
            </button>{' '}
            to a Postgres running pg_durable.
          </div>
        ) : (
          <>
            <WorkflowList
              workflows={workflows}
              loading={ready && instancesQuery.isLoading}
              error={listError as Error | null}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              selectedKey={selectedKey}
              onSelect={(key) => {
                setSelectedKey(key);
                setSelectedRunId(null);
              }}
            />
            <InstanceDetail
              target={target}
              workflow={selected}
              workflowCount={workflows.length}
              instanceId={selectedRunId}
              onSelectRun={setSelectedRunId}
            />
          </>
        )}
      </div>

      {managing && (
        <ConnectionManager
          connections={connections}
          onClose={() => setManaging(false)}
          onAdded={switchTarget}
          onRemoved={(id) => {
            if (id === target) setTarget(null);
          }}
        />
      )}

      {viewingVars && (
        <VariablesPanel target={target} onClose={() => setViewingVars(false)} />
      )}
    </div>
  );
}
