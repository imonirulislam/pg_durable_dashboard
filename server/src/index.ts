import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import 'dotenv/config';
import { cacheStats } from './cache.js';
import { envNum, envStr } from './config.js';
import { closeAllPools, getPool } from './connections/pools.js';
import { closeStore, defaultConnectionId, listConnections } from './connections/store.js';
import { connectionsRouter } from './routes/connections.js';
import { instancesRouter } from './routes/instances.js';
import { varsRouter } from './routes/vars.js';
import { serveClient } from './static.js';

const app = express();

// Off by default: the image is same-origin and Vite proxies /api in dev.
const corsOrigin = envStr('CORS_ORIGIN');
if (corsOrigin) {
  app.use(
    cors({
      origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((o) => o.trim()),
    })
  );
  if (corsOrigin === '*') {
    console.warn('CORS_ORIGIN=* allows any site to call this API from a browser.');
  }
}
// Room for a PEM certificate in a connection payload.
app.use(express.json({ limit: '128kb' }));

app.get('/api/health', async (req: Request, res: Response) => {
  // Reading the store can throw (unwritable DATA_DIR), and an unhandled
  // rejection in Express 4 hangs the request instead of answering.
  let targetId: string | null = null;
  try {
    targetId =
      typeof req.query.target === 'string' && req.query.target.trim()
        ? req.query.target.trim()
        : defaultConnectionId();

    if (!targetId) {
      res.json({ ok: true, connections: 0, cache: cacheStats() });
      return;
    }

    await getPool(targetId).query('SELECT 1');
    res.json({ ok: true, target: targetId, cache: cacheStats() });
  } catch (err) {
    res.status(500).json({ ok: false, target: targetId, error: (err as Error).message });
  }
});

app.use('/api', connectionsRouter);
app.use('/api', instancesRouter);
app.use('/api', varsRouter);

// Must come last: it claims every non-/api GET for the SPA.
const clientDir = serveClient(app);

// Express 4 doesn't forward async rejections; without this they hang.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err.message);
  if (!res.headersSent) res.status(500).json({ error: 'internal error' });
});

const port = envNum('PORT', 4000);
// Loopback by default: holds credentials, dials arbitrary hosts, no auth of its
// own. Widen only behind something that authenticates.
const host = envStr('HOST') ?? '127.0.0.1';

const server = app.listen(port, host, () => {
  console.log(
    `pg_durable dashboard ${clientDir ? '' : 'API '}listening on http://${host}:${port}`
  );
  if (clientDir) console.log(`Serving the dashboard from ${clientDir}`);
  const count = listConnections().length;
  console.log(
    count === 0
      ? 'No connections configured — add one from the dashboard, or set DATABASE_URL.'
      : `${count} connection(s) configured; default is "${defaultConnectionId()}".`
  );
  if (host !== '127.0.0.1' && host !== 'localhost' && !envStr('ALLOWED_DB_HOSTS')) {
    console.warn(
      `Listening on ${host} with no ALLOWED_DB_HOSTS set: anyone who can reach ` +
        'this port can make the server connect to any database host.'
    );
  }
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, shutting down`);
  server.close();
  await closeAllPools();
  closeStore();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void shutdown(signal));
}
