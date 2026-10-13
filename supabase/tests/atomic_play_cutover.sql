\set ON_ERROR_STOP on
BEGIN;
DO $$ DECLARE actor text; privilege text; relation text; BEGIN
  FOREACH actor IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH relation IN ARRAY ARRAY['public.plays','public.play_scores'] LOOP
      FOREACH privilege IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF has_table_privilege(actor,relation,privilege) THEN RAISE EXCEPTION 'Legacy privilege still enabled: % % %',actor,relation,privilege; END IF;
      END LOOP;
      IF NOT has_table_privilege(actor,relation,'SELECT') THEN RAISE EXCEPTION 'Read permission lost'; END IF;
    END LOOP;
    IF has_function_privilege(actor,'public.replace_play_scores(uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Legacy score RPC remains enabled'; END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated','public.create_play_v1(uuid,jsonb)','EXECUTE') OR
    NOT has_function_privilege('authenticated','public.create_web_play_v1(uuid,jsonb)','EXECUTE') OR
    NOT has_function_privilege('authenticated','public.import_bga_play_v1(uuid,jsonb,jsonb,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Atomic RPC permission lost'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN INSERT INTO public.plays(played_at) VALUES ('2026-10-13'); RAISE EXCEPTION 'Direct insert accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.replace_play_scores(gen_random_uuid(),'[]'); RAISE EXCEPTION 'Legacy RPC accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'PASS: RPC-only cutover rejects old writers and preserves reads/atomic endpoints';
ROLLBACK;
