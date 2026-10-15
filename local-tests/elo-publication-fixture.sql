-- PC-only prototype. Not a Supabase migration and not an Auth/RLS model.
-- Every DDL below is in the transaction guarded before its first statement.
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'kingscore_elo_local_tests'
     OR current_setting('kingscore.local_test', true) IS DISTINCT FROM 'elo-publication-v1'
     OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN
    RAISE EXCEPTION 'ELO fixture requires its disposable loopback database and explicit local marker';
  END IF;
END;
$$;

CREATE ROLE local_elo_worker NOLOGIN;
CREATE ROLE local_elo_reader NOLOGIN;
CREATE ROLE local_elo_writer NOLOGIN;
CREATE SCHEMA elo_local;
REVOKE ALL ON SCHEMA elo_local FROM PUBLIC;

CREATE TABLE public.games (id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE public.players (id uuid PRIMARY KEY, name text NOT NULL, alias text);
CREATE TABLE public.plays (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  game_id uuid REFERENCES public.games(id) ON DELETE CASCADE,
  played_at date NOT NULL,
  notes text,
  is_cooperative boolean,
  team_won boolean
);
CREATE TABLE public.play_scores (
  id uuid PRIMARY KEY,
  play_id uuid NOT NULL REFERENCES public.plays(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  score numeric,
  winner boolean,
  draw boolean,
  position integer,
  -- Explicit SYNTHETIC input order. Does not assert production has this column.
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  UNIQUE (play_id, ordinal),
  UNIQUE (play_id, player_id)
);

CREATE TABLE elo_local.source_clock (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
INSERT INTO elo_local.source_clock(singleton) VALUES (true);
CREATE TABLE elo_local.publications (
  publication_id uuid PRIMARY KEY,
  scope_id uuid NOT NULL,
  source_revision bigint NOT NULL CHECK (source_revision >= 0),
  payload jsonb NOT NULL
);
CREATE TABLE elo_local.heads (
  scope_id uuid PRIMARY KEY,
  publication_id uuid NOT NULL REFERENCES elo_local.publications(publication_id)
);

CREATE FUNCTION elo_local.mark_dirty() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE elo_local.source_clock SET revision = revision + 1 WHERE singleton;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION elo_local.mark_dirty() FROM PUBLIC;
CREATE TRIGGER elo_dirty_games BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.games
  FOR EACH STATEMENT EXECUTE FUNCTION elo_local.mark_dirty();
CREATE TRIGGER elo_dirty_players BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.players
  FOR EACH STATEMENT EXECUTE FUNCTION elo_local.mark_dirty();
CREATE TRIGGER elo_dirty_plays BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.plays
  FOR EACH STATEMENT EXECUTE FUNCTION elo_local.mark_dirty();
CREATE TRIGGER elo_dirty_scores BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.play_scores
  FOR EACH STATEMENT EXECUTE FUNCTION elo_local.mark_dirty();

CREATE FUNCTION elo_local.snapshot(owner_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'scopeId', owner_id::text,
    'sourceRevision', clock.revision::text,
    'plays', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id::text, 'game_id', p.game_id::text,
        'played_at', to_char(p.played_at, 'YYYY-MM-DD'),
        'play_scores', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'player_id', s.player_id::text, 'score', s.score,
            'winner', s.winner, 'draw', s.draw, 'position', s.position,
            'players', jsonb_build_object('name', player.name, 'alias', player.alias)
          ) ORDER BY s.ordinal)
          FROM public.play_scores s
          JOIN public.players player ON player.id = s.player_id
          WHERE s.play_id = p.id
        ), '[]'::jsonb)
      ) ORDER BY p.played_at, p.id)
      FROM public.plays p WHERE p.user_id = owner_id
    ), '[]'::jsonb)
  )
  FROM elo_local.source_clock clock WHERE singleton;
$$;
REVOKE ALL ON FUNCTION elo_local.snapshot(uuid) FROM PUBLIC;

CREATE FUNCTION elo_local.publish(body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  new_id uuid;
  owner_id uuid;
  requested_revision bigint;
  live_revision bigint;
  prior_body jsonb;
  output jsonb;
BEGIN
  IF jsonb_typeof(body) IS DISTINCT FROM 'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(body) key)
        IS DISTINCT FROM ARRAY['algorithm','publicationId','result','scopeId','sourceRevision']::text[]
     OR jsonb_typeof(body->'publicationId') IS DISTINCT FROM 'string'
     OR jsonb_typeof(body->'scopeId') IS DISTINCT FROM 'string'
     OR jsonb_typeof(body->'sourceRevision') IS DISTINCT FROM 'string'
     OR body->>'sourceRevision' !~ '^(0|[1-9][0-9]*)$'
     OR body->>'algorithm' IS DISTINCT FROM 'kingscore-elo-legacy-v1' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid publication envelope';
  END IF;
  new_id := (body->>'publicationId')::uuid;
  owner_id := (body->>'scopeId')::uuid;
  requested_revision := (body->>'sourceRevision')::bigint;
  output := body->'result';
  IF jsonb_typeof(output) IS DISTINCT FROM 'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(output) key)
        IS DISTINCT FROM ARRAY['gameHistory','gamePlayers','generalHistory','generalPlayers','processedPlays','skippedPlays']::text[]
     OR jsonb_typeof(output->'gamePlayers') IS DISTINCT FROM 'object'
     OR jsonb_typeof(output->'generalPlayers') IS DISTINCT FROM 'object'
     OR jsonb_typeof(output->'gameHistory') IS DISTINCT FROM 'array'
     OR jsonb_typeof(output->'generalHistory') IS DISTINCT FROM 'array'
     OR jsonb_typeof(output->'processedPlays') IS DISTINCT FROM 'number'
     OR jsonb_typeof(output->'skippedPlays') IS DISTINCT FROM 'number'
     OR output->>'processedPlays' !~ '^(0|[1-9][0-9]*)$'
     OR output->>'skippedPlays' !~ '^(0|[1-9][0-9]*)$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid complete simulation output';
  END IF;
  -- Same lock serializes publication with *every* source writer. No staging rows.
  SELECT revision INTO STRICT live_revision FROM elo_local.source_clock
    WHERE singleton FOR UPDATE;
  SELECT payload INTO prior_body FROM elo_local.publications WHERE publication_id = new_id;
  IF FOUND THEN
    IF prior_body IS DISTINCT FROM body THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Publication ID reused with different payload';
    END IF;
    -- Receipt replay never rewinds the head, even after subsequent source edits.
    RETURN jsonb_build_object('publicationId', new_id::text, 'scopeId', owner_id::text,
      'sourceRevision', requested_revision::text, 'replayed', true);
  END IF;
  IF live_revision <> requested_revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Source changed; take a fresh snapshot and recompute';
  END IF;
  INSERT INTO elo_local.publications(publication_id, scope_id, source_revision, payload)
    VALUES (new_id, owner_id, requested_revision, body);
  INSERT INTO elo_local.heads(scope_id, publication_id) VALUES (owner_id, new_id)
    ON CONFLICT (scope_id) DO UPDATE SET publication_id = EXCLUDED.publication_id;
  RETURN jsonb_build_object('publicationId', new_id::text, 'scopeId', owner_id::text,
    'sourceRevision', requested_revision::text, 'replayed', false);
END;
$$;
REVOKE ALL ON FUNCTION elo_local.publish(jsonb) FROM PUBLIC;

CREATE FUNCTION elo_local.read(owner_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'status', CASE WHEN publication.publication_id IS NULL THEN 'missing'
      WHEN publication.source_revision <> clock.revision THEN 'stale' ELSE 'current' END,
    'sourceRevision', clock.revision::text,
    'publishedRevision', publication.source_revision::text,
    'publicationId', publication.publication_id::text,
    'result', CASE WHEN publication.source_revision = clock.revision
      THEN publication.payload->'result' ELSE NULL END
  )
  FROM elo_local.source_clock clock
  LEFT JOIN elo_local.heads head ON head.scope_id = owner_id
  LEFT JOIN elo_local.publications publication ON publication.publication_id = head.publication_id
  WHERE clock.singleton;
$$;
REVOKE ALL ON FUNCTION elo_local.read(uuid) FROM PUBLIC;

REVOKE ALL ON ALL TABLES IN SCHEMA elo_local FROM PUBLIC, local_elo_reader, local_elo_worker, local_elo_writer;
GRANT USAGE ON SCHEMA elo_local TO local_elo_reader, local_elo_worker;
GRANT EXECUTE ON FUNCTION elo_local.snapshot(uuid), elo_local.publish(jsonb) TO local_elo_worker;
GRANT EXECUTE ON FUNCTION elo_local.read(uuid) TO local_elo_reader, local_elo_worker;
GRANT USAGE ON SCHEMA public TO local_elo_writer;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON public.games, public.players, public.plays, public.play_scores TO local_elo_writer;
COMMIT;
