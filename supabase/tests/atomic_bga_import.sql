-- Synthetic local-only import tests. No remote BGA/Supabase traffic or ELO work.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA bga_test;
GRANT USAGE ON SCHEMA bga_test TO anon, authenticated;
CREATE TABLE bga_test.observations(name text PRIMARY KEY, value jsonb NOT NULL);
GRANT SELECT, INSERT ON bga_test.observations TO authenticated;
CREATE FUNCTION bga_test.assert(p_ok boolean,p_message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',p_message; END IF;
END $$;
CREATE FUNCTION bga_test.expect_error(p_sql text,p_state text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'Expected SQLSTATE %, statement succeeded',p_state USING ERRCODE='XX000';
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE IS DISTINCT FROM p_state THEN RAISE EXCEPTION 'Expected SQLSTATE %, received %: %',p_state,SQLSTATE,SQLERRM; END IF;
 END;
END $$;
CREATE FUNCTION bga_test.payload() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT '{"game_id":"a1000000-0000-0000-0000-000000000001","played_at":"2026-10-13","duration_minutes":0,"source":"offline","notes":"Import 😀","is_cooperative":false,"team_won":null,"scores":[{"id":null,"player_id":"a2000000-0000-0000-0000-000000000001","score":0,"winner":true,"color":"blue","role":"mage"},{"id":null,"player_id":"a2000000-0000-0000-0000-000000000002","score":12.5,"winner":false,"color":null,"role":null}]}'::jsonb
$$;
CREATE FUNCTION bga_test.metadata(p_table text DEFAULT 'external-table') RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('location','Import "quoted" / Unicode 😀','bga_table_id',p_table)
$$;

INSERT INTO auth.users(id,email) VALUES
 ('a0000000-0000-0000-0000-000000000001','bga-admin-a@synthetic.invalid'),
 ('a0000000-0000-0000-0000-000000000002','bga-admin-b@synthetic.invalid'),
 ('a0000000-0000-0000-0000-000000000003','bga-user@synthetic.invalid');
INSERT INTO public.games(id,name) VALUES ('a1000000-0000-0000-0000-000000000001','BGA fixture game');
-- Both players belong to another owner: admin authorization is global.
INSERT INTO public.players(id,user_id,name) VALUES
 ('a2000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','Imported one'),
 ('a2000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000003','Imported two');
-- Existing duplicates must survive; adding a unique index would break this fixture.
INSERT INTO public.plays(id,user_id,game_id,played_at,source,bga_table_id,location) VALUES
 ('a3000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','2026-10-12','offline','legacy-duplicate','Legacy one'),
 ('a3000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','2026-10-12','offline','legacy-duplicate','Legacy two');
INSERT INTO public.player_ratings(player_id,game_id,rating,games_played)
 VALUES ('a2000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001',1234,17);
INSERT INTO public.player_general_ratings(player_id,user_id,rating,games_played)
 VALUES ('a2000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002',1345,19);
INSERT INTO public.elo_history(play_id,game_id,player_id,player_name,rating,rating_change,date)
 VALUES ('a3000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','Imported one',1234,12,'2026-10-12T12:00:00Z');
INSERT INTO public.elo_recalc_runs(status,summary) VALUES ('succeeded','{"bga-sentinel":true}');
CREATE TEMP TABLE bga_elo_before AS SELECT
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.player_ratings t) AS ratings,
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.player_general_ratings t) AS general,
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.elo_history t) AS history,
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.elo_recalc_runs t) AS runs;

SET LOCAL ROLE anon;
SELECT bga_test.expect_error($q$SELECT public.import_bga_play_v1(gen_random_uuid(),bga_test.payload(),bga_test.metadata(),'[7,null]')$q$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000003","app_metadata":{},"user_metadata":{"role":"admin"}}',true);
SET LOCAL ROLE authenticated;
SELECT bga_test.expect_error($q$SELECT public.import_bga_play_v1(gen_random_uuid(),bga_test.payload(),bga_test.metadata(),'[7,null]')$q$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; editor jsonb; replay jsonb; BEGIN
 result:=public.import_bga_play_v1('a8000000-0000-0000-0000-000000000001',bga_test.payload(),bga_test.metadata(),'[7,null]');
 PERFORM bga_test.assert((result->>'replayed')::boolean=false AND (result->>'skipped')::boolean=false,'new import confirmed');
 editor:=public.get_play_editor_v1((result->>'play_id')::uuid);
 PERFORM bga_test.assert(editor->>'revision'=result->>'revision','response revision agrees with editor');
 PERFORM bga_test.assert((editor#>>'{detail,play,user_id}')::uuid=auth.uid(),'owner is actor, not player owner');
 PERFORM bga_test.assert(editor#>>'{detail,play,bga_table_id}'='external-table' AND editor#>>'{detail,play,location}'=bga_test.metadata()->>'location','metadata preserved verbatim');
 PERFORM bga_test.assert(editor#>>'{detail,play,duration_minutes}'='0' AND editor#>>'{detail,play,source}'='offline','zero duration and source preserved');
 PERFORM bga_test.assert(EXISTS(SELECT 1 FROM jsonb_array_elements(editor#>'{detail,scores}') s WHERE s#>>'{score,player_id}'='a2000000-0000-0000-0000-000000000001' AND s#>>'{score,position}'='7' AND s#>>'{score,score}'='0' AND s#>>'{score,color}'='blue' AND s#>>'{score,role}'='mage'),'position/color/role/zero score preserved without ranking');
 PERFORM bga_test.assert(EXISTS(SELECT 1 FROM jsonb_array_elements(editor#>'{detail,scores}') s WHERE s#>>'{score,player_id}'='a2000000-0000-0000-0000-000000000002' AND s#>'{score,position}'='null'::jsonb AND (s#>>'{score,score}')::numeric=12.5),'parallel null position and decimal preserved');
 replay:=public.import_bga_play_v1('a8000000-0000-0000-0000-000000000001',bga_test.payload(),bga_test.metadata(),'[7,null]');
 PERFORM bga_test.assert(replay-'replayed'=result-'replayed' AND (replay->>'replayed')::boolean,'same request returns receipt');
 INSERT INTO bga_test.observations VALUES ('created',result),('created-editor',editor);
 PERFORM bga_test.expect_error(format('SELECT public.import_bga_play_v1(%L,%L::jsonb,%L::jsonb,%L::jsonb)','a8000000-0000-0000-0000-000000000001',bga_test.payload(),bga_test.metadata(),'[1,2]'),'PT409');
 PERFORM bga_test.expect_error(format('SELECT public.import_bga_play_v1(%L,%L::jsonb,%L::jsonb,%L::jsonb)','a8000000-0000-0000-0000-000000000001',bga_test.payload(),bga_test.metadata('different-table'),'[7,null]'),'PT409');
 PERFORM bga_test.expect_error(format('SELECT public.create_play_v1(%L,%L::jsonb)','a8000000-0000-0000-0000-000000000001',bga_test.payload()),'PT409');
END $$;
RESET ROLE;
-- Revocation is checked before receipt replay too.
SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000001","app_metadata":{}}',true);
SET LOCAL ROLE authenticated;
SELECT bga_test.expect_error($q$SELECT public.import_bga_play_v1('a8000000-0000-0000-0000-000000000001',bga_test.payload(),bga_test.metadata(),'[7,null]')$q$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
SET LOCAL ROLE authenticated;

DO $$ DECLARE original jsonb; editor jsonb; skipped jsonb; replay jsonb; BEGIN
 SELECT value INTO original FROM bga_test.observations WHERE name='created';
 SELECT value INTO editor FROM bga_test.observations WHERE name='created-editor';
 skipped:=public.import_bga_play_v1('a8000000-0000-0000-0000-000000000002',bga_test.payload()||'{"notes":"Must not overwrite"}'::jsonb,bga_test.metadata()||'{"location":null}'::jsonb,'[1,2]');
 PERFORM bga_test.assert(skipped->>'play_id'=original->>'play_id' AND (skipped->>'skipped')::boolean AND (skipped->>'replayed')::boolean=false,'different request for same actor/table skips');
 PERFORM bga_test.assert(public.get_play_editor_v1((original->>'play_id')::uuid)=editor,'skip preserves entire existing play and scores');
 replay:=public.import_bga_play_v1('a8000000-0000-0000-0000-000000000002',bga_test.payload()||'{"notes":"Must not overwrite"}'::jsonb,bga_test.metadata()||'{"location":null}'::jsonb,'[1,2]');
 PERFORM bga_test.assert(replay-'replayed'=skipped-'replayed' AND (replay->>'replayed')::boolean,'skip receipt replay');
 PERFORM bga_test.assert((SELECT count(*) FROM public.plays WHERE user_id='a0000000-0000-0000-0000-000000000001' AND bga_table_id='external-table')=1,'no extra parent on skip');
 skipped:=public.import_bga_play_v1('a8000000-0000-0000-0000-000000000003',bga_test.payload(),bga_test.metadata('legacy-duplicate'),'[7,null]');
 PERFORM bga_test.assert((skipped->>'skipped')::boolean AND skipped->>'play_id'='a3000000-0000-0000-0000-000000000001','legacy duplicate selection deterministic');
 PERFORM bga_test.assert((SELECT count(*) FROM public.plays WHERE bga_table_id='legacy-duplicate')=2,'legacy duplicates not consolidated');
 PERFORM bga_test.assert(NOT EXISTS(SELECT 1 FROM public.play_scores WHERE play_id IN ('a3000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000002')),'skip never repairs or changes old rows');
END $$;

DO $$ DECLARE invalid jsonb; metadata jsonb; before_count bigint; BEGIN
 SELECT count(*) INTO before_count FROM public.plays;
 FOR invalid IN SELECT v FROM (VALUES ('null'::jsonb),('{}'::jsonb),('[]'::jsonb),
  ('{"bga_table_id":"missing-location"}'::jsonb),
  ('{"location":null,"bga_table_id":"","user_id":"forged"}'::jsonb),
  ('{"location":true,"bga_table_id":"invalid"}'::jsonb),
  ('{"location":null,"bga_table_id":null}'::jsonb),
  (bga_test.metadata('')),(bga_test.metadata('   ')),(bga_test.metadata(repeat('x',257)))) AS cases(v) LOOP
  PERFORM bga_test.expect_error(format('SELECT public.import_bga_play_v1(gen_random_uuid(),%L::jsonb,%L::jsonb,%L::jsonb)',bga_test.payload(),invalid,'[7,null]'),'22023');
 END LOOP;
 metadata:=bga_test.metadata('validation-table');
 FOR invalid IN SELECT v FROM (VALUES ('null'::jsonb),('{}'::jsonb),('[]'::jsonb),('[1]'::jsonb),('[1,2,3]'::jsonb),
  ('[0,null]'::jsonb),('[-1,null]'::jsonb),('[1.5,null]'::jsonb),('[1.0,null]'::jsonb),('[2147483648,null]'::jsonb),
  ('[true,null]'::jsonb),('["1",null]'::jsonb)) AS cases(v) LOOP
  PERFORM bga_test.expect_error(format('SELECT public.import_bga_play_v1(gen_random_uuid(),%L::jsonb,%L::jsonb,%L::jsonb)',bga_test.payload(),metadata,invalid),'22023');
 END LOOP;
 PERFORM bga_test.expect_error(format('SELECT public.import_bga_play_v1(NULL,%L::jsonb,%L::jsonb,%L::jsonb)',bga_test.payload(),metadata,'[7,null]'),'22023');
 PERFORM bga_test.expect_error(format('SELECT public.import_bga_play_v1(gen_random_uuid(),%L::jsonb,%L::jsonb,%L::jsonb)',bga_test.payload()||'{"source":"online"}'::jsonb,metadata,'[7,null]'),'22023');
 PERFORM bga_test.expect_error(format('SELECT public.import_bga_play_v1(gen_random_uuid(),%L::jsonb,%L::jsonb,%L::jsonb)',jsonb_set(bga_test.payload(),'{scores}','[]'),metadata,'[]'),'22023');
 PERFORM bga_test.expect_error(format('SELECT public.import_bga_play_v1(gen_random_uuid(),%L::jsonb,%L::jsonb,%L::jsonb)',jsonb_set(bga_test.payload(),'{game_id}','"ffffffff-ffff-ffff-ffff-ffffffffffff"'),metadata,'[7,null]'),'23503');
 PERFORM bga_test.assert((SELECT count(*) FROM public.plays)=before_count,'invalid imports leave no parent rows');
 -- Upper-bound metadata plus nullable location remain valid.
 PERFORM public.import_bga_play_v1('a8000000-0000-0000-0000-000000000004',bga_test.payload(),bga_test.metadata(repeat('x',256))||'{"location":null}'::jsonb,'[2147483647,1]');
END $$;
RESET ROLE;

-- Fail on the second participant after parent insertion; no receipt or rows survive.
CREATE FUNCTION bga_test.fail_second_score() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.player_id='a2000000-0000-0000-0000-000000000002' THEN RAISE EXCEPTION 'Synthetic import failure' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bga_test_fail_score BEFORE INSERT ON public.play_scores FOR EACH ROW EXECUTE FUNCTION bga_test.fail_second_score();
SET LOCAL ROLE authenticated;
DO $$ DECLARE before_plays bigint; before_scores bigint; BEGIN
 SELECT count(*) INTO before_plays FROM public.plays; SELECT count(*) INTO before_scores FROM public.play_scores;
 PERFORM bga_test.expect_error(format('SELECT public.import_bga_play_v1(%L,%L::jsonb,%L::jsonb,%L::jsonb)','a8000000-0000-0000-0000-000000000005',bga_test.payload(),bga_test.metadata('rollback-table'),'[7,null]'),'P0001');
 PERFORM bga_test.assert((SELECT count(*) FROM public.plays)=before_plays AND (SELECT count(*) FROM public.play_scores)=before_scores,'parent and partial scores rolled back');
END $$;
RESET ROLE;
SELECT bga_test.assert(NOT EXISTS(SELECT 1 FROM kingscore_private.play_write_receipts WHERE actor_id='a0000000-0000-0000-0000-000000000001' AND request_id='a8000000-0000-0000-0000-000000000005'),'failed import has no receipt');
DROP TRIGGER bga_test_fail_score ON public.play_scores;
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; original jsonb; editor jsonb; replay jsonb; BEGIN
 result:=public.import_bga_play_v1('a8000000-0000-0000-0000-000000000005',bga_test.payload(),bga_test.metadata('rollback-table'),'[7,null]');
 PERFORM bga_test.assert((result->>'replayed')::boolean=false AND (result->>'skipped')::boolean=false,'retry failed transaction can commit');
 SELECT value INTO original FROM bga_test.observations WHERE name='created';
 editor:=public.get_play_editor_v1((original->>'play_id')::uuid);
 PERFORM public.delete_play_v1('a8000000-0000-0000-0000-000000000006',(original->>'play_id')::uuid,editor->>'revision');
 replay:=public.import_bga_play_v1('a8000000-0000-0000-0000-000000000001',bga_test.payload(),bga_test.metadata(),'[7,null]');
 PERFORM bga_test.assert(replay-'replayed'=original-'replayed' AND (replay->>'replayed')::boolean,'import receipt survives delete');
 PERFORM bga_test.assert(NOT EXISTS(SELECT 1 FROM public.plays WHERE id=(original->>'play_id')::uuid),'replay never recreates deleted import');
END $$;
RESET ROLE;

-- Another actor can use the same request/table: both namespaces are actor-specific.
SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000002","app_metadata":{"role":"admin"}}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; original jsonb; BEGIN
 SELECT value INTO original FROM bga_test.observations WHERE name='created';
 result:=public.import_bga_play_v1('a8000000-0000-0000-0000-000000000001',bga_test.payload(),bga_test.metadata('rollback-table'),'[1,2]');
 PERFORM bga_test.assert((result->>'replayed')::boolean=false AND (result->>'skipped')::boolean=false,'other actor has independent receipt and dedup scope');
 PERFORM bga_test.assert(result->>'play_id'<>original->>'play_id','other owner gets own imported play');
END $$;
RESET ROLE;
DO $$ BEGIN
 PERFORM bga_test.assert((SELECT ratings FROM bga_elo_before) IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.player_ratings t),'ratings unchanged');
 PERFORM bga_test.assert((SELECT general FROM bga_elo_before) IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.player_general_ratings t),'general ratings unchanged');
 PERFORM bga_test.assert((SELECT history FROM bga_elo_before) IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.elo_history t),'existing history unchanged');
 PERFORM bga_test.assert((SELECT runs FROM bga_elo_before) IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.elo_recalc_runs t),'no ELO job created or changed');
 PERFORM bga_test.assert(NOT has_schema_privilege('anon','kingscore_private','USAGE') AND NOT has_schema_privilege('authenticated','kingscore_private','USAGE'),'private schema not exposed');
END $$;
SELECT 'PASS: atomic BGA import permissions, metadata, external positions, receipts, dedup, rollback and no-ELO checks' AS result;
ROLLBACK;
