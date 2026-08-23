import { Router, type Request, type Response } from 'express';
import {
  assertHostAllowed,
  getPool,
  probe,
  releasePool,
  VERSION_QUERY,
  type ProbeResult,
} from '../connections/pools.js';
import { SSL_MODES } from '../connections/ssl.js';
import { parseConnectionInput } from '../connections/input.js';
import {
  createConnection,
  defaultConnectionId,
  deleteConnection,
  getConnection,
  listConnections,
  markConnectionOk,
  resolveCredentials,
} from '../connections/store.js';
import { HttpError } from '../types.js';

export const connectionsRouter = Router();

function fail(res: Response, err: unknown): void {
  const status = err instanceof HttpError ? err.status : 500;
  res.status(status).json({ error: (err as Error).message });
}

connectionsRouter.get('/connections', (_req: Request, res: Response) => {
  try {
    res.json({
      connections: listConnections(),
      defaultId: defaultConnectionId(),
      sslModes: SSL_MODES,
    });
  } catch (err) {
    fail(res, err);
  }
});

// Saved even when unreachable; the probe result comes back so the UI can say so.
connectionsRouter.post('/connections', async (req: Request, res: Response) => {
  try {
    const input = parseConnectionInput(req.body);
    // Before probing: probe failures are reported, not thrown, so a blocked
    // host would otherwise still be saved.
    assertHostAllowed(input.host);
    const test = await probe(input).then(
      (info: ProbeResult) => ({ ok: true as const, ...info }),
      (err: Error) => ({ ok: false as const, error: err.message })
    );
    const created = createConnection(input);
    if (test.ok) markConnectionOk(created.id);
    res.status(201).json({ connection: created, test });
  } catch (err) {
    fail(res, err);
  }
});

connectionsRouter.delete('/connections/:id', async (req: Request, res: Response) => {
  try {
    deleteConnection(req.params.id);
    await releasePool(req.params.id);
    res.status(204).end();
  } catch (err) {
    fail(res, err);
  }
});

connectionsRouter.post('/connections/:id/test', async (req: Request, res: Response) => {
  try {
    const credentials = resolveCredentials(req.params.id);
    if (!credentials || !getConnection(req.params.id)) {
      throw new HttpError(404, 'connection not found');
    }

    // The env profile is a raw URL; use its pool rather than rebuilding one.
    const result: ProbeResult =
      credentials.kind === 'url'
        ? await getPool(req.params.id)
            .query<{ version: string; extversion: string | null }>(VERSION_QUERY)
            .then(({ rows }) => ({
              serverVersion: rows[0]?.version ?? 'unknown',
              pgDurableVersion: rows[0]?.extversion ?? null,
            }))
        : await probe(credentials.config);

    markConnectionOk(req.params.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    // A failed test is an answer, not a server error.
    if (err instanceof HttpError) return fail(res, err);
    res.json({ ok: false, error: (err as Error).message });
  }
});
