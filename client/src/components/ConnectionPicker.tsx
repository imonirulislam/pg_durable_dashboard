import type { Connection } from '../types';
import Select from './Select';

interface Props {
  connections: Connection[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onManage: () => void;
}

export default function ConnectionPicker({
  connections,
  selectedId,
  onSelect,
  onManage,
}: Props) {
  const selected = connections.find((c) => c.id === selectedId);
  const options = connections.map((conn) => ({
    value: conn.id,
    label: conn.label,
    hint: `${conn.host}:${conn.port}/${conn.database}`,
  }));

  // Unencrypted traffic to something that isn't loopback is worth saying out
  // loud, since the connection form defaults to disable.
  const insecure =
    selected &&
    selected.sslMode === 'disable' &&
    !['localhost', '127.0.0.1', '::1'].includes(selected.host);

  return (
    <div className="connection-picker">
      {connections.length > 0 && (
        <Select
          value={selectedId ?? ''}
          options={options}
          onChange={onSelect}
          ariaLabel="Database connection"
          className="select-wide"
        />
      )}
      {insecure && (
        <span className="ssl-warning" title="This connection is not using TLS">
          no TLS
        </span>
      )}
      <button type="button" className="manage-connections" onClick={onManage}>
        {connections.length === 0 ? 'add a connection' : 'manage'}
      </button>
    </div>
  );
}
