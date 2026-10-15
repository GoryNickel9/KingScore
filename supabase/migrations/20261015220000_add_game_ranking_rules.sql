BEGIN;

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS lower_score_wins boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shared_score_positions boolean NOT NULL DEFAULT true;

UPDATE public.games SET lower_score_wins = true
WHERE id = '904579b2-3b31-42fd-8d7b-25d68d1e5ce5';

-- Solo posizioni: punteggi, vincitori, ruoli e colori non vengono riscritti.
CREATE OR REPLACE FUNCTION public.update_play_positions(p_positions jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE updated_count integer;
BEGIN
  IF coalesce(auth.jwt()->'app_metadata'->>'role', '') <> 'admin'
     AND coalesce(auth.jwt()->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Admin or service_role required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_positions) IS DISTINCT FROM 'array' OR jsonb_array_length(p_positions) > 500 THEN
    RAISE EXCEPTION 'Expected array with at most 500 positions';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_positions) AS x(id uuid,position integer)
    LEFT JOIN public.play_scores s ON s.id=x.id WHERE s.id IS NULL OR x.position IS NULL OR x.position < 1)
    OR (SELECT count(*) FROM jsonb_to_recordset(p_positions) AS x(id uuid)) <>
       (SELECT count(DISTINCT id) FROM jsonb_to_recordset(p_positions) AS x(id uuid)) THEN
    RAISE EXCEPTION 'Invalid, missing or duplicate score ID or position';
  END IF;
  UPDATE public.play_scores s SET position=x.position
  FROM jsonb_to_recordset(p_positions) AS x(id uuid,position integer)
  WHERE s.id=x.id AND s.position IS DISTINCT FROM x.position;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;
REVOKE ALL ON FUNCTION public.update_play_positions(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_play_positions(jsonb) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
