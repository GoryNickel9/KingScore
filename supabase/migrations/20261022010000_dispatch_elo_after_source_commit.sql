-- pg_net sends queued requests only after COMMIT; rollback also removes them.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regprocedure('kingscore_elo.request_refresh()') IS NULL
    OR to_regprocedure('kingscore_elo.mark_dirty()') IS NULL THEN
    RAISE EXCEPTION 'Existing ELO publication and private refresh dispatcher required';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION kingscore_elo.mark_dirty() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Keep the lock order used by the atomic save RPCs and catalog cascades.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kingscore:elo-source-v1', 0));
  UPDATE kingscore_elo.source_clock SET revision = revision + 1 WHERE singleton;
  IF pg_catalog.current_setting('kingscore_elo.refresh_queued', true) IS DISTINCT FROM 'true' THEN
    BEGIN
      PERFORM kingscore_elo.request_refresh();
      PERFORM pg_catalog.set_config('kingscore_elo.refresh_queued', 'true', true);
    EXCEPTION WHEN OTHERS THEN
      -- A dispatch failure must not turn a committed play into a failed save.
      -- The existing dirty-only cron job retries publication independently.
      RAISE WARNING 'ELO dispatch unavailable; periodic refresh will retry (SQLSTATE %)', SQLSTATE;
    END;
  END IF;
  RETURN NULL;
END;
$$;

COMMIT;
