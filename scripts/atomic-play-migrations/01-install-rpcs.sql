-- Versioned RPC installation prepared for local validation. Not a cutover.
-- Requires existing application tables, trusted Auth and roles; creates none of them.
BEGIN;
SET LOCAL search_path = '';
SET LOCAL timezone = 'UTC';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Check relation kinds before locking or scanning: ordinary parents may inherit foreign children.
DO $compatibility$
DECLARE target text; relation oid; migration_role oid;
BEGIN
  IF current_setting('server_version_num')::integer < 150000 THEN
    RAISE EXCEPTION 'PostgreSQL 15 or newer required';
  END IF;
  SELECT oid INTO migration_role FROM pg_catalog.pg_roles
    WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
      AND rolname NOT IN ('anon','authenticated','service_role','authenticator');
  IF migration_role IS NULL THEN RAISE EXCEPTION 'Trusted non-client migration owner with RLS bypass required'; END IF;
  FOREACH target IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=target) THEN
      RAISE EXCEPTION 'Existing application role missing: %', target;
    END IF;
    IF pg_catalog.pg_has_role(target,current_user,'MEMBER') THEN
      RAISE EXCEPTION 'Client role must not inherit migration owner: %', target;
    END IF;
  END LOOP;
  FOREACH target IN ARRAY ARRAY['public.plays','public.play_scores','public.games','public.players','auth.users'] LOOP
    relation := pg_catalog.to_regclass(target);
    IF relation IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid=relation AND relkind='r')
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_inherits WHERE inhparent=relation OR inhrelid=relation) THEN
      RAISE EXCEPTION 'Ordinary non-inherited application table required: %', target;
    END IF;
    IF target LIKE 'public.%' AND NOT pg_catalog.pg_has_role(current_user,
      (SELECT relowner FROM pg_catalog.pg_class WHERE oid=relation),'USAGE') THEN
      RAISE EXCEPTION 'Migration owner must own application tables: %', target;
    END IF;
  END LOOP;
  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL OR pg_catalog.to_regprocedure('auth.jwt()') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('auth.uid()') AND prorettype='uuid'::pg_catalog.regtype)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('auth.jwt()') AND prorettype='jsonb'::pg_catalog.regtype)
    OR NOT pg_catalog.has_table_privilege(current_user,'auth.users','SELECT') THEN
    RAISE EXCEPTION 'Existing trusted Auth functions and readable account table required';
  END IF;
  IF pg_catalog.to_regnamespace('kingscore_atomic') IS NOT NULL OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('get_play_editor_v1','create_play_v1','update_play_v1','delete_play_v1','import_bga_play_v1')
  ) THEN RAISE EXCEPTION 'RPC V1 namespace already exists; explicit versioned upgrade required'; END IF;
END $compatibility$;

-- Keep the checked data/schema stable through DDL and duplicate checks. No CASCADE locks.
LOCK TABLE ONLY public.plays, ONLY public.play_scores IN ACCESS EXCLUSIVE MODE;
LOCK TABLE ONLY public.games, ONLY public.players IN ACCESS SHARE MODE;

DO $compatibility$
DECLARE required record; attribute record; idx record; tr record; relation oid; target text;
  orphan_trigger boolean := false; index_columns text; constraint_comment text; index_comment text;
BEGIN
  FOR required IN SELECT * FROM (VALUES
    ('public.plays','id','uuid',true,false,false),
    ('public.plays','user_id','uuid',false,false,false),
    ('public.plays','game_id','uuid',false,false,false),
    ('public.plays','played_at','date',true,false,false),
    ('public.plays','duration_minutes','integer',false,true,false),
    ('public.plays','source','text',false,false,false),
    ('public.plays','notes','text',false,true,false),
    ('public.plays','is_cooperative','boolean',false,false,false),
    ('public.plays','team_won','boolean',false,true,false),
    ('public.plays','location','text',false,true,true),
    ('public.plays','bga_table_id','text',false,true,true),
    ('public.plays','created_at','timestamp with time zone',false,false,false),
    ('public.play_scores','id','uuid',true,false,false),
    ('public.play_scores','play_id','uuid',false,false,false),
    ('public.play_scores','player_id','uuid',false,false,false),
    ('public.play_scores','score','numeric',false,true,false),
    ('public.play_scores','winner','boolean',false,false,false),
    ('public.play_scores','position','integer',false,true,false),
    ('public.play_scores','color','text',false,true,true),
    ('public.play_scores','role','text',false,true,true),
    ('public.games','id','uuid',true,false,false),
    ('public.players','id','uuid',true,false,false),
    ('auth.users','id','uuid',true,false,false)
  ) fields(table_name,column_name,type_name,not_null,nullable,additive) LOOP
    SELECT * INTO attribute FROM pg_catalog.pg_attribute
      WHERE attrelid=pg_catalog.to_regclass(required.table_name) AND attname=required.column_name AND attnum>0 AND NOT attisdropped;
    IF NOT FOUND THEN
      IF required.additive THEN CONTINUE; END IF;
      RAISE EXCEPTION 'Required column missing: %.%',required.table_name,required.column_name;
    END IF;
    IF attribute.atttypid<>pg_catalog.to_regtype(required.type_name) OR attribute.atttypmod<>-1
      OR attribute.attgenerated<>'' OR attribute.attidentity<>''
      OR (required.not_null AND NOT attribute.attnotnull) OR (required.nullable AND attribute.attnotnull) THEN
      RAISE EXCEPTION 'Incompatible column: %.%; expected % (no implicit conversion)',required.table_name,required.column_name,required.type_name;
    END IF;
  END LOOP;
  FOREACH target IN ARRAY ARRAY['public.plays','public.play_scores','public.games','public.players','auth.users'] LOOP
    relation:=pg_catalog.to_regclass(target);
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_attribute a
      ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0]
      WHERE i.indrelid=relation AND i.indisprimary AND i.indisvalid AND i.indnkeyatts=1 AND a.attname='id') THEN
      RAISE EXCEPTION 'Single-column id primary key required: %',target;
    END IF;
  END LOOP;
  FOREACH target IN ARRAY ARRAY['public.plays','public.play_scores'] LOOP
    relation:=pg_catalog.to_regclass(target);
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attrdef d JOIN pg_catalog.pg_attribute a
      ON a.attrelid=d.adrelid AND a.attnum=d.adnum
      WHERE d.adrelid=relation AND a.attname='id'
        AND pg_catalog.pg_get_expr(d.adbin,d.adrelid) ~ '^(pg_catalog[.]|extensions[.])?gen_random_uuid\(\)$') THEN
      RAISE EXCEPTION 'Known gen_random_uuid default required: %.id',target;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=relation
      AND a.attnum>0 AND NOT a.attisdropped AND a.attnotnull AND a.attgenerated=''
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attrdef d WHERE d.adrelid=a.attrelid AND d.adnum=a.attnum)
      AND a.attname NOT IN ('id','user_id','game_id','played_at','play_id','player_id','source','is_cooperative','winner')) THEN
      RAISE EXCEPTION 'Extra required column without a default needs explicit review: %',target;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.contype='f' AND c.conrelid='public.play_scores'::pg_catalog.regclass
      AND c.confrelid='public.plays'::pg_catalog.regclass AND c.confdeltype='c' AND c.convalidated
      AND c.conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=c.conrelid AND attname='play_id')]::smallint[]
      AND c.confkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=c.confrelid AND attname='id')]::smallint[]) THEN
    RAISE EXCEPTION 'Validated play_scores.play_id -> plays.id DELETE CASCADE required';
  END IF;

  -- Only the exact known timestamp trigger is repaired. Shared function stays untouched.
  FOR tr IN SELECT t.*, n.nspname, p.proname, p.pronargs, p.prorettype, p.prosecdef,
    p.prosrc, l.lanname, c.relname,
    (SELECT a.atttypid FROM pg_catalog.pg_attribute a WHERE a.attrelid=t.tgrelid AND a.attname='updated_at' AND NOT a.attisdropped) AS timestamp_type
    FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
    JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_catalog.pg_language l ON l.oid=p.prolang
    WHERE t.tgrelid IN ('public.plays'::pg_catalog.regclass,'public.play_scores'::pg_catalog.regclass) AND NOT t.tgisinternal LOOP
    IF tr.tgname<>'update_'||tr.relname||'_updated_at' OR tr.nspname<>'public'
      OR tr.proname<>'update_updated_at_column' OR tr.pronargs<>0 OR tr.prorettype<>'trigger'::pg_catalog.regtype
      OR tr.prosecdef OR tr.lanname<>'plpgsql' OR tr.tgtype<>19 OR tr.tgenabled<>'O'
      OR tr.tgqual IS NOT NULL OR tr.tgnargs<>0 OR tr.tgconstraint<>0
      OR lower(tr.prosrc) !~ $known_body$^[[:space:]]*begin[[:space:]]+new[.]updated_at[[:space:]]*(=|:=)[[:space:]]*(now[(][)]|timezone[(][[:space:]]*'utc'(::text)?[[:space:]]*,[[:space:]]*now[(][)][[:space:]]*[)])[[:space:]]*;[[:space:]]*return[[:space:]]+new[[:space:]]*;[[:space:]]*end[[:space:]]*;[[:space:]]*$known_body$ THEN
      RAISE EXCEPTION 'Unknown trigger profile requires explicit review: %.%',tr.relname,tr.tgname;
    END IF;
    IF tr.timestamp_type IS NULL THEN
      IF tr.relname<>'play_scores' THEN RAISE EXCEPTION 'Only known orphan score trigger can be repaired'; END IF;
      orphan_trigger:=true;
    ELSIF tr.timestamp_type NOT IN ('timestamp with time zone'::pg_catalog.regtype,'timestamp without time zone'::pg_catalog.regtype) THEN
      RAISE EXCEPTION 'Timestamp trigger column has incompatible type: %',tr.relname;
    END IF;
  END LOOP;

  -- Rebuild only ordinary, exact UNIQUE constraints. Reject profiles whose properties would be lost.
  FOR idx IN SELECT i.*, ic.relname AS index_name, ic.reltablespace, ic.reloptions, am.amname,
    co.oid AS constraint_id, co.conname, co.condeferrable, co.conislocal, co.coninhcount,
    ARRAY(SELECT a.attname::text FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum,ord)
      JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum ORDER BY k.ord) AS key_names
    FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class ic ON ic.oid=i.indexrelid
    JOIN pg_catalog.pg_am am ON am.oid=ic.relam
    LEFT JOIN pg_catalog.pg_constraint co ON co.conindid=i.indexrelid AND co.contype='u'
    WHERE i.indrelid='public.play_scores'::pg_catalog.regclass AND i.indisunique AND NOT i.indisprimary LOOP
    IF idx.constraint_id IS NULL OR idx.conname<>idx.index_name OR NOT idx.conislocal OR idx.coninhcount<>0
      OR NOT idx.indisvalid OR NOT idx.indisready OR idx.indpred IS NOT NULL OR idx.indexprs IS NOT NULL
      OR idx.indnkeyatts<>2 OR idx.indnatts<>2 OR idx.key_names NOT IN (ARRAY['play_id','player_id'],ARRAY['player_id','play_id'])
      OR idx.indnullsnotdistinct OR idx.indisclustered OR idx.indisreplident OR idx.amname<>'btree'
      OR idx.reltablespace<>0 OR idx.reloptions IS NOT NULL OR idx.indoption[0]<>0 OR idx.indoption[1]<>0
      OR EXISTS (SELECT 1 FROM unnest(idx.indclass::oid[]) cl(opclass) JOIN pg_catalog.pg_opclass opc ON opc.oid=cl.opclass
        WHERE NOT opc.opcdefault OR opc.opcintype<>'uuid'::pg_catalog.regtype OR opc.opcnamespace<>'pg_catalog'::pg_catalog.regnamespace)
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint fk WHERE fk.contype='f' AND fk.conindid=idx.indexrelid) THEN
      RAISE EXCEPTION 'Unsupported UNIQUE/index profile (or dependent FK): %',idx.index_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.plays'::pg_catalog.regclass
    AND attname='bga_table_id' AND NOT attisdropped) THEN
    IF EXISTS (
      SELECT 1 FROM ONLY public.plays WHERE user_id IS NOT NULL AND bga_table_id IS NOT NULL
      GROUP BY user_id,bga_table_id HAVING count(*)>1
    ) THEN RAISE EXCEPTION 'Existing owner/BGA duplicates require an explicit data decision; no cleanup performed'; END IF;
  END IF;

  -- All compatibility checks above complete before the first schema mutation.
  ALTER TABLE public.plays ADD COLUMN IF NOT EXISTS location text NULL, ADD COLUMN IF NOT EXISTS bga_table_id text NULL;
  ALTER TABLE public.play_scores ADD COLUMN IF NOT EXISTS color text NULL, ADD COLUMN IF NOT EXISTS role text NULL;
  IF orphan_trigger THEN DROP TRIGGER update_play_scores_updated_at ON public.play_scores; END IF;
  FOR idx IN SELECT co.oid AS constraint_id, co.conname, co.conindid,
    ARRAY(SELECT a.attname::text FROM unnest(co.conkey) WITH ORDINALITY k(attnum,ord)
      JOIN pg_catalog.pg_attribute a ON a.attrelid=co.conrelid AND a.attnum=k.attnum ORDER BY k.ord) AS key_names
    FROM pg_catalog.pg_constraint co WHERE co.conrelid='public.play_scores'::pg_catalog.regclass
      AND co.contype='u' AND NOT co.condeferrable LOOP
    constraint_comment:=pg_catalog.obj_description(idx.constraint_id,'pg_constraint');
    index_comment:=pg_catalog.obj_description(idx.conindid,'pg_class');
    SELECT string_agg(pg_catalog.quote_ident(name),',' ORDER BY ord) INTO index_columns
      FROM unnest(idx.key_names) WITH ORDINALITY keys(name,ord);
    EXECUTE pg_catalog.format('ALTER TABLE public.play_scores DROP CONSTRAINT %I, ADD CONSTRAINT %I UNIQUE (%s) DEFERRABLE INITIALLY IMMEDIATE',
      idx.conname,idx.conname,index_columns);
    IF constraint_comment IS NOT NULL THEN EXECUTE pg_catalog.format('COMMENT ON CONSTRAINT %I ON public.play_scores IS %L',idx.conname,constraint_comment); END IF;
    IF index_comment IS NOT NULL THEN EXECUTE pg_catalog.format('COMMENT ON INDEX public.%I IS %L',idx.conname,index_comment); END IF;
  END LOOP;
END $compatibility$;

CREATE SCHEMA kingscore_atomic;
REVOKE ALL ON SCHEMA kingscore_atomic FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE kingscore_atomic.receipts (
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  request jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id,request_id)
);
ALTER TABLE kingscore_atomic.receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON kingscore_atomic.receipts FROM PUBLIC, anon, authenticated, service_role;



CREATE FUNCTION kingscore_atomic.require_admin() RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path='' SET lock_timeout='5s' SET statement_timeout='30s' AS $$
DECLARE actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor) THEN
    RAISE EXCEPTION USING ERRCODE='PT401', MESSAGE='Verified account required';
  END IF;
  IF auth.jwt()->'app_metadata'->>'role' IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Administrator required';
  END IF;
  RETURN actor;
END $$;

CREATE FUNCTION kingscore_atomic.valid_score(value text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' SET lock_timeout='5s' SET statement_timeout='30s' AS $$
DECLARE approximate double precision; exact numeric;
BEGIN
  IF value IS NULL THEN RETURN true; END IF;
  IF value !~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$' THEN RETURN false; END IF;
  approximate := value::double precision;
  IF approximate IN ('Infinity'::double precision,'-Infinity'::double precision,'NaN'::double precision) THEN RETURN false; END IF;
  exact := value::numeric;
  RETURN approximate <> 0 OR exact=0;
EXCEPTION WHEN data_exception THEN RETURN false;
END $$;

CREATE FUNCTION kingscore_atomic.compare_scores(scores jsonb, a integer, b integer) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SET search_path='' SET lock_timeout='5s' SET statement_timeout='30s' AS $$
DECLARE av double precision; bv double precision;
BEGIN
  IF (scores->a->>'winner')::boolean IS DISTINCT FROM (scores->b->>'winner')::boolean THEN
    RETURN CASE WHEN (scores->a->>'winner')::boolean THEN -1 ELSE 1 END;
  END IF;
  IF (scores->a->>'winner')::boolean THEN RETURN 0; END IF;
  IF scores->a->'score'='null'::jsonb OR scores->b->'score'='null'::jsonb THEN RETURN 0; END IF;
  av := (scores->a->>'score')::double precision; bv := (scores->b->>'score')::double precision;
  RETURN CASE WHEN av>bv THEN -1 WHEN av<bv THEN 1 ELSE 0 END;
END $$;

-- For arrays below 64, V8 uses one natural run followed by stable binary insertion.
-- NULL comparison is nontransitive; a SQL ORDER BY or NULLS LAST changes the site rule.
CREATE FUNCTION kingscore_atomic.rank_positions(scores jsonb, cooperative boolean, team boolean) RETURNS integer[]
LANGUAGE plpgsql IMMUTABLE SET search_path='' SET lock_timeout='5s' SET statement_timeout='30s' AS $$
DECLARE n integer:=jsonb_array_length(scores); ordering integer[]; positions integer[];
  run_end integer:=2; descending boolean; pivot integer; lo integer; hi integer; mid integer; i integer; j integer;
BEGIN
  IF n NOT BETWEEN 1 AND 63 THEN RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Participant count outside V1'; END IF;
  IF cooperative AND team IS NOT NULL THEN RETURN array_fill(CASE WHEN team THEN 1 ELSE 2 END,ARRAY[n]); END IF;
  SELECT array_agg(k) INTO ordering FROM generate_series(0,n-1) k;
  positions := array_fill(0,ARRAY[n]);
  IF n>1 THEN
    descending := kingscore_atomic.compare_scores(scores,ordering[2],ordering[1])<0;
    WHILE run_end<n LOOP
      EXIT WHEN CASE WHEN descending THEN kingscore_atomic.compare_scores(scores,ordering[run_end+1],ordering[run_end])>=0
                    ELSE kingscore_atomic.compare_scores(scores,ordering[run_end+1],ordering[run_end])<0 END;
      run_end:=run_end+1;
    END LOOP;
    IF descending THEN
      FOR i IN 1..(run_end/2) LOOP
        pivot:=ordering[i]; ordering[i]:=ordering[run_end+1-i]; ordering[run_end+1-i]:=pivot;
      END LOOP;
    END IF;
    IF run_end<n THEN
      FOR i IN (run_end+1)..n LOOP
        pivot:=ordering[i]; lo:=1; hi:=i;
        WHILE lo<hi LOOP
          mid:=(lo+hi)/2;
          IF kingscore_atomic.compare_scores(scores,pivot,ordering[mid])<0 THEN hi:=mid; ELSE lo:=mid+1; END IF;
        END LOOP;
        j:=i;
        WHILE j>lo LOOP ordering[j]:=ordering[j-1]; j:=j-1; END LOOP;
        ordering[lo]:=pivot;
      END LOOP;
    END IF;
  END IF;
  FOR i IN 1..n LOOP positions[ordering[i]+1]:=CASE WHEN (scores->ordering[i]->>'winner')::boolean THEN 1 ELSE i END; END LOOP;
  RETURN positions;
END $$;

CREATE FUNCTION kingscore_atomic.validate_input(payload jsonb, creating boolean, play_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path='' SET lock_timeout='5s' SET statement_timeout='30s' AS $$
DECLARE item jsonb; item_id uuid; player uuid; game uuid; day date; duration numeric;
  players uuid[]:='{}'; ids uuid[]:='{}';
  keys text[]:=ARRAY['game_id','played_at','duration_minutes','source','notes','is_cooperative','team_won','scores'];
BEGIN
  IF payload IS NULL OR jsonb_typeof(payload)<>'object' THEN RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Payload object required'; END IF;
  IF octet_length(payload::text)>1048576 OR NOT payload ?& keys OR
     (SELECT count(*) FROM jsonb_object_keys(payload))<>cardinality(keys) THEN
    RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Invalid payload fields or bytes';
  END IF;
  IF jsonb_typeof(payload->'game_id')<>'string' OR jsonb_typeof(payload->'played_at')<>'string' OR
     payload->>'played_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR left(payload->>'played_at',4)='0000' OR
     jsonb_typeof(payload->'source')<>'string' OR payload->>'source' NOT IN ('offline','online') OR
     jsonb_typeof(payload->'notes') NOT IN ('string','null') OR jsonb_typeof(payload->'is_cooperative')<>'boolean' OR
     jsonb_typeof(payload->'team_won') NOT IN ('boolean','null') OR jsonb_typeof(payload->'scores')<>'array' THEN
    RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Invalid field types';
  END IF;
  game:=(payload->>'game_id')::uuid; day:=(payload->>'played_at')::date;
  IF payload->>'game_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Canonical game UUID required';
  END IF;
  IF extract(year FROM day) NOT BETWEEN 1 AND 9999 THEN RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Date outside V1'; END IF;
  PERFORM 1 FROM public.games WHERE id=game FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Game does not exist'; END IF;
  IF payload->'duration_minutes'<>'null'::jsonb THEN
    IF jsonb_typeof(payload->'duration_minutes')<>'number' THEN RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Integer duration required'; END IF;
    duration:=(payload->>'duration_minutes')::numeric;
    IF duration<>trunc(duration) OR duration NOT BETWEEN 0 AND 2147483647 THEN RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Invalid duration'; END IF;
  END IF;
  IF NOT (payload->>'is_cooperative')::boolean AND payload->'team_won'<>'null'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Competitive team outcome forbidden';
  END IF;
  IF jsonb_array_length(payload->'scores') NOT BETWEEN 1 AND 63 THEN RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Invalid participant count'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(payload->'scores') LOOP
    IF jsonb_typeof(item)<>'object' OR NOT item ?& ARRAY['id','player_id','score','winner','color','role'] OR
       (SELECT count(*) FROM jsonb_object_keys(item))<>6 OR
       jsonb_typeof(item->'id') NOT IN ('null','string') OR jsonb_typeof(item->'player_id')<>'string' OR
       jsonb_typeof(item->'score') NOT IN ('null','string') OR jsonb_typeof(item->'winner')<>'boolean' OR
       jsonb_typeof(item->'color') NOT IN ('null','string') OR jsonb_typeof(item->'role') NOT IN ('null','string') THEN
      RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Invalid score fields';
    END IF;
    player:=(item->>'player_id')::uuid; item_id:=(item->>'id')::uuid;
    IF item->>'player_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
       (item_id IS NOT NULL AND item->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
      RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Canonical participant UUID required';
    END IF;
    IF player=ANY(players) OR (item_id IS NOT NULL AND item_id=ANY(ids)) OR (creating AND item_id IS NOT NULL) THEN
      RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Duplicate participant or invalid score ID';
    END IF;
    players:=array_append(players,player); ids:=array_append(ids,item_id);
    IF item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.play_scores s WHERE s.id=item_id AND s.play_id=validate_input.play_id) THEN
      RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Score belongs to another play';
    END IF;
    IF NOT creating AND item_id IS NULL AND EXISTS(SELECT 1 FROM public.play_scores s WHERE s.play_id=validate_input.play_id AND s.player_id=player) THEN
      RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Existing participant requires its score ID';
    END IF;
    IF NOT kingscore_atomic.valid_score(item->>'score') THEN RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Invalid exact score'; END IF;
    IF (payload->>'is_cooperative')::boolean AND payload->'team_won'<>'null'::jsonb AND item->'winner'<>payload->'team_won' THEN
      RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Cooperative result inconsistent';
    END IF;
  END LOOP;
  FOR player IN SELECT value FROM unnest(players) value ORDER BY value LOOP
    PERFORM 1 FROM public.players WHERE id=player FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Player does not exist'; END IF;
  END LOOP;
EXCEPTION WHEN data_exception THEN RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Invalid value representation';
END $$;

CREATE FUNCTION kingscore_atomic.editability(play_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' SET lock_timeout='5s' SET statement_timeout='30s' AS $$
DECLARE p public.plays; issues text[]:='{}'; n integer;
BEGIN
  SELECT * INTO p FROM public.plays WHERE id=play_id;
  IF p.source IS NULL OR p.source NOT IN ('offline','online') THEN issues:=array_append(issues,'source-not-supported'); END IF;
  IF p.game_id IS NULL THEN issues:=array_append(issues,'missing-game'); END IF;
  IF p.is_cooperative IS NULL THEN issues:=array_append(issues,'nullable-mode'); END IF;
  IF extract(year FROM p.played_at) NOT BETWEEN 1 AND 9999 THEN issues:=array_append(issues,'date-outside-V1'); END IF;
  IF p.duration_minutes<0 THEN issues:=array_append(issues,'negative-duration'); END IF;
  IF (NOT p.is_cooperative AND p.team_won IS NOT NULL) OR
     (p.is_cooperative AND p.team_won IS NOT NULL AND EXISTS(SELECT 1 FROM public.play_scores s
       WHERE s.play_id=editability.play_id AND s.winner IS DISTINCT FROM p.team_won)) THEN
    issues:=array_append(issues,'inconsistent-team-outcome');
  END IF;
  SELECT count(*) INTO n FROM public.play_scores s WHERE s.play_id=editability.play_id;
  IF n NOT BETWEEN 1 AND 63 THEN issues:=array_append(issues,'participant-count'); END IF;
  IF EXISTS(SELECT 1 FROM public.play_scores s WHERE s.play_id=editability.play_id AND s.winner IS NULL) THEN issues:=array_append(issues,'nullable-winner'); END IF;
  IF EXISTS(SELECT 1 FROM public.play_scores s WHERE s.play_id=editability.play_id AND s.player_id IS NULL) THEN issues:=array_append(issues,'missing-player'); END IF;
  IF EXISTS(SELECT player_id FROM public.play_scores s WHERE s.play_id=editability.play_id GROUP BY player_id HAVING count(*)>1) THEN issues:=array_append(issues,'duplicate-player'); END IF;
  IF EXISTS(SELECT 1 FROM public.play_scores s WHERE s.play_id=editability.play_id AND NOT kingscore_atomic.valid_score(s.score::text)) THEN issues:=array_append(issues,'score-outside-V1'); END IF;
  RETURN jsonb_build_object('editable',cardinality(issues)=0,'issues',to_jsonb(issues));
END $$;

CREATE FUNCTION kingscore_atomic.snapshot(play_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' SET lock_timeout='5s' SET statement_timeout='30s' SET timezone='UTC' AS $$
  SELECT jsonb_build_object(
    'detail',jsonb_build_object('play',to_jsonb(p),
      'game',(SELECT to_jsonb(g) FROM public.games g WHERE g.id=p.game_id),
      'scores',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'score',to_jsonb(s)||jsonb_build_object('score',s.score::text),
        'player',(SELECT to_jsonb(pl) FROM public.players pl WHERE pl.id=s.player_id))
        ORDER BY s.position NULLS LAST,s.id) FROM public.play_scores s WHERE s.play_id=p.id),'[]'::jsonb)),
    'revision','v1:'||encode(sha256(convert_to(jsonb_build_object('play',to_jsonb(p),'scores',COALESCE(
      (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.play_scores s WHERE s.play_id=p.id),'[]'::jsonb))::text,'UTF8')),'hex'),
    'editability',kingscore_atomic.editability(p.id))
  FROM public.plays p WHERE p.id=play_id;
$$;

CREATE FUNCTION kingscore_atomic.write_scores(play_id uuid, payload jsonb, positions integer[], preserve boolean)
RETURNS void LANGUAGE plpgsql SET search_path='' SET lock_timeout='5s' SET statement_timeout='30s' AS $$
DECLARE keep uuid[];
BEGIN
  SELECT COALESCE(array_agg((value->>'id')::uuid) FILTER(WHERE value->>'id' IS NOT NULL),'{}'::uuid[])
    INTO keep FROM jsonb_array_elements(payload->'scores');
  DELETE FROM public.play_scores s WHERE s.play_id=write_scores.play_id AND NOT s.id=ANY(keep);
  -- Supported UNIQUE participant constraints are DEFERRABLE: validate this bulk statement's final state.
  UPDATE public.play_scores s SET player_id=(input.value->>'player_id')::uuid,
    score=(input.value->>'score')::numeric,winner=(input.value->>'winner')::boolean,
    color=input.value->>'color',role=input.value->>'role',
    position=CASE WHEN preserve THEN s.position ELSE positions[input.ordinal::integer] END
  FROM jsonb_array_elements(payload->'scores') WITH ORDINALITY input(value,ordinal)
  WHERE s.play_id=write_scores.play_id AND s.id=(input.value->>'id')::uuid;
  INSERT INTO public.play_scores(play_id,player_id,score,winner,color,role,position)
  SELECT write_scores.play_id,(input.value->>'player_id')::uuid,(input.value->>'score')::numeric,
    (input.value->>'winner')::boolean,input.value->>'color',input.value->>'role',positions[input.ordinal::integer]
  FROM jsonb_array_elements(payload->'scores') WITH ORDINALITY input(value,ordinal)
  WHERE input.value->>'id' IS NULL;
END $$;
CREATE FUNCTION kingscore_atomic.mutate(operation text, request_id uuid, play_id uuid, expected_revision text,
  payload jsonb, metadata jsonb DEFAULT NULL, external_positions jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' SET lock_timeout='5s' SET statement_timeout='30s' SET timezone='UTC' AS $$
DECLARE actor uuid:=kingscore_atomic.require_admin(); request jsonb; previous kingscore_atomic.receipts;
  target uuid:=play_id; result jsonb; snapshot jsonb; positions integer[]; preserve boolean:=false; table_id text;
BEGIN
  IF request_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Request ID required'; END IF;
  IF operation NOT IN ('create','update','delete','import') THEN RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Unknown operation'; END IF;
  request:=jsonb_build_object('operation',operation,'play_id',play_id,'revision',expected_revision,
    'payload',payload,'metadata',metadata,'positions',external_positions);
  PERFORM pg_advisory_xact_lock(hashtextextended('request:'||actor::text||':'||request_id::text,0));
  SELECT * INTO previous FROM kingscore_atomic.receipts r WHERE r.actor_id=actor AND r.request_id=mutate.request_id;
  IF FOUND THEN
    IF previous.request IS DISTINCT FROM request THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Request ID reused with different content'; END IF;
    RETURN previous.result||jsonb_build_object('replayed',true);
  END IF;
  IF operation IN ('update','delete') THEN
    IF target IS NULL OR expected_revision IS NULL OR length(expected_revision) NOT BETWEEN 1 AND 160 OR expected_revision !~ '^[!-~]+$' THEN
      RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Target and opaque revision required';
    END IF;
    PERFORM 1 FROM public.plays p WHERE p.id=target FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PT404',MESSAGE='Play not found'; END IF;
    PERFORM 1 FROM public.play_scores s WHERE s.play_id=target ORDER BY s.id FOR UPDATE;
    snapshot:=kingscore_atomic.snapshot(target);
    IF snapshot->>'revision'<>expected_revision THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Play changed since snapshot'; END IF;
    IF operation='update' AND NOT (snapshot->'editability'->>'editable')::boolean THEN
      RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Legacy values require an explicit editor decision';
    END IF;
  END IF;
  IF operation='import' THEN
    IF metadata IS NULL OR jsonb_typeof(metadata)<>'object' OR NOT metadata ?& ARRAY['location','bga_table_id'] OR
       (SELECT count(*) FROM jsonb_object_keys(metadata))<>2 OR octet_length(metadata::text)>1048576 OR
       jsonb_typeof(metadata->'location') NOT IN ('string','null') OR jsonb_typeof(metadata->'bga_table_id')<>'string' THEN
      RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Invalid import metadata';
    END IF;
    table_id:=metadata->>'bga_table_id';
    IF char_length(table_id) NOT BETWEEN 1 AND 256 OR
       table_id ~ E'[\\t\\n\\v\\f\\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' THEN
      RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Invalid BGA table ID';
    END IF;
    IF external_positions IS NULL OR jsonb_typeof(external_positions)<>'array' OR
       jsonb_typeof(payload->'scores') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Import positions required';
    END IF;
    IF jsonb_array_length(external_positions)<>jsonb_array_length(payload->'scores') OR
       EXISTS(SELECT 1 FROM jsonb_array_elements(external_positions) v WHERE v<>'null'::jsonb AND
         (jsonb_typeof(v)<>'number' OR (v::text)::numeric<>trunc((v::text)::numeric) OR (v::text)::numeric NOT BETWEEN 1 AND 2147483647)) THEN
      RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Invalid import positions';
    END IF;
    PERFORM kingscore_atomic.validate_input(payload,true,NULL);
    PERFORM pg_advisory_xact_lock(hashtextextended('bga:'||actor::text||':'||table_id,0));
    BEGIN
      SELECT p.id INTO STRICT target FROM public.plays p WHERE p.user_id=actor AND p.bga_table_id=table_id ORDER BY p.id FOR UPDATE;
    EXCEPTION
      WHEN no_data_found THEN target:=NULL;
      WHEN too_many_rows THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Ambiguous existing BGA imports';
    END;
    IF target IS NOT NULL THEN
      PERFORM 1 FROM public.play_scores s WHERE s.play_id=target ORDER BY s.id FOR UPDATE;
      snapshot:=kingscore_atomic.snapshot(target);
      result:=jsonb_build_object('play_id',target,'revision',snapshot->>'revision','replayed',false,'skipped',true);
      INSERT INTO kingscore_atomic.receipts VALUES(actor,request_id,request,result,now());
      RETURN result;
    END IF;
  END IF;
  IF operation IN ('create','update','import') THEN
    IF operation<>'import' THEN PERFORM kingscore_atomic.validate_input(payload,operation<>'update',target); END IF;
    IF operation='update' THEN
      preserve:=snapshot->'detail'->'play'->'is_cooperative' IS NOT DISTINCT FROM payload->'is_cooperative'
        AND snapshot->'detail'->'play'->'team_won' IS NOT DISTINCT FROM payload->'team_won'
        AND (SELECT count(*) FROM public.play_scores s WHERE s.play_id=target)=jsonb_array_length(payload->'scores')
        AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'scores') v LEFT JOIN public.play_scores s
          ON s.id=(v->>'id')::uuid AND s.play_id=target
          WHERE s.id IS NULL OR s.player_id IS DISTINCT FROM (v->>'player_id')::uuid OR
            s.score IS DISTINCT FROM (v->>'score')::numeric OR s.winner IS DISTINCT FROM (v->>'winner')::boolean);
      UPDATE public.plays SET game_id=(payload->>'game_id')::uuid,played_at=(payload->>'played_at')::date,
        duration_minutes=(payload->>'duration_minutes')::numeric::integer,source=payload->>'source',notes=payload->>'notes',
        is_cooperative=(payload->>'is_cooperative')::boolean,team_won=(payload->>'team_won')::boolean WHERE id=target;
    ELSE
      INSERT INTO public.plays(user_id,game_id,played_at,duration_minutes,source,notes,is_cooperative,team_won,location,bga_table_id)
      VALUES(actor,(payload->>'game_id')::uuid,(payload->>'played_at')::date,(payload->>'duration_minutes')::numeric::integer,
        payload->>'source',payload->>'notes',(payload->>'is_cooperative')::boolean,(payload->>'team_won')::boolean,
        metadata->>'location',table_id) RETURNING id INTO target;
    END IF;
    IF operation='import' THEN
      SELECT array_agg(CASE WHEN value='null'::jsonb THEN NULL ELSE value::text::numeric::integer END ORDER BY ordinality)
        INTO positions FROM jsonb_array_elements(external_positions) WITH ORDINALITY;
    ELSE positions:=kingscore_atomic.rank_positions(payload->'scores',(payload->>'is_cooperative')::boolean,(payload->>'team_won')::boolean);
    END IF;
    PERFORM kingscore_atomic.write_scores(target,payload,positions,preserve);
    snapshot:=kingscore_atomic.snapshot(target);
    result:=jsonb_build_object('play_id',target,'revision',snapshot->>'revision','replayed',false);
    IF operation='import' THEN result:=result||jsonb_build_object('skipped',false); END IF;
  ELSE
    DELETE FROM public.plays WHERE id=target;
    result:=jsonb_build_object('play_id',target,'deleted',true,'replayed',false);
  END IF;
  INSERT INTO kingscore_atomic.receipts VALUES(actor,request_id,request,result,now());
  RETURN result;
EXCEPTION WHEN data_exception OR foreign_key_violation OR check_violation OR not_null_violation THEN
  RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Invalid values or missing referenced data';
END $$;

CREATE FUNCTION public.get_play_editor_v1(p_play_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path='' SET lock_timeout='5s' SET statement_timeout='30s' SET timezone='UTC' AS $$
DECLARE snapshot jsonb;
BEGIN
  PERFORM kingscore_atomic.require_admin();
  IF p_play_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Play ID required'; END IF;
  snapshot:=kingscore_atomic.snapshot(p_play_id);
  IF snapshot IS NULL THEN RAISE EXCEPTION USING ERRCODE='PT404',MESSAGE='Play not found'; END IF;
  RETURN snapshot;
END $$;
CREATE FUNCTION public.create_play_v1(p_request_id uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' SET statement_timeout='30s' AS $$ SELECT kingscore_atomic.mutate('create',p_request_id,NULL,NULL,p_payload) $$;
CREATE FUNCTION public.update_play_v1(p_request_id uuid,p_play_id uuid,p_expected_revision text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' SET statement_timeout='30s' AS $$ SELECT kingscore_atomic.mutate('update',p_request_id,p_play_id,p_expected_revision,p_payload) $$;
CREATE FUNCTION public.delete_play_v1(p_request_id uuid,p_play_id uuid,p_expected_revision text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' SET statement_timeout='30s' AS $$ SELECT kingscore_atomic.mutate('delete',p_request_id,p_play_id,p_expected_revision,NULL) $$;
CREATE FUNCTION public.import_bga_play_v1(p_request_id uuid,p_payload jsonb,p_metadata jsonb,p_positions jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' SET statement_timeout='30s' AS $$ SELECT kingscore_atomic.mutate('import',p_request_id,NULL,NULL,p_payload,p_metadata,p_positions) $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA kingscore_atomic FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_play_editor_v1(uuid),public.create_play_v1(uuid,jsonb),
  public.update_play_v1(uuid,uuid,text,jsonb),public.delete_play_v1(uuid,uuid,text),public.import_bga_play_v1(uuid,jsonb,jsonb,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_play_editor_v1(uuid),public.create_play_v1(uuid,jsonb),
  public.update_play_v1(uuid,uuid,text,jsonb),public.delete_play_v1(uuid,uuid,text),public.import_bga_play_v1(uuid,jsonb,jsonb,jsonb) TO authenticated;
COMMIT;
