import type { Workflow } from '../grouping';
import { LiveRelativeTime } from './LiveTime';
import Select from './Select';

const STATUS_OPTIONS = [
  { value: '', label: 'all statuses' },
  { value: 'Running', label: 'running' },
  { value: 'Completed', label: 'completed' },
  { value: 'Failed', label: 'failed' },
  { value: 'Pending', label: 'pending' },
  { value: 'Cancelled', label: 'cancelled' },
];

interface Props {
  workflows: Workflow[];
  loading: boolean;
  error: Error | null;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

export default function WorkflowList({
  workflows,
  loading,
  error,
  statusFilter,
  onStatusFilterChange,
  selectedKey,
  onSelect,
}: Props) {
  return (
    <div className="instance-list">
      <div className="instance-list-toolbar">
        <Select
          value={statusFilter}
          options={STATUS_OPTIONS}
          onChange={onStatusFilterChange}
          ariaLabel="Filter by status"
        />
      </div>

      {loading && <div className="empty">loading workflows…</div>}
      {error && <div className="empty error">{error.message}</div>}
      {!loading && !error && workflows.length === 0 && (
        <div className="empty">no workflows found.</div>
      )}

      <ul>
        {workflows.map((wf) => (
          <li
            key={wf.key}
            className={wf.key === selectedKey ? 'selected' : ''}
            onClick={() => onSelect(wf.key)}
          >
            <div className="instance-row">
              {/* The dot reflects the most recent run, the way a DAG list does. */}
              <span
                className={`status-dot status-${(wf.latest.status || '').toLowerCase()}`}
              />
              <div className="workflow-main">
                <div className="instance-label">{wf.label || wf.functionName}</div>
                <div className="instance-sub">
                  {wf.runs.length} {wf.runs.length === 1 ? 'run' : 'runs'} ·{' '}
                  <LiveRelativeTime iso={wf.latest.created_at} />
                  {wf.running > 0 && <span className="tag running">{wf.running} running</span>}
                  {wf.failed > 0 && <span className="tag failed">{wf.failed} failed</span>}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
