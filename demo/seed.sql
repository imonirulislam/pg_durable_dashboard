-- Demo data for the dashboard: a handful of real durable functions in
-- different states, so the instance list, the status colours and the DAG view
-- all have something to show.
--
--   psql "$DATABASE_URL" -f demo/seed.sql
--
-- Assumes demo/schema.sql has already run. Safe to run repeatedly — each run
-- just adds more instances.
--
-- This cannot run from docker-entrypoint-initdb.d: df.start() fails there with
-- "pg_durable background worker not yet initialized". The compose file runs it
-- as a separate step once the database reports healthy.

-- Each round gets its own pending order and document to work on. Without this,
-- the first run consumes the only pending row and every later run of
-- process-order fails on an empty $order_id — which looks like a broken demo
-- rather than a repeated one.
INSERT INTO playground.orders (status, total) VALUES ('pending', 42.00);
INSERT INTO playground.documents (title, status)
VALUES ('Q3 vendor contract', 'awaiting_approval');

-- 1. completed — a linear pipeline that captures a named result and reuses it.
SELECT df.start(
  'SELECT id FROM playground.orders WHERE status = ''pending'' LIMIT 1' |=> 'order_id'
  ~> 'UPDATE playground.orders SET status = ''processing'' WHERE id = $order_id'
  ~> 'INSERT INTO playground.logs (msg) VALUES (''charged order '' || $order_id)'
  ~> 'UPDATE playground.orders SET status = ''completed'' WHERE id = $order_id',
  'process-order'
) AS process_order;

-- 2. completed — fan-out/fan-in, so the DAG view has a branch rather than a line.
SELECT df.start(
  'INSERT INTO playground.logs (msg) VALUES (''rollup: begin'')'
  ~> df.join(
       'INSERT INTO playground.logs (msg) VALUES (''rollup: orders'')',
       'INSERT INTO playground.logs (msg) VALUES (''rollup: documents'')'
     )
  ~> 'INSERT INTO playground.logs (msg) VALUES (''rollup: done'')',
  'nightly-rollup'
) AS nightly_rollup;

-- 3. completed — conditional branch: one side runs, the other stays skipped.
SELECT df.start(
  df.if(
    'SELECT count(*) > 10 FROM playground.orders',
    'INSERT INTO playground.logs (msg) VALUES (''high volume'')',
    'INSERT INTO playground.logs (msg) VALUES (''low volume'')'
  ),
  'volume-check'
) AS volume_check;

-- 4. failed — a step that raises. Shows the red node and the failed counter.
SELECT df.start(
  'SELECT 1'
  ~> 'SELECT * FROM playground.no_such_table'
  ~> 'INSERT INTO playground.logs (msg) VALUES (''never runs'')',
  'charge-card'
) AS charge_card;

-- 5. running — parked on an external signal for a day. Release it with:
--      SELECT df.signal('<instance_id>', 'approval', '{"approved": true}');
--    and watch the dashboard pick up the state change on its next poll.
SELECT df.start(
  'SELECT id FROM playground.documents LIMIT 1' |=> 'doc'
  ~> df.wait_for_signal('approval', 86400) |=> 'sig'
  ~> df.if(
       'SELECT ($sig::jsonb->>''timed_out'')::boolean = false',
       'UPDATE playground.documents SET status = ''approved'' WHERE id = $doc',
       'UPDATE playground.documents SET status = ''rejected'' WHERE id = $doc'
     ),
  'doc-approval'
) AS doc_approval;

-- 6. running — an eternal loop with a sleep between iterations. This is the one
--    that makes the dashboard's polling visibly do something: its execution
--    count climbs while you watch.
SELECT df.start(
  df.loop(
    'INSERT INTO playground.logs (msg) VALUES (''heartbeat'')' ~> df.sleep(30)
  ),
  'heartbeat-30s'
) AS heartbeat;

-- 7. cancelled — started, then cancelled straight away.
SELECT df.cancel(
  df.start(df.sleep(3600), 'stale-import'),
  'superseded by a rerun'
) AS stale_import;

-- 8. completed — three-way join. df.join3() records one JOIN node with the
--    third branch hidden in the node's query as {"extra_nodes": [...]}, the
--    same trick df.if()'s condition uses — worth having a real example of.
SELECT df.start(
  df.join3(
    'INSERT INTO playground.logs (msg) VALUES (''nightly: orders'')',
    'INSERT INTO playground.logs (msg) VALUES (''nightly: documents'')',
    'INSERT INTO playground.logs (msg) VALUES (''nightly: invoices'')'
  ),
  'nightly-close'
) AS nightly_close;

-- 9. completed — two branches racing; only the winner's side is meaningful.
SELECT df.start(
  df.race(
    'INSERT INTO playground.logs (msg) VALUES (''primary region responded'')',
    'INSERT INTO playground.logs (msg) VALUES (''fallback region responded'')'
  ),
  'failover-race'
) AS failover_race;

-- 10. running — a while-loop, not an unconditional one like heartbeat-30s.
--     Condition is always-true on purpose: this exists to exercise the
--     conditional-loop code path (LOOP's condition hidden in query the same
--     way IF's is), not to model a real drain — a condition tied to another
--     workflow's side effects would race it and could exit immediately.
SELECT df.start(
  df.loop(
    'INSERT INTO playground.logs (msg) VALUES (''polling for work'')' ~> df.sleep(20),
    'SELECT true'
  ),
  'poll-loop'
) AS poll_loop;

-- Config the workflows above would read via df.getvar() or {name}
-- interpolation. api_key is masked in the dashboard's variables panel by
-- name; api_base is not — pg_durable itself makes no such distinction, every
-- value here is plaintext in df.vars.
SELECT df.setvar('api_base', 'https://api.example.com');
SELECT df.setvar('api_key', 'sk_demo_not_a_real_key');
