-- Abilita l'accesso pubblico in lettura a tutte le tabelle
-- Mantiene le restrizioni per le operazioni di scrittura (INSERT, UPDATE, DELETE)

-- Politica per la tabella games: permetti a tutti di leggere
DROP POLICY IF EXISTS "Public can view games" ON games;
CREATE POLICY "Public can view games"
  ON games FOR SELECT
  USING (true);

-- Politica per la tabella plays: permetti a tutti di leggere
DROP POLICY IF EXISTS "Public can view plays" ON plays;
CREATE POLICY "Public can view plays"
  ON plays FOR SELECT
  USING (true);

-- Politica per la tabella players: permetti a tutti di leggere
DROP POLICY IF EXISTS "Public can view players" ON players;
CREATE POLICY "Public can view players"
  ON players FOR SELECT
  USING (true);

-- Politica per la tabella play_scores: permetti a tutti di leggere
DROP POLICY IF EXISTS "Public can view play_scores" ON play_scores;
CREATE POLICY "Public can view play_scores"
  ON play_scores FOR SELECT
  USING (true);

-- Politica per la tabella player_ratings: permetti a tutti di leggere
DROP POLICY IF EXISTS "Public can view player_ratings" ON player_ratings;
CREATE POLICY "Public can view player_ratings"
  ON player_ratings FOR SELECT
  USING (true);

-- Politica per la tabella player_general_ratings: permetti a tutti di leggere
DROP POLICY IF EXISTS "Public can view player_general_ratings" ON player_general_ratings;
CREATE POLICY "Public can view player_general_ratings"
  ON player_general_ratings FOR SELECT
  USING (true);
