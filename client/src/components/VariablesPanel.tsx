import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

interface Props {
  target: string | null;
  onClose: () => void;
}

function masked(length: number): string {
  return '•'.repeat(Math.min(Math.max(length, 4), 24));
}

export default function VariablesPanel({ target, onClose }: Props) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const varsQuery = useQuery({
    queryKey: ['vars', target],
    queryFn: () => api.vars(target),
    enabled: !!target,
  });

  const variables = varsQuery.data?.variables ?? [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-label="Variables"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h2>variables</h2>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <p className="hint">
          Set with <code>df.setvar()</code>, read inside workflows with{' '}
          <code>df.getvar()</code> or <code>{'{name}'}</code> interpolation. Names
          matching key/secret/token/password/credential/auth are masked below — a
          guess based on the name, not something pg_durable itself flags, so a
          secret named without one of those words still shows in full.
        </p>

        {varsQuery.isLoading && <div className="empty">loading…</div>}
        {varsQuery.isError && (
          <div className="empty error">{(varsQuery.error as Error).message}</div>
        )}
        {varsQuery.isSuccess && variables.length === 0 && (
          <div className="empty">nothing set on this database.</div>
        )}

        {variables.length > 0 && (
          <table className="vars-table">
            <thead>
              <tr>
                <th>name</th>
                <th>owner</th>
                <th>value</th>
              </tr>
            </thead>
            <tbody>
              {variables.map((v) => (
                <tr key={v.name}>
                  <td>
                    <code>{v.name}</code>
                  </td>
                  <td>{v.owner}</td>
                  <td className={v.sensitive ? 'vars-masked' : undefined}>
                    {v.sensitive ? (
                      <span title={`${v.length} characters, not shown`}>
                        {masked(v.length)}
                      </span>
                    ) : (
                      <code>{v.value}</code>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
