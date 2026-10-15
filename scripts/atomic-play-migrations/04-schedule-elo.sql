-- Supabase-only scheduler. Seed the named worker credential in Vault privately first.
-- Uses the documented pg_cron + pg_net pattern; no secret is embedded in the job.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
  IF to_regprocedure('public.get_elo_publication_v1()') IS NULL
    OR public.get_elo_publication_v1()->>'status' IS DISTINCT FROM 'current'
    OR NOT EXISTS(SELECT 1 FROM vault.secrets WHERE name='kingscore_elo_worker_service_key') THEN
    RAISE EXCEPTION 'Current global publication and named Vault credential required';
  END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
REVOKE USAGE ON SCHEMA net FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA net FROM PUBLIC,anon,authenticated;
CREATE FUNCTION kingscore_elo.request_refresh() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE token text;
BEGIN
  IF EXISTS(SELECT 1 FROM kingscore_elo.head h
    JOIN kingscore_elo.publications p ON p.publication_id=h.publication_id
    JOIN kingscore_elo.source_clock c ON c.revision=p.source_revision WHERE h.singleton AND c.singleton) THEN
    RETURN NULL;
  END IF;
  SELECT decrypted_secret INTO STRICT token FROM vault.decrypted_secrets WHERE name='kingscore_elo_worker_service_key';
  RETURN net.http_post(
    url:='https://rixivmeipbizoxyvrvaf.supabase.co/functions/v1/nightly-elo-recalc',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),
    body:='{}'::jsonb,timeout_milliseconds:=60000);
END $$;
REVOKE ALL ON FUNCTION kingscore_elo.request_refresh() FROM PUBLIC,anon,authenticated,service_role;
SELECT cron.schedule('kingscore-elo-v1-refresh','* * * * *','SELECT kingscore_elo.request_refresh();');
COMMIT;
