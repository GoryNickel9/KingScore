-- RPC per il job notturno di ricalcolo ELO (TD-020, TECH_DEBT_AUDIT.md):
-- restituisce gli user_id distinti con almeno una partita, sostituendo la
-- lettura di fino a 10.000 righe dalla tabella plays.
--
-- SECURITY DEFINER + REVOKE: richiamabile solo dal service_role (job
-- notturno); anon e authenticated non possono elencare gli utenti.

CREATE OR REPLACE FUNCTION get_play_user_ids()
RETURNS TABLE (user_id UUID)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT user_id
  FROM plays
  WHERE user_id IS NOT NULL
$$;

REVOKE EXECUTE ON FUNCTION get_play_user_ids() FROM PUBLIC, anon, authenticated;
-- Grant esplicito: il job notturno invoca questa RPC con il service_role,
-- che altrimenti potrebbe non avere grant dirette sulle nuove funzioni.
GRANT EXECUTE ON FUNCTION get_play_user_ids() TO service_role;
