// Row shapes for the df.* functions this API wraps, taken from their declared
// return types in pg_durable 0.2.5 (`\df df.*`).
//
// Every bigint column is typed `string`: node-postgres hands back int8 as a
// string by default, because a bigint doesn't fit in a JS number. Don't "fix"
// these to number without also configuring pg.types — the values reach the
// client as strings today and the UI renders them as such.

/** df.metrics() */
export interface Metrics {
  total_instances: string;
  running_instances: string;
  completed_instances: string;
  failed_instances: string;
  total_executions: string;
  total_events: string;
}

/**
 * df.list_instances(status_filter, limit_count, label_filter, after_cursor)
 * — the four-argument overload, which is the one that also returns timestamps
 * and a cursor.
 */
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

/** df.instance_info(instance_id) */
export interface InstanceInfo {
  instance_id: string;
  label: string | null;
  function_name: string;
  function_version: string | null;
  current_execution_id: string;
  status: string;
  output: string | null;
}

/** df.instance_nodes(instance_id_param) — the single-argument overload. */
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

/** df.instance_executions(instance_id, limit_count) */
export interface InstanceExecution {
  execution_id: string;
  status: string;
  event_count: string;
  duration_ms: string;
  output: string | null;
}

export interface InstanceListResponse {
  instances: InstanceSummary[];
  cursor: string | null;
}

/** An error carrying the HTTP status to answer with. */
export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
