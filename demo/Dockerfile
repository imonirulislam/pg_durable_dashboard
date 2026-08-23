# A throwaway Postgres with pg_durable installed, to develop the dashboard
# against. Microsoft publishes a prebuilt image; this only layers the demo
# schema and seed script on top.
#
# Their image is explicitly labelled "do not use in production" — same goes for
# this one, doubly so: the password lives in the compose file.
FROM ghcr.io/microsoft/pg_durable:pg17

# Runs once, on first boot of an empty data directory. DDL only — df.start()
# does not work this early (the pg_durable background worker isn't initialized
# until init finishes, and a failure here aborts the container).
COPY schema.sql /docker-entrypoint-initdb.d/20-pg-durable-demo-schema.sql

# Starts the demo workflows. Run after the database reports healthy — the
# compose file does this in a separate one-shot service.
COPY seed.sql /demo/seed.sql
