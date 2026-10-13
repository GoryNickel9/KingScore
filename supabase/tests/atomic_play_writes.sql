-- Isolated synthetic SQL tests, run after atomic_play_fixture.sql and migration.
-- No remote data or ELO computation. Failures abort psql via ON_ERROR_STOP.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA atomic_test;
GRANT USAGE ON SCHEMA atomic_test TO anon, authenticated;
CREATE TABLE atomic_test.observations (name text PRIMARY KEY, value jsonb NOT NULL);
GRANT SELECT, INSERT, UPDATE ON atomic_test.observations TO authenticated;

CREATE FUNCTION atomic_test.assert(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', p_message; END IF;
END $$;
CREATE FUNCTION atomic_test.expect_error(p_sql text, p_state text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'Expected SQLSTATE %, statement succeeded', p_state USING ERRCODE = 'XX000';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE IS DISTINCT FROM p_state THEN
      RAISE EXCEPTION 'Expected SQLSTATE %, received %: %', p_state, SQLSTATE, SQLERRM;
    END IF;
  END;
END $$;
CREATE FUNCTION atomic_test.payload() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '{"game_id":"10000000-0000-0000-0000-000000000001","played_at":"2026-10-13","duration_minutes":0,"source":"offline","notes":"Sintetico 😀","is_cooperative":false,"team_won":null,"scores":[{"id":null,"player_id":"20000000-0000-0000-0000-000000000001","score":0,"winner":true,"color":"red","role":"leader"},{"id":null,"player_id":"20000000-0000-0000-0000-000000000002","score":12.5,"winner":false,"color":null,"role":null}]}'::jsonb
$$;
CREATE FUNCTION atomic_test.edit_payload(p_editor jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_editor #> '{detail,play}') - 'id' - 'user_id' - 'location' - 'bga_table_id' - 'created_at'
    || jsonb_build_object('scores', (
      SELECT jsonb_agg((item -> 'score') - 'play_id' - 'position' ORDER BY item #>> '{score,player_id}')
      FROM jsonb_array_elements(p_editor #> '{detail,scores}') AS item
    ))
$$;

INSERT INTO auth.users(id,email) VALUES
 ('30000000-0000-0000-0000-000000000001','admin-a@synthetic.invalid'),
 ('30000000-0000-0000-0000-000000000002','admin-b@synthetic.invalid'),
 ('30000000-0000-0000-0000-000000000003','player@synthetic.invalid');
INSERT INTO public.games(id,name) VALUES ('10000000-0000-0000-0000-000000000001','Fixture game');
INSERT INTO public.players(id,user_id,name,alias) VALUES
 ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Uno','Uno'),
 ('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','Due',null),
 ('20000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000003','Tre',null);
INSERT INTO public.plays(id,user_id,game_id,played_at,location,notes,duration_minutes,source,bga_table_id,created_at,is_cooperative,team_won)
 VALUES ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002',
 '10000000-0000-0000-0000-000000000001','2026-10-12','Luogo preservato','Import preservato',0,'offline','synthetic-table','2026-01-01T10:00:00Z',false,null);
INSERT INTO public.play_scores(id,play_id,player_id,score,winner,color,role,position) VALUES
 ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',0,true,'blue','captain',1),
 ('50000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',null,false,null,null,2);
-- The score UUID order deliberately differs from the historical ranking order.
INSERT INTO public.plays(id,user_id,game_id,played_at,source,is_cooperative)
 VALUES ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','2026-10-10','offline',false);
INSERT INTO public.play_scores(id,play_id,player_id,score,winner,position) VALUES
 ('50000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',20,false,2),
 ('50000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002',null,false,1),
 ('50000000-0000-0000-0000-000000000005','40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003',0,false,3);
INSERT INTO public.play_comments(id,play_id,user_id,content) VALUES
 ('60000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003','Commento da eliminare a cascata');
INSERT INTO public.elo_history(id,play_id,game_id,player_id,player_name,rating,rating_change,date,user_id)
 VALUES ('70000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
 '20000000-0000-0000-0000-000000000001','Uno',1234,12,'2026-10-12T12:00:00Z','30000000-0000-0000-0000-000000000002');
INSERT INTO public.player_ratings(player_id,game_id,rating,games_played,wins,losses,draws)
 VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',1234,17,8,5,4);
INSERT INTO public.player_general_ratings(player_id,user_id,rating,games_played,wins,losses,draws)
 VALUES ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002',1345,19,9,6,4);
INSERT INTO public.elo_recalc_runs(status,summary) VALUES ('succeeded','{"sentinel":true}');
CREATE TEMP TABLE elo_before AS SELECT
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.player_ratings AS t) AS ratings,
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.player_general_ratings AS t) AS general,
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.elo_recalc_runs AS t) AS runs;
INSERT INTO atomic_test.observations SELECT 'history-before', jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.elo_history t;

-- Anonymous and ordinary users, including an attempted user_metadata admin.
SET LOCAL ROLE anon;
SELECT atomic_test.expect_error('SELECT public.create_play_v1(gen_random_uuid(),atomic_test.payload())','42501');
SELECT atomic_test.expect_error($q$SELECT public.get_play_editor_v1('40000000-0000-0000-0000-000000000001')$q$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"30000000-0000-0000-0000-000000000003","app_metadata":{},"user_metadata":{"role":"admin"}}',true);
SET LOCAL ROLE authenticated;
SELECT atomic_test.expect_error('SELECT public.create_play_v1(gen_random_uuid(),atomic_test.payload())','42501');
SELECT atomic_test.expect_error($q$SELECT public.get_play_editor_v1('40000000-0000-0000-0000-000000000001')$q$,'42501');
SELECT atomic_test.expect_error($q$SELECT public.update_play_v1(gen_random_uuid(),'40000000-0000-0000-0000-000000000001','opaque',atomic_test.payload())$q$,'42501');
SELECT atomic_test.expect_error($q$SELECT public.delete_play_v1(gen_random_uuid(),'40000000-0000-0000-0000-000000000001','opaque')$q$,'42501');
RESET ROLE;
-- Even a synthetic admin role without a subject is not an authenticated actor.
SELECT set_config('request.jwt.claims','{"app_metadata":{"role":"admin"}}',true);
SET LOCAL ROLE authenticated;
SELECT atomic_test.expect_error('SELECT public.create_play_v1(gen_random_uuid(),atomic_test.payload())','42501');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"30000000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE response jsonb; editor jsonb; replay jsonb; BEGIN
 response:=public.create_play_v1('80000000-0000-0000-0000-000000000001',atomic_test.payload());
 PERFORM atomic_test.assert((response->>'replayed')::boolean=false,'create is not replay');
 PERFORM atomic_test.assert(length(response->>'revision')>0,'opaque revision present');
 editor:=public.get_play_editor_v1((response->>'play_id')::uuid);
 PERFORM atomic_test.assert(editor->>'revision'=response->>'revision','editor and mutation revision agree');
 PERFORM atomic_test.assert(editor#>>'{detail,play,user_id}'='30000000-0000-0000-0000-000000000001','create actor is historical owner');
 PERFORM atomic_test.assert(editor#>>'{detail,play,duration_minutes}'='0','zero duration survives');
 PERFORM atomic_test.assert(editor#>>'{detail,game,name}'='Fixture game','getter includes game join');
 PERFORM atomic_test.assert(jsonb_array_length(editor#>'{detail,scores}')=2,'all scores returned');
 PERFORM atomic_test.assert(EXISTS(SELECT 1 FROM jsonb_array_elements(editor#>'{detail,scores}') AS s WHERE s#>>'{score,score}'='0'),'zero score survives');
 PERFORM atomic_test.assert(EXISTS(SELECT 1 FROM jsonb_array_elements(editor#>'{detail,scores}') AS s WHERE (s#>>'{score,score}')::numeric=12.5),'decimal score survives');
 replay:=public.create_play_v1('80000000-0000-0000-0000-000000000001',atomic_test.payload());
 PERFORM atomic_test.assert(replay-'replayed'=response-'replayed' AND (replay->>'replayed')::boolean,'create receipt replay');
 INSERT INTO atomic_test.observations VALUES ('created',response);
 PERFORM atomic_test.expect_error(format('SELECT public.create_play_v1(%L,%L::jsonb)','80000000-0000-0000-0000-000000000001',jsonb_set(atomic_test.payload(),'{notes}','"Different"')),'PT409');
END $$;
RESET ROLE;

-- Replaying a committed receipt still requires the actor's CURRENT admin role.
SELECT set_config('request.jwt.claims','{"sub":"30000000-0000-0000-0000-000000000001","app_metadata":{}}',true);
SET LOCAL ROLE authenticated;
SELECT atomic_test.expect_error($q$SELECT public.create_play_v1('80000000-0000-0000-0000-000000000001',atomic_test.payload())$q$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"30000000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
SET LOCAL ROLE authenticated;

-- Getter ordering and metadata-only saves preserve historical null/tie ranks.
DO $$ DECLARE editor jsonb; fresh jsonb; payload jsonb; BEGIN
 editor:=public.get_play_editor_v1('40000000-0000-0000-0000-000000000002');
 PERFORM atomic_test.assert((SELECT array_agg(s#>>'{score,id}' ORDER BY ordinal) FROM jsonb_array_elements(editor#>'{detail,scores}') WITH ORDINALITY AS rows(s,ordinal))=
  ARRAY['50000000-0000-0000-0000-000000000004','50000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000005'],'getter score order follows stored position');
 payload:=atomic_test.edit_payload(editor)||'{"notes":"Only notes changed"}'::jsonb;
 PERFORM public.update_play_v1('80000000-0000-0000-0000-000000000010','40000000-0000-0000-0000-000000000002',editor->>'revision',payload);
 fresh:=public.get_play_editor_v1('40000000-0000-0000-0000-000000000002');
 PERFORM atomic_test.assert(fresh#>'{detail,scores}'=editor#>'{detail,scores}','notes-only update preserves every ID and position');
 SELECT jsonb_set(payload,'{scores}',jsonb_agg(s ORDER BY ordinal DESC)) INTO payload FROM jsonb_array_elements(payload->'scores') WITH ORDINALITY AS rows(s,ordinal);
 payload:=payload||'{"notes":"Reverse unchanged scores"}'::jsonb;
 PERFORM public.update_play_v1('80000000-0000-0000-0000-000000000011','40000000-0000-0000-0000-000000000002',fresh->>'revision',payload);
 fresh:=public.get_play_editor_v1('40000000-0000-0000-0000-000000000002');
 PERFORM atomic_test.assert(fresh#>'{detail,scores}'=editor#>'{detail,scores}','reordering unchanged score payload does not rerank historical nulls');
END $$;

-- Admin A edits B's play while preserving historical and score metadata/IDs.
DO $$ DECLARE editor jsonb; payload jsonb; response jsonb; fresh jsonb; BEGIN
 editor:=public.get_play_editor_v1('40000000-0000-0000-0000-000000000001');
 payload:=atomic_test.edit_payload(editor)||'{"notes":"Aggiornato 😀","duration_minutes":0}'::jsonb;
 response:=public.update_play_v1('80000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001',editor->>'revision',payload);
 fresh:=public.get_play_editor_v1('40000000-0000-0000-0000-000000000001');
 PERFORM atomic_test.assert(fresh->>'revision'=response->>'revision' AND fresh->>'revision'<>editor->>'revision','new content gets new revision');
 PERFORM atomic_test.assert(fresh#>>'{detail,play,user_id}'=editor#>>'{detail,play,user_id}','historical owner preserved');
 PERFORM atomic_test.assert((fresh#>'{detail,play}')-'notes'-'duration_minutes'=(editor#>'{detail,play}')-'notes'-'duration_minutes','noneditable metadata preserved');
 PERFORM atomic_test.assert((SELECT array_agg(s#>>'{score,id}' ORDER BY s#>>'{score,id}') FROM jsonb_array_elements(fresh#>'{detail,scores}') s)=ARRAY['50000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002'],'existing score IDs preserved');
 PERFORM atomic_test.assert(EXISTS(SELECT 1 FROM jsonb_array_elements(fresh#>'{detail,scores}') s WHERE s#>>'{score,id}'='50000000-0000-0000-0000-000000000001' AND s#>>'{score,color}'='blue' AND s#>>'{score,role}'='captain'),'color and role preserved');
 PERFORM atomic_test.assert(EXISTS(SELECT 1 FROM jsonb_array_elements(fresh#>'{detail,scores}') s WHERE s#>>'{score,id}'='50000000-0000-0000-0000-000000000002' AND s#>'{score,score}'='null'::jsonb),'null score preserved');
 INSERT INTO atomic_test.observations VALUES ('update-before',editor),('update-payload',payload),('update-result',response);
 PERFORM atomic_test.expect_error(format('SELECT public.update_play_v1(gen_random_uuid(),%L,%L,%L::jsonb)','40000000-0000-0000-0000-000000000001',editor->>'revision',payload),'PT409');
 PERFORM atomic_test.expect_error(format('SELECT public.delete_play_v1(gen_random_uuid(),%L,%L)','40000000-0000-0000-0000-000000000001',editor->>'revision'),'PT409');
END $$;
-- Revision excludes mutable display joins/comments and is timezone-independent.
DO $$ DECLARE editor jsonb; fresh jsonb; previous_timezone text; BEGIN
 editor:=public.get_play_editor_v1('40000000-0000-0000-0000-000000000002');
 INSERT INTO public.play_comments(play_id,content) VALUES ('40000000-0000-0000-0000-000000000002','Comment excluded from play revision');
 UPDATE public.players SET name='Renamed display-only fixture',alias='Alias changed' WHERE id='20000000-0000-0000-0000-000000000001';
 UPDATE public.games SET image_url='https://synthetic.invalid/image.png' WHERE id='10000000-0000-0000-0000-000000000001';
 fresh:=public.get_play_editor_v1('40000000-0000-0000-0000-000000000002');
 PERFORM atomic_test.assert(editor->>'revision'=fresh->>'revision','comments and player/game display joins do not change revision');
 previous_timezone:=current_setting('TimeZone');
 PERFORM set_config('TimeZone','Pacific/Auckland',true);
 fresh:=public.get_play_editor_v1('40000000-0000-0000-0000-000000000002');
 PERFORM atomic_test.assert(editor->>'revision'=fresh->>'revision','revision stable across session timezones');
 PERFORM set_config('TimeZone',previous_timezone,true);
END $$;
-- Migration is additive: a web metadata write changes revision but not receipt.
UPDATE public.plays SET notes='Legacy web after RPC' WHERE id='40000000-0000-0000-0000-000000000001';
DO $$ DECLARE replay jsonb; original jsonb; BEGIN
 SELECT value INTO original FROM atomic_test.observations WHERE name='update-result';
 replay:=public.update_play_v1('80000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001',
  (SELECT value->>'revision' FROM atomic_test.observations WHERE name='update-before'),
  (SELECT value FROM atomic_test.observations WHERE name='update-payload'));
 PERFORM atomic_test.assert(replay-'replayed'=original-'replayed' AND (replay->>'replayed')::boolean,'update replay precedes stale revision check');
 PERFORM atomic_test.assert((SELECT notes FROM public.plays WHERE id='40000000-0000-0000-0000-000000000001')='Legacy web after RPC','replay does not overwrite newer data');
END $$;

-- A cooperative-mode change must rerank even when individual fields match.
DO $$ DECLARE payload jsonb; result jsonb; editor jsonb; fresh jsonb; BEGIN
 payload:=jsonb_set(jsonb_set(atomic_test.payload(),'{scores,0,winner}','false'),'{is_cooperative}','true')||'{"team_won":false}'::jsonb;
 result:=public.create_play_v1('80000000-0000-0000-0000-000000000012',payload);
 editor:=public.get_play_editor_v1((result->>'play_id')::uuid);
 PERFORM atomic_test.assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(editor#>'{detail,scores}') s WHERE s#>>'{score,position}'<>'2'),'cooperative loss positions are 2');
 payload:=atomic_test.edit_payload(editor)||'{"is_cooperative":false,"team_won":null}'::jsonb;
 PERFORM public.update_play_v1('80000000-0000-0000-0000-000000000013',(result->>'play_id')::uuid,editor->>'revision',payload);
 fresh:=public.get_play_editor_v1((result->>'play_id')::uuid);
 PERFORM atomic_test.assert(EXISTS(SELECT 1 FROM jsonb_array_elements(fresh#>'{detail,scores}') s WHERE s#>>'{score,position}'='1') AND
  EXISTS(SELECT 1 FROM jsonb_array_elements(fresh#>'{detail,scores}') s WHERE s#>>'{score,position}'='2'),'mode change derives competitive positions');
END $$;
-- Explicit API bound; historical getter does not impose the mutation bound.
DO $$ DECLARE items jsonb:='[]'; participant uuid; payload jsonb; result jsonb; editor jsonb; BEGIN
 FOR i IN 1..64 LOOP
  participant:=gen_random_uuid();
  INSERT INTO public.players(id,name) VALUES (participant,'Cardinality fixture '||i::text);
  items:=items||jsonb_build_array(jsonb_build_object('id',null,'player_id',participant,'score',i,'winner',i=1,'color',null,'role',null));
  IF i=63 THEN
   payload:=jsonb_set(atomic_test.payload(),'{scores}',items);
   result:=public.create_play_v1('80000000-0000-0000-0000-000000000014',payload);
   editor:=public.get_play_editor_v1((result->>'play_id')::uuid);
   PERFORM atomic_test.assert(jsonb_array_length(editor#>'{detail,scores}')=63,'63 participants accepted');
  END IF;
 END LOOP;
 payload:=jsonb_set(atomic_test.payload(),'{scores}',items);
 PERFORM atomic_test.expect_error(format('SELECT public.create_play_v1(gen_random_uuid(),%L::jsonb)',payload),'22023');
 -- Model an existing legacy play with 64 rows through the allowed direct writer.
 INSERT INTO public.play_scores(play_id,player_id,score,winner,position) VALUES ((result->>'play_id')::uuid,participant,64,false,64);
 editor:=public.get_play_editor_v1((result->>'play_id')::uuid);
 PERFORM atomic_test.assert(jsonb_array_length(editor#>'{detail,scores}')=64,'historical getter remains unbounded');
END $$;

-- Validate types, cardinality, references and ownership BEFORE committing data.
DO $$ DECLARE invalid jsonb; base jsonb:=atomic_test.payload(); before_count bigint; after_count bigint; foreign_score text; editor jsonb; payload jsonb; BEGIN
 SELECT count(*) INTO before_count FROM public.plays;
 FOR invalid IN SELECT v FROM (VALUES
  ('null'::jsonb),('[]'::jsonb),('{}'::jsonb),
  (jsonb_set(base,'{duration_minutes}','-1')),
  (jsonb_set(base,'{duration_minutes}','0.5')),
  (jsonb_set(base,'{played_at}','"2026-02-30"')),
  (jsonb_set(base,'{source}','"manual"')),
  (jsonb_set(base,'{team_won}','true')),
  (jsonb_set(base,'{winner}','true')),
  (jsonb_set(base,'{scores}','[]')),
  (jsonb_set(base,'{scores,1,player_id}',base#>'{scores,0,player_id}')),
  (jsonb_set(base,'{scores,0,id}','"50000000-0000-0000-0000-000000000001"')),
  (jsonb_set(base,'{scores,0,score}','"NaN"')),
  (jsonb_set(base,'{scores,0,score}','1e400')),
  (jsonb_set(base,'{scores,0,winner}','"true"')),
  (jsonb_set(base,'{scores,0,player_id}','null')),
  (jsonb_set(base,'{is_cooperative}','true')||'{"team_won":true}'::jsonb)
 ) AS cases(v) LOOP
  PERFORM atomic_test.expect_error(format('SELECT public.create_play_v1(gen_random_uuid(),%L::jsonb)',invalid),'22023');
 END LOOP;
 SELECT count(*) INTO after_count FROM public.plays;
 PERFORM atomic_test.assert(before_count=after_count,'invalid creates leave no parent rows');
 PERFORM atomic_test.expect_error(format('SELECT public.create_play_v1(gen_random_uuid(),%L::jsonb)',jsonb_set(base,'{game_id}','"ffffffff-ffff-ffff-ffff-ffffffffffff"')),'23503');
 PERFORM atomic_test.expect_error(format('SELECT public.create_play_v1(gen_random_uuid(),%L::jsonb)',jsonb_set(base,'{scores,0,player_id}','"ffffffff-ffff-ffff-ffff-ffffffffffff"')),'23503');
 editor:=public.get_play_editor_v1('40000000-0000-0000-0000-000000000001');
 payload:=atomic_test.edit_payload(editor);
 SELECT s.id::text INTO foreign_score FROM public.play_scores s WHERE s.play_id=(SELECT (value->>'play_id')::uuid FROM atomic_test.observations WHERE name='created') LIMIT 1;
 PERFORM atomic_test.expect_error(format('SELECT public.update_play_v1(gen_random_uuid(),%L,%L,%L::jsonb)','40000000-0000-0000-0000-000000000001',editor->>'revision',jsonb_set(payload,'{scores,0,id}',to_jsonb(foreign_score))),'22023');
 PERFORM atomic_test.expect_error(format('SELECT public.update_play_v1(gen_random_uuid(),%L,%L,%L::jsonb)','40000000-0000-0000-0000-000000000001',editor->>'revision',jsonb_set(payload,'{scores,1,id}',payload#>'{scores,0,id}')),'22023');
 PERFORM atomic_test.assert(public.get_play_editor_v1('40000000-0000-0000-0000-000000000001')=editor,'invalid updates leave entire detail/revision intact');
 PERFORM atomic_test.expect_error($q$SELECT public.get_play_editor_v1('ffffffff-ffff-ffff-ffff-ffffffffffff')$q$,'PT404');
 PERFORM atomic_test.expect_error(format('SELECT public.update_play_v1(gen_random_uuid(),%L,%L,%L::jsonb)','ffffffff-ffff-ffff-ffff-ffffffffffff','opaque',base),'PT404');
 PERFORM atomic_test.expect_error($q$SELECT public.delete_play_v1(gen_random_uuid(),'ffffffff-ffff-ffff-ffff-ffffffffffff','opaque')$q$,'PT404');
END $$;
RESET ROLE;

-- Artificial late failure proves metadata + scores + receipt roll back together.
CREATE FUNCTION atomic_test.fail_score() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Synthetic score failure' USING ERRCODE='P0001';
END $$;
CREATE TRIGGER atomic_test_fail_score BEFORE INSERT OR UPDATE ON public.play_scores
 FOR EACH ROW EXECUTE FUNCTION atomic_test.fail_score();
SET LOCAL ROLE authenticated;
DO $$ DECLARE editor jsonb; payload jsonb; created_before bigint; BEGIN
 editor:=public.get_play_editor_v1('40000000-0000-0000-0000-000000000001');
 payload:=atomic_test.edit_payload(editor)||'{"notes":"Must roll back"}'::jsonb;
 INSERT INTO atomic_test.observations VALUES ('rollback-editor',editor),('rollback-payload',payload);
 SELECT count(*) INTO created_before FROM public.plays;
 PERFORM atomic_test.expect_error(format('SELECT public.create_play_v1(%L,%L::jsonb)','80000000-0000-0000-0000-000000000003',atomic_test.payload()),'P0001');
 PERFORM atomic_test.assert((SELECT count(*) FROM public.plays)=created_before,'failed create parent rolled back');
 PERFORM atomic_test.expect_error(format('SELECT public.update_play_v1(%L,%L,%L,%L::jsonb)','80000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000001',editor->>'revision',payload),'P0001');
 PERFORM atomic_test.assert(public.get_play_editor_v1('40000000-0000-0000-0000-000000000001')=editor,'late failure rolls back metadata and scores');
END $$;
RESET ROLE;
DROP TRIGGER atomic_test_fail_score ON public.play_scores;
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; BEGIN
 result:=public.create_play_v1('80000000-0000-0000-0000-000000000003',atomic_test.payload());
 PERFORM atomic_test.assert((result->>'replayed')::boolean=false,'failed create left no success receipt');
 result:=public.update_play_v1('80000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000001',
  (SELECT value->>'revision' FROM atomic_test.observations WHERE name='rollback-editor'),
  (SELECT value FROM atomic_test.observations WHERE name='rollback-payload'));
 PERFORM atomic_test.assert((result->>'replayed')::boolean=false,'failed update left no success receipt');
 PERFORM atomic_test.assert((SELECT value FROM atomic_test.observations WHERE name='history-before')=(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.elo_history t),'create/update did not alter ELO history');
END $$;
RESET ROLE;
CREATE TRIGGER atomic_test_fail_comment BEFORE DELETE ON public.play_comments
 FOR EACH ROW EXECUTE FUNCTION atomic_test.fail_score();
SET LOCAL ROLE authenticated;
DO $$ DECLARE editor jsonb; BEGIN
 editor:=public.get_play_editor_v1('40000000-0000-0000-0000-000000000001');
 PERFORM atomic_test.expect_error(format('SELECT public.delete_play_v1(%L,%L,%L)','80000000-0000-0000-0000-000000000005','40000000-0000-0000-0000-000000000001',editor->>'revision'),'P0001');
 PERFORM atomic_test.assert(public.get_play_editor_v1('40000000-0000-0000-0000-000000000001')=editor,'failed cascade delete restores parent and scores');
 PERFORM atomic_test.assert(EXISTS(SELECT 1 FROM public.play_comments WHERE id='60000000-0000-0000-0000-000000000001'),'failed delete restores comment');
 PERFORM atomic_test.assert(EXISTS(SELECT 1 FROM public.elo_history WHERE id='70000000-0000-0000-0000-000000000001'),'failed delete restores history');
END $$;
RESET ROLE;
DROP TRIGGER atomic_test_fail_comment ON public.play_comments;
SET LOCAL ROLE authenticated;

-- Delete and its receipt are atomic; cascades remove only attached child rows.
DO $$ DECLARE editor jsonb; result jsonb; replay jsonb; BEGIN
 editor:=public.get_play_editor_v1('40000000-0000-0000-0000-000000000001');
 result:=public.delete_play_v1('80000000-0000-0000-0000-000000000005','40000000-0000-0000-0000-000000000001',editor->>'revision');
 PERFORM atomic_test.assert((result->>'deleted')::boolean AND (result->>'replayed')::boolean=false,'delete confirmed');
 PERFORM atomic_test.assert(NOT EXISTS(SELECT 1 FROM public.plays WHERE id='40000000-0000-0000-0000-000000000001'),'parent deleted');
 PERFORM atomic_test.assert(NOT EXISTS(SELECT 1 FROM public.play_scores WHERE play_id='40000000-0000-0000-0000-000000000001'),'score cascade');
 PERFORM atomic_test.assert(NOT EXISTS(SELECT 1 FROM public.play_comments WHERE play_id='40000000-0000-0000-0000-000000000001'),'comment cascade');
 PERFORM atomic_test.assert(NOT EXISTS(SELECT 1 FROM public.elo_history WHERE play_id='40000000-0000-0000-0000-000000000001'),'history cascade');
 replay:=public.delete_play_v1('80000000-0000-0000-0000-000000000005','40000000-0000-0000-0000-000000000001',editor->>'revision');
 PERFORM atomic_test.assert(replay-'replayed'=result-'replayed' AND (replay->>'replayed')::boolean,'delete receipt survives absent parent');
 PERFORM atomic_test.expect_error(format('SELECT public.delete_play_v1(gen_random_uuid(),%L,%L)','40000000-0000-0000-0000-000000000001',editor->>'revision'),'PT404');
 PERFORM atomic_test.expect_error(format('SELECT public.create_play_v1(%L,%L::jsonb)','80000000-0000-0000-0000-000000000005',atomic_test.payload()),'PT409');
END $$;
-- A create receipt survives deletion too; replay never recreates the parent.
DO $$ DECLARE original jsonb; editor jsonb; replay jsonb; BEGIN
 SELECT value INTO original FROM atomic_test.observations WHERE name='created';
 editor:=public.get_play_editor_v1((original->>'play_id')::uuid);
 PERFORM public.delete_play_v1('80000000-0000-0000-0000-000000000006',(original->>'play_id')::uuid,editor->>'revision');
 replay:=public.create_play_v1('80000000-0000-0000-0000-000000000001',atomic_test.payload());
 PERFORM atomic_test.assert(replay-'replayed'=original-'replayed' AND (replay->>'replayed')::boolean,'create replay survives delete');
 PERFORM atomic_test.assert(NOT EXISTS(SELECT 1 FROM public.plays WHERE id=(original->>'play_id')::uuid),'create replay cannot recreate deleted play');
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"30000000-0000-0000-0000-000000000002","app_metadata":{"role":"admin"}}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; BEGIN
 result:=public.create_play_v1('80000000-0000-0000-0000-000000000001',atomic_test.payload());
 PERFORM atomic_test.assert((result->>'replayed')::boolean=false,'request ID scoped to actor');
 PERFORM atomic_test.assert(result->>'play_id'<>(SELECT value->>'play_id' FROM atomic_test.observations WHERE name='created'),'another actor cannot replay first actor receipt');
END $$;
RESET ROLE;

-- Production helpers and receipts are inaccessible even to authenticated admin.
DO $$ DECLARE fn record; privilege text; actor text; relation text; BEGIN
 FOR fn IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='kingscore_private' LOOP
  PERFORM atomic_test.assert(NOT has_function_privilege('anon',fn.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',fn.oid,'EXECUTE'),'private helper EXECUTE revoked');
 END LOOP;
 FOR relation IN SELECT quote_ident(n.nspname)||'.'||quote_ident(c.relname) FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='kingscore_private' AND c.relkind IN ('r','p') LOOP
  PERFORM atomic_test.assert(NOT has_table_privilege('anon',relation,'SELECT') AND NOT has_table_privilege('authenticated',relation,'SELECT'),'private receipt SELECT revoked');
 END LOOP;
 FOREACH actor IN ARRAY ARRAY['anon','authenticated'] LOOP
  FOREACH relation IN ARRAY ARRAY['public.plays','public.play_scores'] LOOP
   FOREACH privilege IN ARRAY ARRAY['TRUNCATE','REFERENCES','TRIGGER'] LOOP
    PERFORM atomic_test.assert(NOT has_table_privilege(actor,relation,privilege),'unsafe direct privilege revoked');
   END LOOP;
  END LOOP;
 END LOOP;
 PERFORM atomic_test.assert((SELECT ratings FROM elo_before) IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.player_ratings t),'per-game rating sentinel unchanged');
 PERFORM atomic_test.assert((SELECT general FROM elo_before) IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.player_general_ratings t),'general rating sentinel unchanged');
 PERFORM atomic_test.assert((SELECT runs FROM elo_before) IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.elo_recalc_runs t),'no ELO run created or updated');
END $$;
SELECT 'PASS: atomic play SQL permissions, receipts, validation, rollback, cascades and no-ELO checks' AS result;
ROLLBACK;
