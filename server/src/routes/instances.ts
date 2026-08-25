import { Router, type Request, type Response } from 'express';
import { getPool } from '../connections/pools.js';
import { defaultConnectionId, getConnection } from '../connections/store.js';
import { cached, type CachedResult } from '../cache.js';
import { queryParam } from '../params.js';
import {
  HttpError,
  type InstanceExecution,
  type InstanceInfo,
  type InstanceListResponse,
  type InstanceNode,
  type InstanceSummary,
  type Metrics,
} from '../types.js';

export const instancesRouter = Router();

// pg_durable caps this itself (pg_durable.list_instances_max_limit, 1000 by
// default), but a client polling for 1000 rows every few seconds is a footgun
// worth closing here too.
const MAX_LIMIT = 200;

/** Falls back to the first connection, so callers can omit ?target. */
function target(req: Request): string {
  const requested = queryParam(req.query.target) ?? defaultConnectionId();

  if (!requested) {
    throw new HttpError(
      409,
      'no database connections configured — add one from the dashboard, or set DATABASE_URL'
    );
  }
  if (!getConnection(requested)) {
    throw new HttpError(404, `unknown connection "${requested}"`);
  }
  return requested;
}

// X-Cache reports whether the read reached Postgres.
async function send<T>(
  res: Response,
  work: (targetId: string) => Promise<CachedResult<T>>,
  req: Request
): Promise<void> {
  try {
    const targetId = target(req);
    const { data, fromCache } = await work(targetId);
    res.set('X-Cache', fromCache ? 'hit' : 'miss');
    res.set('X-Target', targetId);
    res.json(data);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: (err as Error).message });
  }
}

// A live snapshot, not a time series. The most expensive read here.
instancesRouter.get('/metrics', (req: Request, res: Response) =>
  send(
    res,
    (targetId) =>
      cached<Metrics | Record<string, never>>(`${targetId}:metrics`, async () => {
        const { rows } = await getPool(targetId).query<Metrics>(
          'SELECT * FROM df.metrics()'
        );
        return rows[0] ?? {};
      }),
    req
  )
);

// pg_durable's list_instances is cursor-paginated; we pass the cursor through.
instancesRouter.get('/instances', (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 50, MAX_LIMIT);
  // status_filter is case-sensitive against lowercase stored statuses.
  const statusFilter = queryParam(req.query.status)?.toLowerCase() ?? null;
  const labelFilter = queryParam(req.query.label);
  const cursor = queryParam(req.query.cursor);

  return send(
    res,
    (targetId) =>
      cached<InstanceListResponse>(
        `${targetId}:instances:${statusFilter}:${labelFilter}:${limit}`,
        async () => {
          const { rows } = await getPool(targetId).query<InstanceSummary>(
            `SELECT * FROM df.list_instances(
               status_filter := $1,
               label_filter := $2,
               limit_count := $3
             )`,
            [statusFilter, labelFilter, limit]
          );
          // list_instances() doesn't return next_cursor in every pg_durable
          // version — if yours does, thread it through here.
          return { instances: rows, cursor };
        }
      ),
    req
  );
});

instancesRouter.get('/instances/:id', (req: Request, res: Response) =>
  send(
    res,
    (targetId) =>
      cached<InstanceInfo>(`${targetId}:instance:${req.params.id}`, async () => {
        const { rows } = await getPool(targetId).query<InstanceInfo>(
          'SELECT * FROM df.instance_info($1)',
          [req.params.id]
        );
        if (!rows[0]) throw new HttpError(404, 'instance not found');
        return rows[0];
      }),
    req
  )
);

// The function graph as it ran — one row per node. Drives the DAG view.
instancesRouter.get('/instances/:id/nodes', (req: Request, res: Response) =>
  send(
    res,
    (targetId) =>
      cached<InstanceNode[]>(`${targetId}:nodes:${req.params.id}`, async () => {
        const { rows } = await getPool(targetId).query<InstanceNode>(
          'SELECT * FROM df.instance_nodes($1)',
          [req.params.id]
        );
        return rows;
      }),
    req
  )
);

// Execution history — useful for instances that were retried or looped.
instancesRouter.get('/instances/:id/executions', (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 5, MAX_LIMIT);
  return send(
    res,
    (targetId) =>
      cached<InstanceExecution[]>(
        `${targetId}:executions:${req.params.id}:${limit}`,
        async () => {
          const pool = getPool(targetId);
          // df.instance_executions() has no timestamp columns — when each
          // tick happened lives only in _duroxide.executions, an undocumented
          // internal table (see routes/wake.ts). Same join key, same risk: a
          // pg_durable upgrade could rename or drop it, so fall back to the
          // public function alone rather than break the whole route over it.
          try {
            const { rows } = await pool.query<InstanceExecution>(
              `SELECT e.*, x.started_at, x.completed_at
               FROM df.instance_executions($1, $2) e
               LEFT JOIN _duroxide.executions x
                 ON x.instance_id = $1 AND x.execution_id = e.execution_id
               ORDER BY e.execution_id DESC`,
              [req.params.id, limit]
            );
            return rows;
          } catch {
            const { rows } = await pool.query<Omit<InstanceExecution, 'started_at' | 'completed_at'>>(
              'SELECT * FROM df.instance_executions($1, $2)',
              [req.params.id, limit]
            );
            return rows.map((row) => ({ ...row, started_at: null, completed_at: null }));
          }
        }
      ),
    req
  );
});

// Thin passthroughs for df.status()/df.result(), for scripts hitting this API
// directly rather than going through the UI.
instancesRouter.get('/instances/:id/status', (req: Request, res: Response) =>
  send(
    res,
    (targetId) =>
      cached<{ status: string | null }>(`${targetId}:status:${req.params.id}`, async () => {
        const { rows } = await getPool(targetId).query<{ status: string | null }>(
          'SELECT df.status($1) AS status',
          [req.params.id]
        );
        return rows[0] ?? { status: null };
      }),
    req
  )
);

instancesRouter.get('/instances/:id/result', (req: Request, res: Response) =>
  send(
    res,
    (targetId) =>
      cached<{ result: string | null }>(`${targetId}:result:${req.params.id}`, async () => {
        const { rows } = await getPool(targetId).query<{ result: string | null }>(
          'SELECT df.result($1) AS result',
          [req.params.id]
        );
        return rows[0] ?? { result: null };
      }),
    req
  )
);
