-- Tabella per memorizzare l'ELO Generale (aggregato) dei giocatori
CREATE TABLE IF NOT EXISTS player_general_ratings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id UUID REFERENCES players(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  rating INTEGER DEFAULT 1000, -- ELO Generale iniziale
  games_played INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  draws INTEGER DEFAULT 0,
  last_played_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id, user_id)
);

-- Indici per migliorare le performance
CREATE INDEX IF NOT EXISTS idx_player_general_ratings_player_id ON player_general_ratings(player_id);
CREATE INDEX IF NOT EXISTS idx_player_general_ratings_user_id ON player_general_ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_player_general_ratings_rating ON player_general_ratings(rating DESC);

-- Row Level Security
ALTER TABLE player_general_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "player_general_ratings_own" ON player_general_ratings
  FOR ALL USING (
    user_id = auth.uid()
  );

-- Trigger per aggiornare automaticamente updated_at
CREATE TRIGGER update_player_general_ratings_updated_at
  BEFORE UPDATE ON player_general_ratings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
