-- Tabella per memorizzare i rating ELO dei giocatori per ogni gioco
CREATE TABLE IF NOT EXISTS player_ratings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id UUID REFERENCES players(id) ON DELETE CASCADE,
  game_id UUID REFERENCES games(id) ON DELETE CASCADE,
  rating INTEGER DEFAULT 1000, -- Rating ELO iniziale
  games_played INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  draws INTEGER DEFAULT 0,
  last_played_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id, game_id)
);

-- Indici per migliorare le performance
CREATE INDEX IF NOT EXISTS idx_player_ratings_player_id ON player_ratings(player_id);
CREATE INDEX IF NOT EXISTS idx_player_ratings_game_id ON player_ratings(game_id);
CREATE INDEX IF NOT EXISTS idx_player_ratings_rating ON player_ratings(rating DESC);

-- Row Level Security
ALTER TABLE player_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "player_ratings_own" ON player_ratings
  FOR ALL USING (
    player_id IN (SELECT id FROM players WHERE user_id = auth.uid())
  );

-- Funzione per aggiornare il timestamp updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger per aggiornare automaticamente updated_at
CREATE TRIGGER update_player_ratings_updated_at
  BEFORE UPDATE ON player_ratings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
