-- Fix della policy RLS per DELETE su play_scores
-- 
-- PROBLEMA: La policy precedente filtrava le righe eliminabili in base alla
-- proprietà del GIOCATORE (player_id → players.user_id = auth.uid()).
-- Questo causava fallimenti silenziosi quando si cercava di eliminare score
-- per giocatori non appartenenti all'utente corrente (es. dati importati).
--
-- FIX: La policy ora controlla che la PARTITA (play_id → plays.user_id) appartenga
-- all'utente corrente, che è il controllo semanticamente corretto:
-- "posso eliminare gli score di partite che sono mie".

DROP POLICY IF EXISTS "Users can delete play_scores for their players" ON play_scores;

CREATE POLICY "Users can delete play_scores for their plays"
  ON play_scores FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM plays
      WHERE plays.id = play_scores.play_id
      AND plays.user_id = auth.uid()
    )
  );
