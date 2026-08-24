# Local demo environment

A throwaway Postgres with `pg_durable` installed and a handful of workflows
already running, so the dashboard has something to show without pointing it at
anything real.

Verified against **pg_durable 0.2.5** (`ghcr.io/microsoft/pg_durable:pg17`).

## Run it

```bash
# 1. database + demo workflows (first build pulls ~500MB)
docker compose -f demo/docker-compose.yml up -d --build

# 2. API — .env.example already points at the demo database, so if you have no
#    .env yet: cp .env.example .env
cd server && npm install && npm run dev

# 3. dashboard
cd client && npm install && npm run dev
```

Then open http://localhost:5173.

The demo connection string is
`postgresql://postgres:demo@localhost:5440/postgres` — port 5440 rather than
5432 so it doesn't collide with a Postgres you already have running. If you
already have a `server/.env` pointing somewhere else, edit `DATABASE_URL`
rather than copying over it.

## What gets seeded

`seed.sql` starts ten durable functions covering every status the UI renders,
plus the graph shapes worth looking at — including the ones that turned up real
rendering bugs once we actually ran them. The compose seeder runs it **three
times** (`SEED_ROUNDS`), so each workflow has a few runs — the dashboard groups
instances by label into workflows with a strip of runs, and one run per workflow
makes that strip a single square.

| label            | status    | why it's here                                              |
| ---------------- | --------- | ----------------------------------------------------------- |
| `process-order`  | completed | linear pipeline, named results (`\|=>`) reused later       |
| `nightly-rollup` | completed | `df.join` fan-out/fan-in — a branch, not a line             |
| `volume-check`   | completed | `df.if` — one branch taken, one left unreached              |
| `charge-card`    | failed    | a step that raises; red node and failed counter             |
| `doc-approval`   | running   | parked on `df.wait_for_signal` for a day                    |
| `heartbeat-30s`  | running   | `df.loop` + `df.sleep`; execution count keeps rising        |
| `stale-import`   | cancelled | started, then `df.cancel`                                   |
| `nightly-close`  | completed | `df.join3` — a third branch hidden in `query.extra_nodes`, not left/right; missed until we ran one |
| `failover-race`  | completed | `df.race` — two branches, both shown, edges marked concurrent |
| `poll-loop`      | running   | `df.loop` with a condition — the *while*-loop form, distinct from `heartbeat-30s`'s unconditional one; the condition is hidden the same way `df.if`'s is |

Also sets two variables via `df.setvar()` (`api_base`, `api_key`) so the
dashboard's variables panel has something to show — `api_key` is masked there
by name, `api_base` isn't; pg_durable itself makes no such distinction.

`heartbeat-30s` is the one that makes the dashboard's 4s polling visibly do
something. To watch a state transition, release the parked approval:

```sql
SELECT df.signal('<doc-approval instance_id>', 'approval', '{"approved": true}');
```

The instance goes `running → completed` and the DAG's pending branches resolve
on the next poll.

Seed another batch at any time:

```bash
psql postgresql://postgres:demo@localhost:5440/postgres -f demo/seed.sql
```

Start over completely (drops the volume and re-seeds on next boot):

```bash
docker compose -f demo/docker-compose.yml down -v
```

## Things that bit us, so they don't bite you

**`df.start()` does not work from `docker-entrypoint-initdb.d`.** It fails with
`pg_durable background worker not yet initialized`, and because that's an error
during init, the container exits instead of starting. That's why the DDL
(`schema.sql`) is baked into the image's init directory but the workflows
(`seed.sql`) run afterwards, from a separate one-shot compose service gated on
the healthcheck.

**`pg_isready` is not a sufficient healthcheck.** Postgres accepts connections
before the durable runtime is ready to take work. The compose healthcheck also
waits for the runtime's own sentinel row, `_duroxide._worker_ready`.

**The demo connects as a superuser, not a read-only role.** The top-level README
recommends a read-only `dashboard_reader` role. That doesn't work for a
fleet-wide dashboard: pg_durable puts row-level security on instances scoped to
`submitted_by = current_user`, so a dedicated reader role lists *zero*
instances, and only superusers bypass it. Granting `SELECT` on the extension's
internal tables makes no difference — the rows are filtered by design, not
missing a privilege. See `grants.sql` for the two honest options.

**`df.grant_usage()` needs `with_grant => true` to reach `df.metrics()`.**
Without it, `/api/metrics` alone fails with `permission denied for function
metrics` while every other route works.

**The image is amd64-only.** On Apple Silicon it runs under emulation
(`platform: linux/amd64` in the compose file) — slower to boot, otherwise fine.
