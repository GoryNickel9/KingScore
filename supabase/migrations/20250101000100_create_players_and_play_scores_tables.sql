-- Create players table if it doesn't exist
CREATE TABLE IF NOT EXISTS players (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  alias TEXT,
  is_me BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create play_scores table if it doesn't exist
CREATE TABLE IF NOT EXISTS play_scores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  play_id UUID NOT NULL REFERENCES plays(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  winner BOOLEAN DEFAULT FALSE,
  position INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(play_id, player_id)
);

-- Enable Row Level Security
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE play_scores ENABLE ROW LEVEL SECURITY;

-- Create policies for players table
CREATE POLICY "Users can view their own players"
  ON players FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own players"
  ON players FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own players"
  ON players FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own players"
  ON players FOR DELETE
  USING (auth.uid() = user_id);

-- Create policies for play_scores table
CREATE POLICY "Users can view play_scores for their players"
  ON play_scores FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM players
      WHERE players.id = play_scores.player_id
      AND players.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert play_scores for their players"
  ON play_scores FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM players
      WHERE players.id = play_scores.player_id
      AND players.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update play_scores for their players"
  ON play_scores FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM players
      WHERE players.id = play_scores.player_id
      AND players.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete play_scores for their players"
  ON play_scores FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM players
      WHERE players.id = play_scores.player_id
      AND players.user_id = auth.uid()
    )
  );

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_players_user_id ON players(user_id);
CREATE INDEX IF NOT EXISTS idx_play_scores_play_id ON play_scores(play_id);
CREATE INDEX IF NOT EXISTS idx_play_scores_player_id ON play_scores(player_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc'::text, NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers to automatically update updated_at
CREATE TRIGGER update_players_updated_at
  BEFORE UPDATE ON players
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_play_scores_updated_at
  BEFORE UPDATE ON play_scores
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
