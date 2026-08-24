import { Router, type Request, type Response } from 'express';
import { getPool } from '../connections/pools.js';
import { defaultConnectionId, getConnection } from '../connections/store.js';
import { cached } from '../cache.js';
import { queryParam } from '../params.js';
import { HttpError, type VarRow } from '../types.js';
import { toVariable } from '../varMasking.js';

export const varsRouter = Router();

function target(req: Request): string {
  const requested = queryParam(req.query.target) ?? defaultConnectionId();
  if (!requested) {
    throw new HttpError(409, 'no database connections configured');
  }
  if (!getConnection(requested)) {
    throw new HttpError(404, `unknown connection "${requested}"`);
  }
  return requested;
}

varsRouter.get('/vars', async (req: Request, res: Response) => {
  try {
    const targetId = target(req);
    const { data } = await cached(`${targetId}:vars`, async () => {
      const { rows } = await getPool(targetId).query<VarRow>(
        'SELECT name, value, owner FROM df.vars ORDER BY name'
      );
      return rows.map(toVariable);
    });
    res.json({ variables: data });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});
