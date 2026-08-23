-- Riparazione policy RLS — da eseguire SE le partite non si aggiornano
-- o i grafici ELO non si caricano dalla cache.
--
-- PROBLEMA A: plays — la catena di migration poteva lasciare la tabella senza
--   alcuna policy SELECT, rendendo UPDATE...RETURNING sempre vuoto (0 righe
--   restituite) anche se il dato è stato effettivamente aggiornato nel DB.
--
-- PROBLEMA B: elo_history — situazione analoga: senza policy SELECT il
--   controllo cache ritorna sempre null, causando ricalcolo infinito + 409
--   in fase di INSERT (il dato esiste già dalla sessione precedente).
--
-- Questo script è IDEMPOTENTE (DROP IF EXISTS + CREATE IF NOT EXISTS logic).

-- ─── plays: ripristino policy SELECT ─────────────────────────────────────────

DROP POLICY IF EXISTS "Public can view plays"          ON plays;
DROP POLICY IF EXISTS "Users can view their own plays" ON plays;

-- Accesso pubblico in lettura (coerente con l'intero progetto)
CREATE POLICY "Public can view plays"
  ON plays FOR SELECT
  USING (true);

-- ─── plays: garanzia policy UPDATE (non toccata ma potrebbe mancare) ─────────

DROP POLICY IF EXISTS "Users can update their own plays" ON plays;

CREATE POLICY "Users can update their own plays"
  ON plays FOR UPDATE
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── elo_history: ripristino policy SELECT ───────────────────────────────────

DROP POLICY IF EXISTS "Public can view elo_history" ON elo_history;

CREATE POLICY "Public can view elo_history"
  ON elo_history FOR SELECT
  USING (true);

-- ─── elo_history: garanzia policy INSERT ─────────────────────────────────────

DROP POLICY IF EXISTS "Users can insert their own elo_history" ON elo_history;

CREATE POLICY "Users can insert their own elo_history"
  ON elo_history FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM plays
      WHERE plays.id = elo_history.play_id
        AND plays.user_id = auth.uid()
    )
  );

-- ─── elo_history: garanzia policy DELETE (per invalidateELOHistory) ──────────

DROP POLICY IF EXISTS "Users can delete their own elo_history" ON elo_history;

CREATE POLICY "Users can delete their own elo_history"
  ON elo_history FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM plays
      WHERE plays.id = elo_history.play_id
        AND plays.user_id = auth.uid()
    )
  );

-- ─── Verifica finale ─────────────────────────────────────────────────────────

SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('plays', 'elo_history')
ORDER BY tablename, cmd, policyname;
