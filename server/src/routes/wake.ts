import { Router, type Request, type Response } from 'express';
import { getPool } from '../connections/pools.js';
import { defaultConnectionId, getConnection } from '../connections/store.js';
import { cached } from '../cache.js';
import { queryParam } from '../params.js';

export const wakeRouter = Router();

function target(req: Request): string | null {
  const requested = queryParam(req.query.target) ?? defaultConnectionId();
  return requested && getConnection(requested) ? requested : null;
}

// pg_durable has no public function for "when does this instance next wake" —
// df.instance_nodes() shows a pending SLEEP/WAIT_SCHEDULE/SIGNAL node, but not
// when it fires. The timestamp exists in _duroxide.orchestrator_queue, an
// undocumented internal schema this extension owns, not us. Reading it is a
// judgement call the rest of this app avoids elsewhere on purpose: if a
// pg_durable upgrade renames or drops this table, this route must fail soft
// (null, not 500) rather than take the dashboard down over an optional detail.
wakeRouter.get('/instances/:id/wake', async (req: Request, res: Response) => {
  const targetId = target(req);
  const id = req.params.id;
  if (!targetId) {
    res.json({ visibleAt: null });
    return;
  }
  try {
    const { data } = await cached(`${targetId}:wake:${id}`, async () => {
      const { rows } = await getPool(targetId).query<{ visible_at: string }>(
        `SELECT visible_at FROM _duroxide.orchestrator_queue
         WHERE instance_id = $1
         ORDER BY visible_at ASC
         LIMIT 1`,
        [id]
      );
      return { visibleAt: rows[0]?.visible_at ?? null };
    }, 5000);
    res.json(data);
  } catch {
    res.json({ visibleAt: null });
  }
});
