import express, { type Express, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { envStr } from './config.js';

/** Serves the built client alongside the API, so a deployment is one port. In
 * development this finds nothing and Vite serves the UI instead. */
export function serveClient(app: Express): string | null {
  // No ../client/dist fallback: `npm run dev` would then serve a stale bundle
  // on 4000 while Vite serves the current one on 5173.
  const configured = envStr('CLIENT_DIR');
  const dir = [configured ? resolve(configured) : resolve('public')].find((path) =>
    existsSync(join(path, 'index.html'))
  );
  if (!dir) return null;

  app.use(
    express.static(dir, {
      // Served by the fallback below, so its headers are set in one place.
      index: false,
      setHeaders(res, path) {
        // Vite fingerprints /assets; everything else revalidates.
        res.setHeader(
          'Cache-Control',
          path.includes(`${'/assets/'}`)
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=0, must-revalidate'
        );
      },
    })
  );

  // SPA fallback. no-store: a stale index.html pins clients to dead asset
  // hashes.
  app.use((req: Request, res: Response, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api')) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(join(dir, 'index.html'));
  });

  return dir;
}
