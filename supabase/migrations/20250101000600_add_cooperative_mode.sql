-- Aggiunge supporto per le partite cooperative
ALTER TABLE plays 
  ADD COLUMN IF NOT EXISTS is_cooperative BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS team_won BOOLEAN DEFAULT NULL;

-- Commento: is_cooperative = true indica che è una partita cooperativa
-- team_won = true/false/null indica se il team ha vinto/perso/non specificato
