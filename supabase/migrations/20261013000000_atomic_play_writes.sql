-- Additive preparation: legacy web writers still need migration before Android rollout.
BEGIN;

CREATE SCHEMA kingscore_private;
REVOKE ALL ON SCHEMA kingscore_private FROM PUBLIC, anon, authenticated;

CREATE TABLE kingscore_private.play_write_receipts (
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  request jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, request_id)
);
REVOKE ALL ON kingscore_private.play_write_receipts FROM PUBLIC, anon, authenticated;
ALTER TABLE kingscore_private.play_write_receipts ENABLE ROW LEVEL SECURITY;

-- This audited trigger references NEW.updated_at, a column absent from play_scores.
DROP TRIGGER IF EXISTS update_play_scores_updated_at ON public.play_scores;
-- These privileges bypass or extend row policies and are unused by the website.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.plays, public.play_scores FROM anon, authenticated;

CREATE FUNCTION kingscore_private.require_play_admin() RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR (auth.jwt()->'app_metadata'->>'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Administrator session required';
  END IF;
  RETURN actor;
END;
$$;

CREATE FUNCTION kingscore_private.play_snapshot(p_play_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' SET timezone = 'UTC' AS $$
  SELECT pg_catalog.jsonb_build_object(
    'detail', pg_catalog.jsonb_build_object(
      'play', pg_catalog.to_jsonb(p),
      'game', (SELECT pg_catalog.to_jsonb(g) FROM public.games g WHERE g.id = p.game_id),
      'scores', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'score', pg_catalog.to_jsonb(s),
          'player', (SELECT pg_catalog.to_jsonb(pl) FROM public.players pl WHERE pl.id = s.player_id)
        ) ORDER BY s."position" ASC NULLS LAST, s.id) FROM public.play_scores s WHERE s.play_id = p.id), '[]'::jsonb)
    ),
    'revision', 'v1:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.jsonb_build_object('play', pg_catalog.to_jsonb(p), 'scores', COALESCE(
        (SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s) ORDER BY s.id)
         FROM public.play_scores s WHERE s.play_id = p.id), '[]'::jsonb))::text,
      'UTF8')), 'hex')
  ) FROM public.plays p WHERE p.id = p_play_id;
$$;

CREATE FUNCTION kingscore_private.validate_play_input(p_payload jsonb, p_create boolean, p_play_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  item jsonb;
  score_id uuid;
  player_id uuid;
  game_id uuid;
  score_value double precision;
  seen_players uuid[] := '{}';
  seen_scores uuid[] := '{}';
  top_keys text[] := ARRAY['game_id','played_at','duration_minutes','source','notes','is_cooperative','team_won','scores'];
  score_keys text[] := ARRAY['id','player_id','score','winner','color','role'];
BEGIN
  IF p_payload IS NULL OR pg_catalog.jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Play input must be an object';
  END IF;
  IF pg_catalog.octet_length(p_payload::text) > 1048576 OR NOT (p_payload ?& top_keys)
     OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_payload) k WHERE NOT k = ANY(top_keys)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid play fields or input too large';
  END IF;
  IF pg_catalog.jsonb_typeof(p_payload->'game_id') <> 'string'
     OR pg_catalog.jsonb_typeof(p_payload->'played_at') <> 'string'
     OR (p_payload->>'played_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     OR pg_catalog.jsonb_typeof(p_payload->'source') <> 'string'
     OR (p_payload->>'source') NOT IN ('offline','online')
     OR pg_catalog.jsonb_typeof(p_payload->'notes') NOT IN ('string','null')
     OR pg_catalog.jsonb_typeof(p_payload->'is_cooperative') <> 'boolean'
     OR pg_catalog.jsonb_typeof(p_payload->'team_won') NOT IN ('boolean','null')
     OR pg_catalog.jsonb_typeof(p_payload->'scores') <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid play field type';
  END IF;
  game_id := (p_payload->>'game_id')::uuid;
  PERFORM (p_payload->>'played_at')::date;
  IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.id = game_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Game does not exist';
  END IF;
  IF p_payload->'duration_minutes' <> 'null'::jsonb THEN
    IF pg_catalog.jsonb_typeof(p_payload->'duration_minutes') <> 'number'
       OR (p_payload->>'duration_minutes') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Duration must be a nonnegative integer';
    END IF;
    PERFORM (p_payload->>'duration_minutes')::integer;
  END IF;
  IF NOT (p_payload->>'is_cooperative')::boolean AND p_payload->'team_won' <> 'null'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Competitive play cannot have a team result';
  END IF;
  -- V1 bounds small-array web-sort compatibility; it never truncates participants.
  IF pg_catalog.jsonb_array_length(p_payload->'scores') NOT BETWEEN 1 AND 63 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'V1 requires 1 to 63 participants';
  END IF;
  FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_payload->'scores') LOOP
    IF pg_catalog.jsonb_typeof(item) <> 'object' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Score must be an object';
    END IF;
    IF NOT (item ?& score_keys)
       OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(item) k WHERE NOT k = ANY(score_keys))
       OR pg_catalog.jsonb_typeof(item->'id') NOT IN ('string','null')
       OR pg_catalog.jsonb_typeof(item->'player_id') <> 'string'
       OR pg_catalog.jsonb_typeof(item->'score') NOT IN ('number','null')
       OR pg_catalog.jsonb_typeof(item->'winner') <> 'boolean'
       OR pg_catalog.jsonb_typeof(item->'color') NOT IN ('string','null')
       OR pg_catalog.jsonb_typeof(item->'role') NOT IN ('string','null') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid score fields';
    END IF;
    player_id := (item->>'player_id')::uuid;
    score_id := (item->>'id')::uuid;
    IF player_id = ANY(seen_players) OR (score_id IS NOT NULL AND score_id = ANY(seen_scores)) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Duplicate participant or score';
    END IF;
    seen_players := pg_catalog.array_append(seen_players, player_id);
    IF NOT EXISTS (SELECT 1 FROM public.players pl WHERE pl.id = player_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Player does not exist';
    END IF;
    IF score_id IS NOT NULL THEN
      seen_scores := pg_catalog.array_append(seen_scores, score_id);
      IF p_create OR NOT EXISTS (SELECT 1 FROM public.play_scores s WHERE s.id = score_id AND s.play_id = p_play_id) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Score ID does not belong to this play';
      END IF;
    END IF;
    IF item->'score' <> 'null'::jsonb THEN
      score_value := (item->>'score')::double precision;
      IF score_value IN ('Infinity'::double precision, '-Infinity'::double precision, 'NaN'::double precision) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Score must be finite';
      END IF;
    END IF;
    IF (p_payload->>'is_cooperative')::boolean AND p_payload->'team_won' <> 'null'::jsonb
       AND (item->>'winner')::boolean <> (p_payload->>'team_won')::boolean THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Participant winner conflicts with team result';
    END IF;
  END LOOP;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN
  RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid identifier, date or numeric value';
END;
$$;

CREATE FUNCTION kingscore_private.compare_play_scores(a jsonb, b jsonb) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN (a->>'winner')::boolean AND NOT (b->>'winner')::boolean THEN -1
    WHEN NOT (a->>'winner')::boolean AND (b->>'winner')::boolean THEN 1
    WHEN a->'score' = 'null'::jsonb OR b->'score' = 'null'::jsonb THEN 0
    WHEN (a->>'score')::double precision > (b->>'score')::double precision THEN -1
    WHEN (a->>'score')::double precision < (b->>'score')::double precision THEN 1
    ELSE 0 END;
$$;

CREATE FUNCTION kingscore_private.ranked_play_scores(p_payload jsonb)
RETURNS TABLE(item jsonb, "position" integer)
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  items jsonb[];
  n integer;
  run_end integer := 2;
  descending boolean;
  pivot jsonb;
  i integer;
  j integer;
  left_index integer;
  right_index integer;
  mid integer;
BEGIN
  SELECT pg_catalog.array_agg(value ORDER BY ordinality) INTO items
    FROM pg_catalog.jsonb_array_elements(p_payload->'scores') WITH ORDINALITY;
  n := pg_catalog.array_length(items, 1);
  IF (p_payload->>'is_cooperative')::boolean AND p_payload->'team_won' <> 'null'::jsonb THEN
    FOR i IN 1..n LOOP
      item := items[i]; "position" := CASE WHEN (p_payload->>'team_won')::boolean THEN 1 ELSE 2 END;
      RETURN NEXT;
    END LOOP;
    RETURN;
  END IF;
  -- Preserve the web comparator, including its non-transitive NULL comparison.
  -- V8 small arrays first detect a natural run, then use stable binary insertion.
  IF n > 1 THEN
    descending := kingscore_private.compare_play_scores(items[2], items[1]) < 0;
    WHILE run_end < n LOOP
      EXIT WHEN CASE WHEN descending THEN kingscore_private.compare_play_scores(items[run_end+1], items[run_end]) >= 0
        ELSE kingscore_private.compare_play_scores(items[run_end+1], items[run_end]) < 0 END;
      run_end := run_end + 1;
    END LOOP;
    IF descending THEN
      FOR i IN 1..(run_end/2) LOOP
        pivot := items[i]; items[i] := items[run_end+1-i]; items[run_end+1-i] := pivot;
      END LOOP;
    END IF;
    IF run_end < n THEN
      FOR i IN (run_end+1)..n LOOP
        pivot := items[i]; left_index := 1; right_index := i;
        WHILE left_index < right_index LOOP
          mid := left_index + ((right_index-left_index)/2);
          IF kingscore_private.compare_play_scores(pivot, items[mid]) < 0 THEN right_index := mid;
          ELSE left_index := mid+1; END IF;
        END LOOP;
        j := i;
        WHILE j > left_index LOOP items[j] := items[j-1]; j := j-1; END LOOP;
        items[left_index] := pivot;
      END LOOP;
    END IF;
  END IF;
  FOR i IN 1..n LOOP
    item := items[i]; "position" := CASE WHEN (item->>'winner')::boolean THEN 1 ELSE i END;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE FUNCTION kingscore_private.write_play_scores(p_play_id uuid, p_payload jsonb, p_preserve_mode boolean)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE ranked record; score_id uuid; preserve_positions boolean;
BEGIN
  -- Metadata-only saves must not reorder tied/NULL scores returned by the getter.
  SELECT p_preserve_mode AND pg_catalog.jsonb_array_length(p_payload->'scores') =
    (SELECT count(*) FROM public.play_scores s WHERE s.play_id = p_play_id)
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(p_payload->'scores') input
      LEFT JOIN public.play_scores s ON s.id = (input->>'id')::uuid AND s.play_id = p_play_id
      WHERE s.id IS NULL OR s.player_id IS DISTINCT FROM (input->>'player_id')::uuid
        OR s.score IS DISTINCT FROM (input->>'score')::numeric
        OR s.winner IS DISTINCT FROM (input->>'winner')::boolean
    ) INTO preserve_positions;
  DELETE FROM public.play_scores s WHERE s.play_id = p_play_id AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_payload->'scores') input
    WHERE (input->>'id')::uuid = s.id);
  FOR ranked IN SELECT * FROM kingscore_private.ranked_play_scores(p_payload) LOOP
    score_id := (ranked.item->>'id')::uuid;
    IF score_id IS NULL THEN
      INSERT INTO public.play_scores(play_id, player_id, score, winner, color, role, "position")
      VALUES (p_play_id, (ranked.item->>'player_id')::uuid, (ranked.item->>'score')::numeric,
        (ranked.item->>'winner')::boolean, ranked.item->>'color', ranked.item->>'role', ranked."position");
    ELSE
      UPDATE public.play_scores SET player_id = (ranked.item->>'player_id')::uuid,
        score = (ranked.item->>'score')::numeric, winner = (ranked.item->>'winner')::boolean,
        color = ranked.item->>'color', role = ranked.item->>'role',
        "position" = CASE WHEN preserve_positions THEN "position" ELSE ranked."position" END
      WHERE id = score_id AND play_id = p_play_id;
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION kingscore_private.write_play(
  p_operation text, p_request_id uuid, p_play_id uuid, p_expected_revision text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE
  actor uuid := kingscore_private.require_play_admin();
  request jsonb;
  receipt kingscore_private.play_write_receipts%ROWTYPE;
  snapshot jsonb;
  result jsonb;
  target_play_id uuid := p_play_id;
  preserve_mode boolean := false;
BEGIN
  IF p_request_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Request ID required'; END IF;
  request := pg_catalog.jsonb_build_object('operation', p_operation, 'play_id', p_play_id,
    'expected_revision', p_expected_revision, 'payload', p_payload);
  -- Serialize requests before locking the parent. A hash collision only adds waiting.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text || '/' || p_request_id::text, 0));
  SELECT * INTO receipt FROM kingscore_private.play_write_receipts r WHERE r.actor_id = actor AND r.request_id = p_request_id;
  IF FOUND THEN
    IF receipt.request <> request THEN RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Request ID already used for a different operation'; END IF;
    RETURN receipt.result || pg_catalog.jsonb_build_object('replayed', true);
  END IF;
  IF p_operation <> 'create' THEN
    IF target_play_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision = '' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Play ID and revision required';
    END IF;
    PERFORM 1 FROM public.plays p WHERE p.id = target_play_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Play does not exist'; END IF;
    PERFORM 1 FROM public.play_scores s WHERE s.play_id = target_play_id ORDER BY s.id FOR UPDATE;
    snapshot := kingscore_private.play_snapshot(target_play_id);
    IF snapshot->>'revision' <> p_expected_revision THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Play changed since it was opened';
    END IF;
  END IF;
  IF p_operation IN ('create', 'update') THEN
    PERFORM kingscore_private.validate_play_input(p_payload, p_operation = 'create', target_play_id);
    IF p_operation = 'update' THEN
      preserve_mode := snapshot->'detail'->'play'->'is_cooperative' IS NOT DISTINCT FROM p_payload->'is_cooperative'
        AND snapshot->'detail'->'play'->'team_won' IS NOT DISTINCT FROM p_payload->'team_won';
    END IF;
    IF p_operation = 'create' THEN
      INSERT INTO public.plays(user_id, game_id, played_at, duration_minutes, source, notes, is_cooperative, team_won)
      VALUES(actor, (p_payload->>'game_id')::uuid, (p_payload->>'played_at')::date,
        (p_payload->>'duration_minutes')::integer, p_payload->>'source', p_payload->>'notes',
        (p_payload->>'is_cooperative')::boolean, (p_payload->>'team_won')::boolean) RETURNING id INTO target_play_id;
    ELSE
      UPDATE public.plays SET game_id = (p_payload->>'game_id')::uuid, played_at = (p_payload->>'played_at')::date,
        duration_minutes = (p_payload->>'duration_minutes')::integer, source = p_payload->>'source', notes = p_payload->>'notes',
        is_cooperative = (p_payload->>'is_cooperative')::boolean, team_won = (p_payload->>'team_won')::boolean
      WHERE id = target_play_id;
    END IF;
    PERFORM kingscore_private.write_play_scores(target_play_id, p_payload, preserve_mode);
    snapshot := kingscore_private.play_snapshot(target_play_id);
    result := pg_catalog.jsonb_build_object('play_id', target_play_id, 'revision', snapshot->>'revision', 'replayed', false);
  ELSIF p_operation = 'delete' THEN
    DELETE FROM public.plays WHERE id = target_play_id;
    result := pg_catalog.jsonb_build_object('play_id', target_play_id, 'deleted', true, 'replayed', false);
  ELSE
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Unknown play operation';
  END IF;
  INSERT INTO kingscore_private.play_write_receipts(actor_id, request_id, request, result)
  VALUES(actor, p_request_id, request, result);
  RETURN result;
END;
$$;

CREATE FUNCTION public.get_play_editor_v1(p_play_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE result jsonb;
BEGIN
  PERFORM kingscore_private.require_play_admin();
  IF p_play_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Play ID required'; END IF;
  result := kingscore_private.play_snapshot(p_play_id);
  IF result IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Play does not exist'; END IF;
  RETURN result;
END;
$$;

CREATE FUNCTION public.create_play_v1(p_request_id uuid, p_payload jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT kingscore_private.write_play('create', p_request_id, NULL, NULL, p_payload);
$$;
CREATE FUNCTION public.update_play_v1(p_request_id uuid, p_play_id uuid, p_expected_revision text, p_payload jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT kingscore_private.write_play('update', p_request_id, p_play_id, p_expected_revision, p_payload);
$$;
CREATE FUNCTION public.delete_play_v1(p_request_id uuid, p_play_id uuid, p_expected_revision text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT kingscore_private.write_play('delete', p_request_id, p_play_id, p_expected_revision, NULL);
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA kingscore_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_play_editor_v1(uuid), public.create_play_v1(uuid,jsonb),
  public.update_play_v1(uuid,uuid,text,jsonb), public.delete_play_v1(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_play_editor_v1(uuid), public.create_play_v1(uuid,jsonb),
  public.update_play_v1(uuid,uuid,text,jsonb), public.delete_play_v1(uuid,uuid,text) TO authenticated;

COMMIT;
