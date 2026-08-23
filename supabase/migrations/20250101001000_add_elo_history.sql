-- Tabella per la persistenza della storia ELO (cache)
-- Evita il ricalcolo in-memory della storia ELO a ogni visualizzazione:
-- per 291 partite il ricalcolo produceva ~860 punti dati con costo elevato.
--
-- Logica cache:
-- - ELO specifico per gioco  →  is_general = false, game_id NOT NULL
-- - ELO Generale             →  is_general = true,  game_id IS NULL
--
-- Invalidazione: usare invalidateELOHistory() da EditPlay dopo ogni modifica.

CREATE TABLE IF NOT EXISTS elo_history (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  play_id       UUID        NOT NULL REFERENCES plays(id)    ON DELETE CASCADE,
  game_id       UUID                 REFERENCES games(id)    ON DELETE CASCADE,   -- NULL per ELO Generale
  player_id     UUID        NOT NULL REFERENCES players(id)  ON DELETE CASCADE,
  player_name   TEXT        NOT NULL,
  rating        INTEGER     NOT NULL,
  rating_change INTEGER     NOT NULL,
  date          TIMESTAMPTZ NOT NULL,
  is_general    BOOLEAN     NOT NULL DEFAULT false,
  games_played  INTEGER,                                                           -- Solo per is_general = true
  user_id       UUID                 REFERENCES auth.users(id) ON DELETE SET NULL, -- Per filtrare ELO Generale per utente
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indici performance ───────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_elo_history_play_id    ON elo_history(play_id);
CREATE INDEX IF NOT EXISTS idx_elo_history_game_id    ON elo_history(game_id);
CREATE INDEX IF NOT EXISTS idx_elo_history_player_id  ON elo_history(player_id);
CREATE INDEX IF NOT EXISTS idx_elo_history_is_general ON elo_history(is_general);
CREATE INDEX IF NOT EXISTS idx_elo_history_user_id    ON elo_history(user_id);

-- Unique index per ELO specifico per gioco (game_id NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS elo_history_game_uq
  ON elo_history(play_id, player_id, game_id)
  WHERE game_id IS NOT NULL AND is_general = false;

-- Unique index per ELO Generale (game_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS elo_history_general_uq
  ON elo_history(play_id, player_id)
  WHERE is_general = true;

-- ─── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE elo_history ENABLE ROW LEVEL SECURITY;

-- SELECT pubblico (coerente con le altre tabelle del progetto)
CREATE POLICY "Public can view elo_history"
  ON elo_history FOR SELECT
  USING (true);

-- INSERT: solo il proprietario del play associato
CREATE POLICY "Users can insert their own elo_history"
  ON elo_history FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM plays
      WHERE plays.id = elo_history.play_id
        AND plays.user_id = auth.uid()
    )
  );

-- UPDATE: solo il proprietario del play associato
CREATE POLICY "Users can update their own elo_history"
  ON elo_history FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM plays
      WHERE plays.id = elo_history.play_id
        AND plays.user_id = auth.uid()
    )
  );

-- DELETE: solo il proprietario del play associato
CREATE POLICY "Users can delete their own elo_history"
  ON elo_history FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM plays
      WHERE plays.id = elo_history.play_id
        AND plays.user_id = auth.uid()
    )
  );
