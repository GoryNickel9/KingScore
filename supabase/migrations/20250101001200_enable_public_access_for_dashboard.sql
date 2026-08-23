-- Abilita l'accesso pubblico in lettura per Dashboard, Partite e Statistiche
-- Questa migrazione permette agli utenti non registrati di vedere i dati pubblici

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

-- Mantieni le policy di scrittura (INSERT, UPDATE, DELETE) solo per gli utenti autenticati
-- Le policy per le operazioni di scrittura non vengono modificate
