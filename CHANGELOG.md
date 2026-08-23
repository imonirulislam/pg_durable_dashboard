# Changelog

Notable changes to this project. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

First release, not yet tagged. Tagging `v0.1.0` publishes a signed image to
GHCR and moves these entries under that heading.

### Added

- Web UI for [pg_durable](https://github.com/microsoft/pg_durable): workflow
  list, run history, live execution graph, and system metrics, all read through
  `df.*` SQL functions.
- Workflows grouped by label with a strip of runs per workflow, in the shape
  Airflow uses for DAGs and DAG runs. `df.start()` has no notion of a workflow
  definition, so the label is the grouping key.
- Execution graph rendered as a tree from `df.instance_nodes()`, with edges
  labelled by what the parent operator means (`1`/`2` for order, `then`/`else`
  for a branch, a dashed `if` for an `IF`'s condition node) and unreached
  branches dimmed via `inferred_status`.
- Connection manager: add and switch between databases from the UI. Profiles are
  stored in SQLite via `node:sqlite`; passwords are encrypted with AES-256-GCM
  and never returned to the browser. `DATABASE_URL` appears as a read-only
  connection.
- Per-connection TLS mode (`disable`, `require`, `verify-ca`, `verify-full`),
  with an optional CA certificate per connection or a shared `PGSSLROOTCERT`.
- Single production image serving the API and the built dashboard on one port,
  published multi-arch and signed with Sigstore keyless signing.
- `demo/` — Dockerized pg_durable seeded with workflows covering every status
  the UI renders, for developing against.
- Response cache with single-flight, so N dashboards cost one query per window
  rather than N; `X-Cache` reports hit or miss.
- Polling backs off exponentially on failure, drops to 30s for settled runs, and
  stops entirely in background tabs.

## Notes on pg_durable 0.2.5

Behaviour found while building this, which shapes how the app works:

- Instance visibility is row-level-security scoped to
  `submitted_by = current_user`. A dedicated read-only role sees **zero**
  instances; only superusers see everything. The read-only-role advice that
  usually accompanies a monitoring tool does not apply here.
- `df.grant_usage()` needs `with_grant => true` before `df.metrics()` is
  callable, otherwise that one route fails while every other works.
- `df.list_instances(status_filter := ...)` compares case-sensitively against
  lowercase stored statuses, so `'Completed'` matches nothing. The API
  normalizes.
- `df.start()` cannot run from `docker-entrypoint-initdb.d` — the background
  worker isn't initialized yet, and the failure aborts container startup.
