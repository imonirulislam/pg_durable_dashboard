// Shapes the API returns, mirroring the df.* function return types in
// pg_durable 0.2.5.
//
// bigint columns arrive as strings — node-postgres won't put an int8 into a JS
// number, and the API passes rows through untouched. The UI renders them as
// strings, which is why nothing here is `number`.

export interface Metrics {
  total_instances: string;
  running_instances: string;
  completed_instances: string;
  failed_instances: string;
  total_executions: string;
  total_events: string;
}

export interface InstanceSummary {
  instance_id: string;
  label: string | null;
  function_name: string;
  status: string;
  execution_count: string;
  output: string | null;
  created_at: string | null;
  completed_at: string | null;
  next_cursor: string | null;
}

export interface InstanceInfo {
  instance_id: string;
  label: string | null;
  function_name: string;
  function_version: string | null;
  current_execution_id: string;
  status: string;
  output: string | null;
}

export interface InstanceNode {
  node_id: string;
  node_type: string;
  query: string | null;
  result_name: string | null;
  left_node: string | null;
  right_node: string | null;
  status: string | null;
  result: string | null;
  status_details: string | null;
  /** Status resolved through ancestors, for nodes never reached themselves. */
  inferred_status: string | null;
  inferred_status_from_ancestor_id: string | null;
  updated_at: string | null;
}

export interface InstanceExecution {
  execution_id: string;
  status: string;
  event_count: string;
  duration_ms: string;
  output: string | null;
  /** From an internal pg_durable table — null if that read failed. */
  started_at: string | null;
  completed_at: string | null;
}

export interface InstanceListResponse {
  instances: InstanceSummary[];
  cursor: string | null;
}

export const SSL_MODES = ['disable', 'require', 'verify-ca', 'verify-full'] as const;
export type SslMode = (typeof SSL_MODES)[number];

/** A configured database, as the API describes it. Never includes a password. */
export interface Connection {
  id: string;
  label: string;
  host: string;
  port: number;
  database: string;
  username: string;
  sslMode: SslMode;
  hasCustomCa: boolean;
  /** True for the connection defined by the server's DATABASE_URL. */
  readOnly: boolean;
  createdAt: string | null;
  lastOkAt: string | null;
}

export interface ConnectionListResponse {
  connections: Connection[];
  defaultId: string | null;
  sslModes: SslMode[];
}

export interface NewConnection {
  label: string;
  url?: string;
  host?: string;
  port?: number | string;
  database?: string;
  username?: string;
  password?: string;
  sslMode?: SslMode;
  ca?: string;
}

export type ConnectionTestResult =
  | { ok: true; serverVersion: string; pgDurableVersion: string | null }
  | { ok: false; error: string };

export interface CreateConnectionResult {
  connection: Connection;
  test: ConnectionTestResult;
}

export interface Variable {
  name: string;
  owner: string;
  sensitive: boolean;
  /** Null when sensitive — the server never sends the value in that case. */
  value: string | null;
  length: number;
}

/** Statuses an instance can't move on from, so polling them can slow right down. */
export const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export function isTerminal(status: string | null | undefined): boolean {
  return TERMINAL_STATUSES.has((status ?? '').toLowerCase());
}
