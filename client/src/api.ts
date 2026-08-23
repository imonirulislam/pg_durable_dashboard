import type {
  ConnectionListResponse,
  ConnectionTestResult,
  CreateConnectionResult,
  InstanceExecution,
  InstanceInfo,
  InstanceListResponse,
  InstanceNode,
  Metrics,
  NewConnection,
} from './types';

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = (body as { error?: string }).error;
    throw new Error(error || `${path} failed: ${res.status}`);
  }
  return body as T;
}

function query(target: string | null, extra: Record<string, string | number> = {}): string {
  const params = new URLSearchParams();
  if (target) params.set('target', target);
  for (const [key, value] of Object.entries(extra)) {
    if (value !== '' && value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

const json = (payload: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

export interface ListParams {
  status?: string;
  label?: string;
  limit?: number;
}

export const api = {
  connections: () => request<ConnectionListResponse>('/connections'),

  createConnection: (input: NewConnection) =>
    request<CreateConnectionResult>('/connections', json(input)),

  deleteConnection: (id: string) =>
    request<void>(`/connections/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  testConnection: (id: string) =>
    request<ConnectionTestResult>(
      `/connections/${encodeURIComponent(id)}/test`,
      { method: 'POST' }
    ),

  metrics: (target: string | null) => request<Metrics>(`/metrics${query(target)}`),

  listInstances: (target: string | null, params: ListParams = {}) => {
    const extra: Record<string, string | number> = {};
    if (params.status) extra.status = params.status;
    if (params.label) extra.label = params.label;
    if (params.limit) extra.limit = params.limit;
    return request<InstanceListResponse>(`/instances${query(target, extra)}`);
  },

  instance: (target: string | null, id: string) =>
    request<InstanceInfo>(`/instances/${encodeURIComponent(id)}${query(target)}`),

  instanceNodes: (target: string | null, id: string) =>
    request<InstanceNode[]>(`/instances/${encodeURIComponent(id)}/nodes${query(target)}`),

  instanceExecutions: (target: string | null, id: string) =>
    request<InstanceExecution[]>(
      `/instances/${encodeURIComponent(id)}/executions${query(target)}`
    ),
};
