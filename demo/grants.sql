-- Read-only role for the dashboard — and a warning about what it can actually
-- see.
--
--   psql "$SUPERUSER_URL" -f demo/grants.sql
--
-- Verified against pg_durable 0.2.5.
--
-- THE CATCH: pg_durable enforces row-level security on instances, scoped to
-- submitted_by = current_user. A role only sees instances it started itself,
-- and only superusers bypass that. So a dedicated reader role gives you a
-- dashboard that lists nothing — not because of a missing grant (granting
-- SELECT on the extension's internal tables changes nothing), but because the
-- rows are filtered by design.
--
-- That leaves two honest options:
--
--   1. Fleet-wide dashboard: connect as a superuser. That is what
--      server/.env does for the local demo. It contradicts the read-only-role
--      advice in the top-level README, which was written before this was
--      checked.
--   2. Per-user dashboard: give each role its own connection and let each
--      person see their own instances. This is the grant below, and it is the
--      model the extension is actually built for.
--
-- Neither is a read-only role that watches everyone's workflows. If you need
-- that, it has to come from the extension — a SECURITY DEFINER view over the
-- instances, owned by the workflow owner, granted to the monitoring role.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_reader') THEN
    CREATE ROLE dashboard_reader LOGIN PASSWORD 'dashboard_reader';
  END IF;
END $$;

-- with_grant => true is what grants EXECUTE on df.metrics(). Without it the
-- /api/metrics route fails with "permission denied for function metrics" while
-- every other route works, which is a confusing way to find this out.
SELECT df.grant_usage('dashboard_reader', include_http => false, with_grant => true);
