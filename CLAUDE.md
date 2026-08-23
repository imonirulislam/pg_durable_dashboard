# CLAUDE.md

Guidance for working in this repo.

## What this is

A web UI for the [pg_durable](https://github.com/microsoft/pg_durable) Postgres
extension. `server/` is a thin Express API where every data route wraps one
`df.*` SQL function; `client/` is a Vite + React SPA that polls it. pg_durable
holds all the state — deliberately no business logic here.

## Commands

```bash
# API (port 4000)
cd server && npm install && npm run dev
npm run typecheck && npm test && npm run build

# Dashboard (port 5173, proxies /api to 4000)
cd client && npm install && npm run dev
npm run typecheck && npm test && npm run build

# A local pg_durable with seeded workflows (port 5440)
docker compose -f demo/docker-compose.yml up -d --build

# Production image: API + built client on one port
docker build -t pg-durable-dashboard . && docker compose up -d
```

Node 24+ is required: the connection store uses `node:sqlite`, which still needs
`--experimental-sqlite` on 22.

## Facts about pg_durable that shape the code

Verified against 0.2.5. Check them again when the extension is upgraded.

- **Instance visibility is RLS-scoped to `submitted_by = current_user`.** A
  dedicated read-only role lists zero instances; only superusers see everything.
  Granting `SELECT` on the extension's internal tables does not change this. So
  the choice is superuser (fleet-wide) or per-user roles (each sees their own).
- **`df.grant_usage()` needs `with_grant => true`** for `df.metrics()` to be
  callable. Without it, `/api/metrics` alone fails.
- **`status_filter` is case-sensitive** against lowercase stored statuses.
  `/api/instances` lowercases it; don't remove that.
- **`df.instance_nodes()` returns an expression tree**, not a positioned graph:
  `THEN`/`IF`/`JOIN`/`LOOP` operators over `SQL` leaves, linked by
  `left_node`/`right_node`. An `IF`'s condition is a third child hidden inside
  its `query` JSON, not in left/right — `client/src/graph.ts` picks it up
  separately, and dropping that silently loses an edge.
- **`node.query` is not always SQL.** For operator nodes it's a JSON blob
  (`{"signal_name": ...}`, `{"condition_node": ...}`). Parse defensively.
- **bigint columns arrive as strings** (node-postgres won't coerce int8 into a JS
  number). The types say `string` on purpose.
- **`df.start()` fails during container init** with "background worker not yet
  initialized", and that aborts startup. `demo/schema.sql` is DDL only; the
  workflows in `demo/seed.sql` run afterwards from a separate compose service
  gated on the healthcheck.

## Things that will bite you

- **`KEY_SALT` in `server/src/connections/crypto.ts` is a KDF salt, not a
  label.** Changing it — including by find-replacing the project name — makes
  every stored password undecryptable, reported as "APP_SECRET may have
  changed".
- **`pg-connection-string` maps every non-`disable` sslmode to `{}`**, and Node
  then defaults to full verification. So a URL saying `sslmode=require` would
  behave like `verify-full` and reject a self-signed certificate. `pools.ts`
  re-applies the mode explicitly so displayed mode equals enforced behaviour.
  Don't "simplify" that away.
- **Static serving only looks at `./public` or an explicit `CLIENT_DIR`.** It
  used to fall back to `../client/dist`, which meant `npm run dev` served a
  stale bundle on port 4000 while Vite served the current one on 5173.
- **The graph must not re-layout on every poll.** `InstanceGraph` re-lays out
  only when the set of node ids changes, and otherwise merges fresh statuses
  into current positions — otherwise dragging a node snaps back every 4s.
- **Wall-clock text needs its own ticker.** Nothing re-renders when only time
  passes, so `LiveTime.tsx` exists to keep "3m ago" and elapsed durations from
  freezing between polls (up to 30s for a settled run).

## Conventions

- TypeScript, strict, both sides. `npm run typecheck` in each package.
- Comments explain *why*, especially where a line encodes something surprising
  about pg_durable. Don't narrate what the code already says.
- Server imports use `.js` extensions (NodeNext); client imports are
  extensionless (bundler resolution). Mixing them breaks one side or the other.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` in each
  package — the same four steps CI runs.
- Tests cover the pure logic — graph layout, run grouping, credential
  encryption, SSL mapping, cache behaviour, connection input validation. UI
  verification has been done with throwaway Playwright scripts rather than a
  committed browser suite.
- Client tests run through `vite.config.ts`; there is no separate
  `vitest.config.ts` on that side. The server has one, solely to externalize
  `node:sqlite` (Vite looks builtins up without the `node:` prefix, and
  `sqlite` alone isn't in `module.builtinModules`).
- Query parameters reach the server as `string | string[] | object`. Use the
  `param()` helper in `routes/instances.ts` rather than `String(...)`, which
  turns `?status[x]=y` into the literal `"[object Object]"`.
- The API has no authentication and stores database credentials. Any change that
  widens its reach (binding, CORS, accepting hosts) is a security change — see
  `SECURITY.md`.
