-- Browser adapters keep NUMERIC text exact. Android JSON-number contracts stay unchanged.
BEGIN;

CREATE FUNCTION kingscore_private.normalize_web_play_input(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE item jsonb; items jsonb := '[]'::jsonb;
BEGIN
  IF p_payload IS NULL OR pg_catalog.jsonb_typeof(p_payload) <> 'object'
    OR pg_catalog.jsonb_typeof(p_payload->'scores') IS DISTINCT FROM 'array'
    OR pg_catalog.octet_length(p_payload::text) > 1048576 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid web play input';
  END IF;
  IF pg_catalog.jsonb_array_length(p_payload->'scores') NOT BETWEEN 1 AND 63 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='V1 requires 1 to 63 participants';
  END IF;
  FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_payload->'scores') LOOP
    IF pg_catalog.jsonb_typeof(item) <> 'object' THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid web score input';
    END IF;
    IF pg_catalog.jsonb_typeof(item->'score') = 'string' THEN
      IF (item->>'score') !~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$' THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid decimal score';
      END IF;
      -- Reject out-of-range exponents before allocating a potentially large NUMERIC.
      PERFORM (item->>'score')::double precision;
      item := pg_catalog.jsonb_set(item, '{score}', pg_catalog.to_jsonb((item->>'score')::numeric));
    END IF;
    items := items || pg_catalog.jsonb_build_array(item);
  END LOOP;
  RETURN pg_catalog.jsonb_set(p_payload, '{scores}', items);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Decimal score outside the supported range';
END;
$$;

CREATE FUNCTION kingscore_private.write_play_with_score_text(
  p_operation text, p_request_id uuid, p_play_id uuid, p_expected_revision text, p_payload jsonb, p_text_scores boolean)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE
  actor uuid := kingscore_private.require_play_admin();
  request jsonb;
  receipt kingscore_private.play_write_receipts%ROWTYPE;
  snapshot jsonb;
  result jsonb;
  target_play_id uuid := p_play_id;
  preserve_mode boolean := false;
  write_payload jsonb := p_payload;
BEGIN
  IF p_request_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Request ID required'; END IF;
  request := pg_catalog.jsonb_build_object('operation', p_operation, 'play_id', p_play_id,
    'expected_revision', p_expected_revision, 'payload', p_payload);
  IF p_text_scores THEN request := request || pg_catalog.jsonb_build_object('score_encoding','decimal-text'); END IF;
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
    IF p_text_scores THEN write_payload := kingscore_private.normalize_web_play_input(p_payload); END IF;
    PERFORM kingscore_private.validate_play_input(write_payload, p_operation = 'create', target_play_id);
    IF p_operation = 'update' THEN
      preserve_mode := snapshot->'detail'->'play'->'is_cooperative' IS NOT DISTINCT FROM write_payload->'is_cooperative'
        AND snapshot->'detail'->'play'->'team_won' IS NOT DISTINCT FROM write_payload->'team_won';
    END IF;
    IF p_operation = 'create' THEN
      INSERT INTO public.plays(user_id, game_id, played_at, duration_minutes, source, notes, is_cooperative, team_won)
      VALUES(actor, (write_payload->>'game_id')::uuid, (write_payload->>'played_at')::date,
        (write_payload->>'duration_minutes')::integer, write_payload->>'source', write_payload->>'notes',
        (write_payload->>'is_cooperative')::boolean, (write_payload->>'team_won')::boolean) RETURNING id INTO target_play_id;
    ELSE
      UPDATE public.plays SET game_id = (write_payload->>'game_id')::uuid, played_at = (write_payload->>'played_at')::date,
        duration_minutes = (write_payload->>'duration_minutes')::integer, source = write_payload->>'source', notes = write_payload->>'notes',
        is_cooperative = (write_payload->>'is_cooperative')::boolean, team_won = (write_payload->>'team_won')::boolean
      WHERE id = target_play_id;
    END IF;
    PERFORM kingscore_private.write_play_scores(target_play_id, write_payload, preserve_mode);
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

CREATE OR REPLACE FUNCTION kingscore_private.write_play(
  p_operation text, p_request_id uuid, p_play_id uuid, p_expected_revision text, p_payload jsonb)
RETURNS jsonb LANGUAGE sql SET search_path = '' AS $$
  SELECT kingscore_private.write_play_with_score_text(p_operation,p_request_id,p_play_id,p_expected_revision,p_payload,false);
$$;

CREATE FUNCTION public.get_web_play_editor_v1(p_play_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE result jsonb; items jsonb;
BEGIN
  PERFORM kingscore_private.require_play_admin();
  IF p_play_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Play ID required'; END IF;
  result := kingscore_private.play_snapshot(p_play_id);
  IF result IS NULL THEN RAISE EXCEPTION USING ERRCODE='PT404', MESSAGE='Play does not exist'; END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(CASE WHEN item#>'{score,score}' = 'null'::jsonb THEN item
    ELSE pg_catalog.jsonb_set(item,'{score,score}',pg_catalog.to_jsonb((item#>'{score,score}')::text)) END ORDER BY ordinal), '[]'::jsonb)
  INTO items FROM pg_catalog.jsonb_array_elements(result#>'{detail,scores}') WITH ORDINALITY AS rows(item,ordinal);
  RETURN pg_catalog.jsonb_set(result,'{detail,scores}',items);
END;
$$;

CREATE FUNCTION public.create_web_play_v1(p_request_id uuid, p_payload jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT kingscore_private.write_play_with_score_text('create',p_request_id,NULL,NULL,p_payload,true);
$$;
CREATE FUNCTION public.update_web_play_v1(p_request_id uuid, p_play_id uuid, p_expected_revision text, p_payload jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT kingscore_private.write_play_with_score_text('update',p_request_id,p_play_id,p_expected_revision,p_payload,true);
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA kingscore_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_web_play_editor_v1(uuid),public.create_web_play_v1(uuid,jsonb),
  public.update_web_play_v1(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_web_play_editor_v1(uuid),public.create_web_play_v1(uuid,jsonb),
  public.update_web_play_v1(uuid,uuid,text,jsonb) TO authenticated;
COMMIT;
