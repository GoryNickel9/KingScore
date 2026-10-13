-- Additive import RPC. Legacy direct writers still require the later web cutover.
BEGIN;

CREATE FUNCTION public.import_bga_play_v1(
  p_request_id uuid, p_payload jsonb, p_metadata jsonb, p_positions jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE
  actor uuid := kingscore_private.require_play_admin();
  request jsonb;
  receipt kingscore_private.play_write_receipts%ROWTYPE;
  target_play_id uuid;
  external_table_id text;
  external_position jsonb;
  result jsonb;
  snapshot jsonb;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Request ID required';
  END IF;
  request := pg_catalog.jsonb_build_object('operation', 'import-bga',
    'payload', p_payload, 'metadata', p_metadata, 'positions', p_positions);
  -- Same request lock namespace as the other play RPCs, including cross-operation reuse.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text || '/' || p_request_id::text, 0));
  SELECT * INTO receipt FROM kingscore_private.play_write_receipts r
    WHERE r.actor_id = actor AND r.request_id = p_request_id;
  IF FOUND THEN
    IF receipt.request <> request THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Request ID already used for a different operation';
    END IF;
    RETURN receipt.result || pg_catalog.jsonb_build_object('replayed', true);
  END IF;

  IF p_metadata IS NULL OR pg_catalog.jsonb_typeof(p_metadata) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Import metadata must be an object';
  END IF;
  IF NOT (p_metadata ?& ARRAY['location','bga_table_id'])
     OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_metadata) k
       WHERE k NOT IN ('location','bga_table_id'))
     OR pg_catalog.jsonb_typeof(p_metadata->'location') NOT IN ('string','null')
     OR pg_catalog.jsonb_typeof(p_metadata->'bga_table_id') <> 'string'
     OR pg_catalog.octet_length(p_metadata::text) > 1048576 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid import metadata fields';
  END IF;
  external_table_id := p_metadata->>'bga_table_id';
  IF pg_catalog.char_length(external_table_id) NOT BETWEEN 1 AND 256
     OR pg_catalog.btrim(external_table_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'BGA table ID must contain 1 to 256 characters';
  END IF;
  PERFORM kingscore_private.validate_play_input(p_payload, true, NULL);
  IF p_payload->>'source' <> 'offline' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'BGA import source must be offline';
  END IF;
  IF p_positions IS NULL OR pg_catalog.jsonb_typeof(p_positions) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Import positions must be an array';
  END IF;
  IF pg_catalog.jsonb_array_length(p_positions) <> pg_catalog.jsonb_array_length(p_payload->'scores') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Import positions must match the participants';
  END IF;
  FOR external_position IN SELECT value FROM pg_catalog.jsonb_array_elements(p_positions) LOOP
    IF external_position <> 'null'::jsonb THEN
      IF pg_catalog.jsonb_typeof(external_position) <> 'number'
         OR external_position::text !~ '^[1-9][0-9]*$' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Import position must be null or a positive integer';
      END IF;
      BEGIN
        PERFORM external_position::text::integer;
      EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Import position is outside the integer range';
      END;
    END IF;
  END LOOP;

  -- Serialize only new imports for the same actor/table. Existing legacy
  -- duplicates remain intact; direct legacy writes do not share this lock.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'import-bga/' || actor::text || '/' || external_table_id, 0));
  SELECT p.id INTO target_play_id FROM public.plays p
    WHERE p.user_id = actor AND p.bga_table_id = external_table_id
    ORDER BY p.id LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    PERFORM 1 FROM public.play_scores s WHERE s.play_id = target_play_id ORDER BY s.id FOR UPDATE;
    snapshot := kingscore_private.play_snapshot(target_play_id);
    result := pg_catalog.jsonb_build_object('play_id', target_play_id,
      'revision', snapshot->>'revision', 'replayed', false, 'skipped', true);
  ELSE
    INSERT INTO public.plays(user_id, game_id, played_at, location, notes,
      duration_minutes, source, bga_table_id, is_cooperative, team_won)
    VALUES (actor, (p_payload->>'game_id')::uuid, (p_payload->>'played_at')::date,
      p_metadata->>'location', p_payload->>'notes', (p_payload->>'duration_minutes')::integer,
      p_payload->>'source', external_table_id, (p_payload->>'is_cooperative')::boolean,
      (p_payload->>'team_won')::boolean)
    RETURNING id INTO target_play_id;
    INSERT INTO public.play_scores(play_id, player_id, score, winner, color, role, "position")
    SELECT target_play_id, (input.item->>'player_id')::uuid, (input.item->>'score')::numeric,
      (input.item->>'winner')::boolean, input.item->>'color', input.item->>'role',
      (p_positions->>((input.ordinal - 1)::integer))::integer
    FROM pg_catalog.jsonb_array_elements(p_payload->'scores') WITH ORDINALITY AS input(item, ordinal);
    snapshot := kingscore_private.play_snapshot(target_play_id);
    result := pg_catalog.jsonb_build_object('play_id', target_play_id,
      'revision', snapshot->>'revision', 'replayed', false, 'skipped', false);
  END IF;
  INSERT INTO kingscore_private.play_write_receipts(actor_id, request_id, request, result)
    VALUES (actor, p_request_id, request, result);
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.import_bga_play_v1(uuid,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_bga_play_v1(uuid,jsonb,jsonb,jsonb) TO authenticated;

COMMIT;
