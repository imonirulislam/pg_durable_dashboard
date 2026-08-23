-- Tables the demo workflows in seed.sql read and write. Plain DDL only — this
-- runs during container init, where df.start() is not yet available (the
-- pg_durable background worker isn't initialized until after init finishes).
CREATE SCHEMA IF NOT EXISTS playground;

CREATE TABLE IF NOT EXISTS playground.logs (
  id bigserial PRIMARY KEY,
  msg text,
  ts timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS playground.orders (
  id bigserial PRIMARY KEY,
  status text,
  total numeric
);

CREATE TABLE IF NOT EXISTS playground.documents (
  id bigserial PRIMARY KEY,
  title text,
  status text
);

INSERT INTO playground.orders (status, total)
SELECT 'pending', 42.00
WHERE NOT EXISTS (SELECT 1 FROM playground.orders WHERE status = 'pending');

INSERT INTO playground.documents (title, status)
SELECT 'Q3 vendor contract', 'awaiting_approval'
WHERE NOT EXISTS (SELECT 1 FROM playground.documents);
