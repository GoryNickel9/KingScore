-- Install after 01; backfill/verify elo_ordinal BEFORE enabling the worker.
-- Does not backfill order, calculate ratings, retire legacy writers or schedule jobs.
BEGIN;
SET LOCAL search_path = '';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
DO $preflight$
DECLARE target text; owner_oid oid;
BEGIN
  SELECT oid INTO owner_oid FROM pg_catalog.pg_roles WHERE rolname=current_user
    AND (rolsuper OR rolbypassrls) AND rolname NOT IN ('anon','authenticated','service_role','authenticator');
  IF owner_oid IS NULL OR pg_catalog.to_regnamespace('kingscore_atomic') IS NULL THEN
    RAISE EXCEPTION 'Trusted migration owner and installed atomic-play RPCs required';
  END IF;
  FOREACH target IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=target)
      OR pg_catalog.pg_has_role(target,current_user,'MEMBER') THEN
      RAISE EXCEPTION 'Existing isolated client role required: %',target;
    END IF;
  END LOOP;
  FOREACH target IN ARRAY ARRAY['public.games','public.players','public.plays','public.play_scores'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid=pg_catalog.to_regclass(target)
      AND relkind='r' AND relowner=owner_oid) THEN
      RAISE EXCEPTION 'Migration owner must own ordinary source table: %',target;
    END IF;
  END LOOP;
  IF pg_catalog.to_regnamespace('kingscore_elo') IS NOT NULL OR EXISTS(
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('get_elo_publication_v1','get_elo_source_v1','publish_elo_v1')) THEN
    RAISE EXCEPTION 'ELO V1 already installed; explicit upgrade required';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.play_scores'::regclass
    AND attname='elo_ordinal' AND NOT attisdropped AND
      (atttypid<>'integer'::regtype OR attgenerated<>'' OR attidentity<>'')) THEN
    RAISE EXCEPTION 'elo_ordinal must be an ordinary integer column';
  END IF;
END $preflight$;
LOCK TABLE public.games, public.players, public.plays, public.play_scores IN ACCESS EXCLUSIVE MODE;
ALTER TABLE public.play_scores ADD COLUMN IF NOT EXISTS elo_ordinal integer;
CREATE SCHEMA kingscore_elo;
REVOKE ALL ON SCHEMA kingscore_elo FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE kingscore_elo.source_clock (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0)
);
INSERT INTO kingscore_elo.source_clock(singleton) VALUES(true);
CREATE TABLE kingscore_elo.publications (
  publication_id uuid PRIMARY KEY,
  source_revision bigint NOT NULL CHECK(source_revision>=0),
  payload jsonb NOT NULL
);
CREATE TABLE kingscore_elo.head (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  publication_id uuid NOT NULL REFERENCES kingscore_elo.publications(publication_id)
);
ALTER TABLE kingscore_elo.source_clock ENABLE ROW LEVEL SECURITY;
ALTER TABLE kingscore_elo.publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE kingscore_elo.head ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA kingscore_elo FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION kingscore_elo.require_worker() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ELO worker service role required';
  END IF;
END $$;

CREATE FUNCTION kingscore_elo.mark_dirty() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  -- All atomic-play RPCs acquire this advisory lock BEFORE parent/score locks.
  -- Catalog cascades take it before their first row lock as well.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kingscore:elo-source-v1',0));
  UPDATE kingscore_elo.source_clock SET revision=revision+1 WHERE singleton;
  RETURN NULL;
END $$;
CREATE TRIGGER kingscore_elo_dirty_games BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.games
  FOR EACH STATEMENT EXECUTE FUNCTION kingscore_elo.mark_dirty();
CREATE TRIGGER kingscore_elo_dirty_players BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.players
  FOR EACH STATEMENT EXECUTE FUNCTION kingscore_elo.mark_dirty();
CREATE TRIGGER kingscore_elo_dirty_plays BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.plays
  FOR EACH STATEMENT EXECUTE FUNCTION kingscore_elo.mark_dirty();
CREATE TRIGGER kingscore_elo_dirty_scores BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.play_scores
  FOR EACH STATEMENT EXECUTE FUNCTION kingscore_elo.mark_dirty();

CREATE FUNCTION public.get_elo_source_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE snapshot jsonb; invalid_order boolean;
BEGIN
  PERFORM kingscore_elo.require_worker();
  -- One statement/snapshot covers validation, revision and all source rows.
  SELECT EXISTS(SELECT 1 FROM public.play_scores GROUP BY play_id
      HAVING count(*) FILTER(WHERE elo_ordinal IS NULL OR elo_ordinal<0)>0
         OR count(DISTINCT elo_ordinal)<>count(*)),
    pg_catalog.jsonb_build_object('scopeId','global','sourceRevision',clock.revision::text,
      'plays',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',p.id::text,'game_id',p.game_id::text,'played_at',pg_catalog.to_char(p.played_at,'YYYY-MM-DD'),
        'play_scores',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'player_id',s.player_id::text,'score',s.score,'winner',s.winner,
          'draw',pg_catalog.to_jsonb(s)->'draw','position',s.position,
          'players',pg_catalog.jsonb_build_object('name',player.name,'alias',player.alias)
        ) ORDER BY s.elo_ordinal) FROM public.play_scores s
          LEFT JOIN public.players player ON player.id=s.player_id WHERE s.play_id=p.id),'[]'::jsonb)
      ) ORDER BY p.played_at,p.id) FROM public.plays p),'[]'::jsonb))
    INTO invalid_order,snapshot FROM kingscore_elo.source_clock clock WHERE singleton;
  IF invalid_order THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ELO participant order is missing, negative or duplicated; backfill and verify before activation';
  END IF;
  RETURN snapshot;
END $$;

CREATE FUNCTION public.publish_elo_v1(p_publication jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE new_id uuid; requested_revision bigint; live_revision bigint; prior_body jsonb; output jsonb;
BEGIN
  PERFORM kingscore_elo.require_worker();
  IF pg_catalog.jsonb_typeof(p_publication) IS DISTINCT FROM 'object'
    OR (SELECT array_agg(key ORDER BY key) FROM pg_catalog.jsonb_object_keys(p_publication) key)
      IS DISTINCT FROM ARRAY['algorithm','publicationId','result','scopeId','sourceRevision']::text[]
    OR p_publication->>'scopeId' IS DISTINCT FROM 'global'
    OR p_publication->>'algorithm' IS DISTINCT FROM 'kingscore-elo-legacy-v1'
    OR pg_catalog.jsonb_typeof(p_publication->'publicationId') IS DISTINCT FROM 'string'
    OR p_publication->>'publicationId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR pg_catalog.jsonb_typeof(p_publication->'sourceRevision') IS DISTINCT FROM 'string'
    OR p_publication->>'sourceRevision' !~ '^(0|[1-9][0-9]*)$'
    OR length(p_publication->>'sourceRevision')>19
    OR (length(p_publication->>'sourceRevision')=19 AND p_publication->>'sourceRevision'>'9223372036854775807') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid global ELO publication envelope';
  END IF;
  new_id:=(p_publication->>'publicationId')::uuid;
  requested_revision:=(p_publication->>'sourceRevision')::bigint;
  output:=p_publication->'result';
  IF pg_catalog.jsonb_typeof(output) IS DISTINCT FROM 'object'
    OR (SELECT array_agg(key ORDER BY key) FROM pg_catalog.jsonb_object_keys(output) key)
      IS DISTINCT FROM ARRAY['gameHistory','gamePlayers','generalHistory','generalPlayers','processedPlays','skippedPlays']::text[]
    OR pg_catalog.jsonb_typeof(output->'gamePlayers') IS DISTINCT FROM 'object'
    OR pg_catalog.jsonb_typeof(output->'generalPlayers') IS DISTINCT FROM 'object'
    OR pg_catalog.jsonb_typeof(output->'gameHistory') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_typeof(output->'generalHistory') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_typeof(output->'processedPlays') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(output->'skippedPlays') IS DISTINCT FROM 'number'
    OR output->>'processedPlays' !~ '^(0|[1-9][0-9]*)$'
    OR output->>'skippedPlays' !~ '^(0|[1-9][0-9]*)$' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid complete ELO output';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kingscore:elo-source-v1',0));
  SELECT revision INTO STRICT live_revision FROM kingscore_elo.source_clock WHERE singleton FOR UPDATE;
  SELECT payload INTO prior_body FROM kingscore_elo.publications WHERE publication_id=new_id;
  IF FOUND THEN
    IF prior_body IS DISTINCT FROM p_publication THEN
      RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Publication ID reused with different payload';
    END IF;
    -- A replay after newer edits/publications never moves the head backwards.
    RETURN pg_catalog.jsonb_build_object('publicationId',new_id::text,'scopeId','global',
      'sourceRevision',requested_revision::text,'replayed',true);
  END IF;
  IF live_revision<>requested_revision THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='ELO source changed; recompute a fresh snapshot';
  END IF;
  INSERT INTO kingscore_elo.publications(publication_id,source_revision,payload)
    VALUES(new_id,requested_revision,p_publication);
  INSERT INTO kingscore_elo.head(singleton,publication_id) VALUES(true,new_id)
    ON CONFLICT(singleton) DO UPDATE SET publication_id=EXCLUDED.publication_id;
  RETURN pg_catalog.jsonb_build_object('publicationId',new_id::text,'scopeId','global',
    'sourceRevision',requested_revision::text,'replayed',false);
END $$;

CREATE FUNCTION public.get_elo_publication_v1() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT pg_catalog.jsonb_build_object('scopeId','global','algorithm',publication.payload->>'algorithm',
    'status',CASE WHEN publication.publication_id IS NULL THEN 'missing'
      WHEN publication.source_revision<>clock.revision THEN 'stale' ELSE 'current' END,
    'sourceRevision',clock.revision::text,'publishedRevision',publication.source_revision::text,
    'publicationId',publication.publication_id::text,
    'result',CASE WHEN publication.source_revision=clock.revision THEN publication.payload->'result' ELSE NULL END)
  FROM kingscore_elo.source_clock clock
  LEFT JOIN kingscore_elo.head head ON head.singleton
  LEFT JOIN kingscore_elo.publications publication ON publication.publication_id=head.publication_id
  WHERE clock.singleton;
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA kingscore_elo FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_elo_source_v1(),public.publish_elo_v1(jsonb),public.get_elo_publication_v1()
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_elo_publication_v1() TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_elo_source_v1(),public.publish_elo_v1(jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
