import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import {
  SSL_MODES,
  type Connection,
  type ConnectionTestResult,
  type NewConnection,
  type SslMode,
} from '../types';
import Select from './Select';

const SSL_HINTS: Record<SslMode, string> = {
  disable: 'no TLS',
  require: 'encrypted, unverified',
  'verify-ca': 'chain verified',
  'verify-full': 'chain + hostname',
};

interface Props {
  connections: Connection[];
  onClose: () => void;
  onAdded: (id: string) => void;
  onRemoved: (id: string) => void;
}

const BLANK: NewConnection = {
  label: '',
  url: '',
  sslMode: 'disable',
  ca: '',
};

function testSummary(result: ConnectionTestResult): string {
  if (!result.ok) return result.error;
  return result.pgDurableVersion
    ? `Postgres ${result.serverVersion}, pg_durable ${result.pgDurableVersion}`
    : `Postgres ${result.serverVersion} — pg_durable is not installed here`;
}

export default function ConnectionManager({
  connections,
  onClose,
  onAdded,
  onRemoved,
}: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<NewConnection>(BLANK);
  const [showCa, setShowCa] = useState(false);
  const [results, setResults] = useState<Record<string, ConnectionTestResult>>({});

  // Escape closes the dialog, as one expects. Capturing on document rather than
  // the dialog means it works regardless of which field has focus.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['connections'] });

  const create = useMutation({
    mutationFn: () => api.createConnection(form),
    onSuccess: ({ connection, test }) => {
      setResults((prev) => ({ ...prev, [connection.id]: test }));
      setForm(BLANK);
      setShowCa(false);
      void invalidate();
      onAdded(connection.id);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteConnection(id),
    onSuccess: (_data, id) => {
      void invalidate();
      onRemoved(id);
    },
  });

  const test = useMutation({
    mutationFn: (id: string) => api.testConnection(id),
    onSuccess: (result, id) => setResults((prev) => ({ ...prev, [id]: result })),
  });

  const update = <K extends keyof NewConnection>(key: K, value: NewConnection[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // verify-ca and verify-full need a CA unless PGSSLROOTCERT is set on the
  // server, so surface the field rather than failing at connect time.
  const wantsCa = form.sslMode === 'verify-ca' || form.sslMode === 'verify-full';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-label="Manage connections"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h2>connections</h2>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <ul className="connection-rows">
          {connections.map((conn) => {
            const result = results[conn.id];
            return (
              <li key={conn.id}>
                <div className="connection-row">
                  <div className="connection-identity">
                    <div className="connection-label">
                      {conn.label}
                      {conn.readOnly && <span className="tag">from .env</span>}
                    </div>
                    <div className="connection-target">
                      <code>
                        {conn.username}@{conn.host}:{conn.port}/{conn.database}
                      </code>
                      <span className={`ssl-badge ssl-${conn.sslMode}`}>
                        {conn.sslMode}
                      </span>
                    </div>
                    {result && (
                      <div className={`connection-result ${result.ok ? 'ok' : 'bad'}`}>
                        {testSummary(result)}
                      </div>
                    )}
                  </div>
                  <div className="connection-actions">
                    <button
                      type="button"
                      onClick={() => test.mutate(conn.id)}
                      disabled={test.isPending && test.variables === conn.id}
                    >
                      {test.isPending && test.variables === conn.id ? 'testing…' : 'test'}
                    </button>
                    {!conn.readOnly && (
                      <button
                        type="button"
                        className="danger"
                        onClick={() => remove.mutate(conn.id)}
                        disabled={remove.isPending}
                      >
                        remove
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
          {connections.length === 0 && (
            <li className="empty">nothing configured yet.</li>
          )}
        </ul>

        <form
          className="connection-form"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <h3>add a connection</h3>

          <label>
            name
            <input
              value={form.label}
              onChange={(e) => update('label', e.target.value)}
              placeholder="staging"
              maxLength={64}
              required
            />
          </label>

          <label>
            connection string
            <input
              value={form.url ?? ''}
              onChange={(e) => update('url', e.target.value)}
              placeholder="postgresql://user:password@host:5432/postgres"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>

          <div className="field">
            <span className="field-label">TLS</span>
            <Select
              value={form.sslMode ?? 'disable'}
              options={SSL_MODES.map((mode) => ({
                value: mode,
                label: mode,
                hint: SSL_HINTS[mode],
              }))}
              onChange={(mode) => update('sslMode', mode as SslMode)}
              ariaLabel="TLS mode"
            />
          </div>

          {wantsCa && (
            <>
              {!showCa && (
                <button type="button" className="ghost" onClick={() => setShowCa(true)}>
                  paste a CA certificate
                </button>
              )}
              {showCa && (
                <label>
                  CA certificate (PEM)
                  <textarea
                    value={form.ca ?? ''}
                    onChange={(e) => update('ca', e.target.value)}
                    placeholder="-----BEGIN CERTIFICATE-----"
                    rows={4}
                    spellCheck={false}
                  />
                </label>
              )}
              <p className="hint">
                Leave the certificate empty to use the server's PGSSLROOTCERT, or
                the system trust store for a publicly-issued certificate.
              </p>
            </>
          )}

          <p className="hint">
            The password is encrypted before it's stored and never sent back to
            the browser.
          </p>

          {create.isError && (
            <div className="form-error">{(create.error as Error).message}</div>
          )}

          <button type="submit" className="primary" disabled={create.isPending}>
            {create.isPending ? 'saving…' : 'save connection'}
          </button>
        </form>
      </div>
    </div>
  );
}
