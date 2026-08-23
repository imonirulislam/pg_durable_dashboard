# pg_durable dashboard

A small utility app that gives [pg_durable](https://github.com/microsoft/pg_durable) a
web UI. pg_durable itself is queryable entirely through SQL (`df.*` functions) — this app
just wraps those functions in a REST API and renders them as a workflow list, a live
execution DAG, and system metrics. TypeScript on both sides; `npm run typecheck` in
either directory.

![The dashboard showing a running workflow's execution graph](docs/dashboard.png)

```
┌────────────────────┐      ┌───────────────────┐      ┌────────────────────────┐
│  Browser dashboard  │ ───▶ │     API server     │ ───▶ │     Target Postgres     │
│  React + React Flow │      │  Node + node-pg    │      │  pg_durable extension   │
└────────────────────┘      └───────────────────┘      └────────────────────────┘
```

## What's here

- `server/` — a thin Express API. Every data route wraps a single `df.*` SQL function
  (`df.list_instances`, `df.instance_info`, `df.instance_nodes`, `df.instance_executions`,
  `df.metrics`). No business logic lives here on purpose — pg_durable already tracks
  all the state. The only state the server keeps of its own is the list of
  databases you've pointed it at.
- `client/` — a Vite + React SPA. Polls the API (pg_durable has no push/notify
  mechanism, so polling is the practical choice) and visualizes each run's node
  graph with React Flow.
- `demo/` — a Dockerized pg_durable with seeded workflows to develop against.

### How the UI is organised

pg_durable has no first-class notion of a "workflow definition": `df.start()`
creates an instance, and the label you pass it is the only thing tying repeat
runs of the same thing together. So the dashboard groups by label the way
Airflow groups runs under a DAG — one row per workflow, a strip of its runs
newest-first, and the graph for whichever run you pick (the latest by default).
Grouping happens in the browser over the fetched page of instances, so a
workflow's run count means "runs in the current page"; `client/src/grouping.ts`
is where that lives if you'd rather aggregate in SQL.

`df.instance_nodes()` hands back an expression tree (`THEN`/`IF`/`JOIN`/`LOOP`
operators over `SQL` leaves) rather than a positioned diagram, so the graph view
lays it out as a tree and labels each edge with what the parent operator means —
`1`/`2` for execution order, `then`/`else` for a branch, a dashed `if` for the
condition node an `IF` carries in its config JSON. Never-reached branches are
dimmed using `inferred_status`, so a failure shows both where it happened and
what consequently didn't run.

## Run it as one image

The API and the built dashboard ship in a single container on one port. Once a
release is published:

```bash
docker run -d --name pg-durable-dashboard \
  -p 127.0.0.1:4000:4000 \
  -v pgdd-data:/data \
  -e APP_SECRET="$(openssl rand -base64 32)" \
  ghcr.io/imonirulislam/pg_durable_dashboard:latest
```

Then open http://localhost:4000 and add a database from the UI. Or build it
yourself — `docker compose up -d --build`, or `docker build -t pg-durable-dashboard .`

Verify the signature first; images are signed with Sigstore keyless signing, so
the identity is the workflow that built them and there's no key to trust:

```bash
cosign verify \
  --certificate-identity-regexp '^https://github.com/imonirulislam/pg_durable_dashboard/.github/workflows/release.yml@' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/imonirulislam/pg_durable_dashboard:latest
```

Notes on running it:

- **Mount `/data`.** That's the connection store and its generated encryption
  key; without a volume, saved connections vanish when the container is replaced.
- **Set `APP_SECRET`** rather than letting the container generate one, so the
  store survives a volume being recreated.
- **Publish to `127.0.0.1`**, as above. Inside the container the server binds
  `0.0.0.0` — it has to — so the published port is what actually limits reach,
  and the server has no authentication of its own. See
  [Before exposing this to a network](#before-exposing-this-to-a-network).
- Images are built for `linux/amd64` and `linux/arm64`. About 57 MB, runs as
  non-root (`uid 1000`), with a healthcheck on `/api/health`.

## 0. Just want to see it?

`demo/` brings up a throwaway Postgres with pg_durable and seven workflows
already running — every status the UI renders, plus the graph shapes worth
looking at:

```bash
docker compose -f demo/docker-compose.yml up -d --build
```

Then follow steps 2 and 3 below with
`DATABASE_URL=postgresql://postgres:demo@localhost:5440/postgres`. See
[demo/README.md](demo/README.md).

## 1. Prerequisites

- A Postgres instance with `pg_durable` installed and `CREATE EXTENSION pg_durable;`
  already run. You can point the dashboard at it from the UI, so `DATABASE_URL`
  is optional.
- A role that can read the `df` schema:

  ```sql
  SELECT df.grant_usage('dashboard_reader', include_http => false, with_grant => true);
  ```

  `with_grant => true` is what grants `EXECUTE` on `df.metrics()`; without it the
  `/api/metrics` route fails on its own while everything else works.

  Nothing here needs write access — it only calls `df.*` read functions. But a
  dedicated read-only role does **not** give you a fleet-wide dashboard:
  pg_durable enforces row-level security on instances scoped to
  `submitted_by = current_user`, so a reader role sees only instances it started
  itself, and only superusers see everything. Either connect as a superuser and
  accept that, or run the dashboard per-user with each person's own role. Details
  and the two options in [demo/grants.sql](demo/grants.sql). Checked against
  pg_durable 0.2.5.

## 2. Run the server

```bash
cd server
cp .env.example .env
# edit .env — set DATABASE_URL for your database (the example points at demo/)
npm install
npm run dev
```

The API listens on `http://localhost:4000` by default.

## 3. Run the client

```bash
cd client
npm install
npm run dev
```

Open the printed local URL (typically `http://localhost:5173`). The dev server proxies
`/api` requests to the server on port 4000 (see `client/vite.config.ts`).

## Configuration

Everything is read from the environment at startup, so each of these works the
same way as `-e VAR=value` on `docker run`, `environment:` in compose, or a
`server/.env` file in development. Nothing is baked into the image.

| Variable                  | Default              | What it does                                                                 |
| ------------------------- | -------------------- | ---------------------------------------------------------------------------- |
| `DATABASE_URL`            | *(unset)*            | Optional connection that always exists, shown read-only in the UI            |
| `PORT`                    | `4000`               | Port to listen on                                                            |
| `HOST`                    | `127.0.0.1`          | Bind address. **The image sets `0.0.0.0`** — see the warning below            |
| `ENV_CONNECTION_LABEL`    | `DATABASE_URL`       | What the `DATABASE_URL` connection is called in the UI                        |
| `APP_SECRET`              | *(generated)*        | Key encrypting stored passwords. Unset → generated to a file, with a warning  |
| `DATA_DIR`                | `data` (`/data` in the image) | Where the connection store and generated key live                   |
| `CONNECTIONS_DB`          | `$DATA_DIR/connections.db` | Override the store path on its own                                     |
| `APP_SECRET_FILE`         | `$DATA_DIR/secret.key` | Override the generated key path on its own                                 |
| `ALLOWED_DB_HOSTS`        | *(any host)*         | Comma-separated allowlist of database hosts the API may connect to            |
| `PGSSLROOTCERT`           | *(system store)*     | CA bundle for `verify-ca`/`verify-full` when a connection has no own cert     |
| `CORS_ORIGIN`             | *(off)*              | Comma-separated origins, or `*`. Off is correct for the image and for dev     |
| `CACHE_TTL_MS`            | `2000`               | Response cache window; `0` disables it                                       |
| `PG_POOL_MAX`             | `5`                  | Max connections per configured database                                      |
| `PG_STATEMENT_TIMEOUT_MS` | `10000`              | Server-side statement timeout                                                |
| `PG_QUERY_TIMEOUT_MS`     | `15000`              | Client-side query timeout                                                    |
| `PG_CONNECT_TIMEOUT_MS`   | `5000`               | Connection timeout                                                           |
| `CLIENT_DIR`              | `public` (`/app/public` in the image) | Where the built dashboard is served from             |

Two that behave differently in a container:

- **`HOST`** — the image sets `0.0.0.0` because a container bound to loopback
  can't be reached at all. Don't "fix" it to `127.0.0.1` there; control access
  by publishing to `127.0.0.1` on the host instead.
- **`DATA_DIR`** — `/data` in the image. Mount a volume there, or saved
  connections disappear with the container.

## Connections

Databases are added from the UI (**manage** in the header) and switched from the
picker next to it. Each gets its own connection pool, and every response is
scoped to the selected target — cache keys included — so switching never shows
you one database's runs while pointed at another.

Where things are kept:

- Profiles live in SQLite at `data/connections.db` (`DATA_DIR`/`CONNECTIONS_DB`),
  via Node's built-in `node:sqlite` — no extra dependency.
- Passwords are encrypted with AES-256-GCM before being stored, and are never
  returned to the browser. The key comes from `APP_SECRET`; without it the server
  generates one at `data/secret.key` (mode 0600) and warns. Rotating `APP_SECRET`
  invalidates saved passwords — re-add those connections.
- `DATABASE_URL`, if set, appears as a read-only connection that can't be edited
  or deleted from the UI. It's never copied into the store.
- The browser keeps one thing: which connection you last selected.

**TLS to Postgres** is an explicit mode per connection, named as libpq names them:

| mode          | what it actually does                                           |
| ------------- | --------------------------------------------------------------- |
| `disable`     | no TLS                                                          |
| `require`     | encrypted, **certificate not verified** — no MITM protection     |
| `verify-ca`   | certificate chain verified                                      |
| `verify-full` | chain plus hostname verified — use this over an untrusted network |

`verify-ca`/`verify-full` need a CA: paste a PEM into the connection form, or set
`PGSSLROOTCERT` server-side. A publicly-issued certificate verifies against the
system trust store without either. `libpq`'s `allow`/`prefer` are deliberately
not offered — node-postgres can't negotiate them, so accepting the names would
imply a guarantee that isn't kept.

### Before exposing this to a network

The API has no authentication of its own, holds database credentials, and will
connect to whatever host a stored connection names. It binds `127.0.0.1` by
default for exactly that reason. If you move it:

- put it behind something that authenticates, and terminate HTTPS there;
- set `ALLOWED_DB_HOSTS` so an arbitrary host can't be dialled through it;
- set `APP_SECRET` from your secret manager rather than using the generated file.

## Polling and load on the target database

Because the UI polls, load scales with the number of open tabs rather than with
how much is happening. Measured against pg_durable 0.2.5 (in Docker under x86
emulation, so treat these as upper bounds):

| call                   | latency | notes                              |
| ---------------------- | ------- | ---------------------------------- |
| `df.metrics()`         | ~110ms  | aggregate; ~⅔ of all query time    |
| `df.list_instances(n)` | ~52ms   | flat in the 10–54 instance range   |
| per-instance reads     | ~2ms    | `instance_info`/`nodes`/`executions` |

One viewer with a run selected is 5 requests every 4s (1.25 req/s, measured).
Three things stop that multiplying:

- **The API collapses identical concurrent reads** behind a short TTL cache with
  single-flight (`server/src/cache.ts`), so DB load is roughly independent of
  viewer count. Measured with 3 viewers on the same run: 88 requests → 28
  queries, and per route it stays at ~1 query per poll window no matter how many
  tabs are open. `X-Cache: hit|miss` on every response says which happened.
  `CACHE_TTL_MS=0` disables it.
- **Settled runs stop being polled hard.** Once a run is
  completed/failed/cancelled it can't change, so its queries drop from 4s to 30s
  (measured: 18 requests per 24s → 0). See `client/src/polling.ts`.
- **Failures back off exponentially** up to 60s, so a struggling database isn't
  hammered by every open dashboard. Background tabs stop polling entirely
  (measured: 0 requests while hidden).

The pool also sets `statement_timeout`/`query_timeout` (`PG_STATEMENT_TIMEOUT_MS`,
`PG_QUERY_TIMEOUT_MS`), so one slow `df.*` call can't pin a connection and stall
every subsequent poll behind it. `limit` is capped at 200 per request.

If you need this to scale past "a handful of dashboards", the next step is one
server-side poll loop feeding clients over SSE, rather than each client polling.

## Development

```bash
cd server && npm install && npm run typecheck && npm test
cd client && npm install && npm run typecheck && npm test
```

Tests cover the pure logic where the interesting decisions live: graph layout
from `df.instance_nodes()` output, run grouping, credential encryption, the SSL
mode mapping, cache single-flight, and connection input validation. UI behaviour
(flash-free run switching, drag surviving a poll, the dropdowns) has been
verified with throwaway Playwright scripts rather than a committed browser suite.

Notes for anyone — human or agent — changing this: [CLAUDE.md](CLAUDE.md) records
the pg_durable behaviours the code depends on and the handful of lines that look
innocuous but aren't.

## License

[MIT](LICENSE). Use it, change it, ship it commercially — just keep the
copyright notice.

## Notes on scope

This is a monitoring scaffold, not an operational one — it only reads. If you want to
add actions later (cancel a running instance, approve a human-in-the-loop step, resubmit
a failed one), those need their own SQL functions from pg_durable's write surface and a
separate, more privileged role — don't reuse the read-only connection for that.

There's also no built-in history for `df.metrics()` — it's a live snapshot, not a time
series. If you want trend charts, add a small cron job that snapshots `df.metrics()`
into a side table (SQLite is fine) on an interval, and a `/api/metrics/history` route
to serve it. Left out of this scaffold to keep the first pass small.
