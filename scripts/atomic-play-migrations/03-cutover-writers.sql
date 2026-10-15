-- Apply only after verified web deployment and global worker activation.
-- Additive RPCs remain available; old browser tabs must reload after this cutover.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
  IF to_regprocedure('public.get_elo_publication_v1()') IS NULL
    OR to_regprocedure('public.create_play_v1(uuid,jsonb)') IS NULL
    OR public.get_elo_publication_v1()->>'status' IS DISTINCT FROM 'current' THEN
    RAISE EXCEPTION 'Current global publication and atomic RPCs required before cutover';
  END IF;
END $$;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.plays,public.play_scores
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.player_ratings,public.player_general_ratings,public.elo_history
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE TRUNCATE ON public.games,public.players FROM PUBLIC,anon,authenticated,service_role;
REVOKE EXECUTE ON FUNCTION public.replace_play_scores(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE role_name text; table_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    FOREACH table_name IN ARRAY ARRAY['plays','play_scores','player_ratings','player_general_ratings','elo_history'] LOOP
      IF has_table_privilege(role_name,'public.'||table_name,'INSERT,UPDATE,DELETE,TRUNCATE')
        OR has_any_column_privilege(role_name,'public.'||table_name,'INSERT,UPDATE') THEN
        RAISE EXCEPTION 'Legacy write remains through inherited or column grant: %.%',role_name,table_name;
      END IF;
    END LOOP;
    IF has_function_privilege(role_name,'public.replace_play_scores(uuid,jsonb)','EXECUTE') THEN
      RAISE EXCEPTION 'Legacy score RPC remains available: %',role_name;
    END IF;
  END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
