import Logo from './Logo';

interface Props {
  workflowCount: number;
}

export default function EmptyDetail({ workflowCount }: Props) {
  return (
    <div className="instance-detail placeholder">
      <div className="placeholder-inner">
        <div className="placeholder-mark">
          <Logo size={54} />
        </div>
        <h2>
          pg_durable <span className="accent">dashboard</span>
        </h2>
        {workflowCount > 0 ? (
          <>
            <p>
              Pick a workflow on the left to see its runs and step through the
              execution graph.
            </p>
            <p className="placeholder-count">
              {workflowCount} {workflowCount === 1 ? 'workflow' : 'workflows'} on this
              database
            </p>
          </>
        ) : (
          <p>
            No workflows here yet. Start one with <code>df.start(…)</code> and it
            shows up on the next poll.
          </p>
        )}
      </div>
    </div>
  );
}
