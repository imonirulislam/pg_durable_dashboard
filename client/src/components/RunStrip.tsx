import { relativeTime, runDuration, type Workflow } from '../grouping';

interface Props {
  workflow: Workflow;
  selectedRunId: string | null;
  onSelectRun: (instanceId: string) => void;
}

/**
 * The runs of one workflow, newest first — the equivalent of Airflow's row of
 * DAG-run squares. Each square is one pg_durable instance; picking one drives
 * the graph below.
 */
export default function RunStrip({ workflow, selectedRunId, onSelectRun }: Props) {
  return (
    <div className="run-strip">
      <div className="run-strip-squares">
        {workflow.runs.map((run) => {
          const status = (run.status || '').toLowerCase();
          return (
            <button
              type="button"
              key={run.instance_id}
              className={`run-square status-${status}${
                run.instance_id === selectedRunId ? ' selected' : ''
              }`}
              onClick={() => onSelectRun(run.instance_id)}
              title={[
                run.instance_id,
                status,
                `started ${relativeTime(run.created_at)}`,
                `took ${runDuration(run)}`,
                `${run.execution_count} execution(s)`,
                run.output ? `output: ${run.output}` : '',
              ]
                .filter(Boolean)
                .join('\n')}
            />
          );
        })}
      </div>
      <div className="run-strip-legend">
        newest first · {workflow.runs.length}{' '}
        {workflow.runs.length === 1 ? 'run' : 'runs'}
      </div>
    </div>
  );
}
