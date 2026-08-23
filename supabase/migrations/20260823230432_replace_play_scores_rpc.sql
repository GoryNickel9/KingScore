-- Sostituzione atomica dei punteggi di una partita (TD-004,
-- TECH_DEBT_AUDIT.md): delete + insert in un'unica transazione lato DB.
--
-- PRIMA: EditPlay eseguiva due richieste HTTP separate (DELETE di tutti i
-- play_scores, poi INSERT del nuovo set); un fallimento tra le due lasciava
-- la partita senza punteggi — e i punteggi sono dati GREZZI, non ricostruibili
-- dal ricalcolo ELO.
--
-- Sicurezza: SECURITY DEFINER per garantire il comportamento a prescindere
-- dalle policy RLS correnti, con verifica esplicita di ownership
-- (plays.user_id = auth.uid()); invocabile solo da utenti autenticati.

CREATE OR REPLACE FUNCTION replace_play_scores(p_play_id UUID, p_scores JSONB)
RETURNS SETOF play_scores
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
BEGIN
  SELECT user_id INTO v_owner FROM plays WHERE id = p_play_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partita % non trovata', p_play_id USING ERRCODE = 'P0002';
  END IF;
  IF v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Permesso negato: la partita non appartiene all''utente corrente'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM play_scores WHERE play_id = p_play_id;

  INSERT INTO play_scores (play_id, player_id, score, winner, position)
  SELECT
    p_play_id,
    (s->>'player_id')::uuid,
    (s->>'score')::numeric,
    (s->>'winner')::boolean,
    (s->>'position')::int
  FROM jsonb_array_elements(p_scores) AS s;

  RETURN QUERY SELECT * FROM play_scores WHERE play_id = p_play_id ORDER BY id;
END;
$$;

REVOKE EXECUTE ON FUNCTION replace_play_scores(UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION replace_play_scores(UUID, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION replace_play_scores(UUID, JSONB) TO authenticated;
