\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users(id) VALUES ('a0000000-0000-0000-0000-000000000001');
INSERT INTO public.games(id,name) VALUES ('a0000000-0000-0000-0000-000000000002','Web exact score');
INSERT INTO public.players(id,name) VALUES ('a0000000-0000-0000-0000-000000000003','Web exact player');
SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE payload jsonb := '{"game_id":"a0000000-0000-0000-0000-000000000002","played_at":"2026-10-13","duration_minutes":0,"source":"offline","notes":null,"is_cooperative":false,"team_won":null,"scores":[{"id":null,"player_id":"a0000000-0000-0000-0000-000000000003","score":"9007199254740993.125","winner":true,"color":"red","role":"mage"}]}'::jsonb;
  result jsonb; editor jsonb; android jsonb; replay jsonb; score_id uuid; target_id uuid; old_revision text;
BEGIN
  result := public.create_web_play_v1('a0000000-0000-0000-0000-000000000004',payload);
  target_id := (result->>'play_id')::uuid;
  editor := public.get_web_play_editor_v1(target_id);
  IF editor#>>'{detail,scores,0,score,score}' <> '9007199254740993.125' OR
    pg_catalog.jsonb_typeof(editor#>'{detail,scores,0,score,score}') <> 'string' THEN RAISE EXCEPTION 'Web score lost decimal precision'; END IF;
  score_id := (editor#>>'{detail,scores,0,score,id}')::uuid;
  android := public.get_play_editor_v1(target_id);
  IF pg_catalog.jsonb_typeof(android#>'{detail,scores,0,score,score}') <> 'number' OR
    (android#>>'{detail,scores,0,score,score}')::numeric <> 9007199254740993.125 OR editor->>'revision' <> android->>'revision'
    THEN RAISE EXCEPTION 'Android contract or shared revision changed'; END IF;
  payload := pg_catalog.jsonb_set(payload,'{scores,0,id}',pg_catalog.to_jsonb(score_id::text)) || '{"notes":"Only notes changed"}'::jsonb;
  old_revision := editor->>'revision';
  result := public.update_web_play_v1('a0000000-0000-0000-0000-000000000005',target_id,old_revision,payload);
  editor := public.get_web_play_editor_v1(target_id);
  IF editor#>>'{detail,scores,0,score,score}' <> '9007199254740993.125' OR (editor#>>'{detail,scores,0,score,id}')::uuid <> score_id
    THEN RAISE EXCEPTION 'Metadata save changed exact score or ID'; END IF;
  replay := public.update_web_play_v1('a0000000-0000-0000-0000-000000000005',target_id,old_revision,payload);
  IF replay-'replayed' <> result-'replayed' OR replay->'replayed' <> 'true'::jsonb THEN RAISE EXCEPTION 'Web replay failed'; END IF;
  BEGIN
    PERFORM public.create_play_v1('a0000000-0000-0000-0000-000000000006',pg_catalog.jsonb_set(payload,'{scores,0,id}','null'));
    RAISE EXCEPTION 'Android accepted textual scores';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  payload := pg_catalog.jsonb_set(payload,'{scores,0,id}','null') || '{"notes":"Another play"}'::jsonb;
  BEGIN
    PERFORM public.create_web_play_v1('a0000000-0000-0000-0000-000000000007',pg_catalog.jsonb_set(payload,'{scores,0,score}','"12points"'));
    RAISE EXCEPTION 'Invalid score prefix accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    PERFORM public.create_web_play_v1('a0000000-0000-0000-0000-000000000007',pg_catalog.jsonb_set(payload,'{scores,0,score}','"1e1000000"'));
    RAISE EXCEPTION 'Huge exponent accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  result := public.create_web_play_v1('a0000000-0000-0000-0000-000000000007',pg_catalog.jsonb_set(payload,'{scores,0,score}','null'));
  IF result->'replayed' <> 'false'::jsonb THEN RAISE EXCEPTION 'Failed validation left a receipt'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000001","app_metadata":{}}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.get_web_play_editor_v1('a0000000-0000-0000-0000-000000000002'); RAISE EXCEPTION 'Non-admin getter accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ DECLARE fn record; BEGIN
  FOR fn IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='kingscore_private' LOOP
    IF has_function_privilege('authenticated',fn.oid,'EXECUTE') OR has_function_privilege('anon',fn.oid,'EXECUTE') THEN RAISE EXCEPTION 'Private helper leaked'; END IF;
  END LOOP;
END $$;
SELECT 'PASS: exact web score text, Android compatibility, shared revision, metadata, replay and validation';
ROLLBACK;
