-- Aggiunge il campo alias alla tabella players
-- Questo permette ai giocatori di avere un alias/nickname opzionale

-- Aggiunge la colonna alias alla tabella players
ALTER TABLE players ADD COLUMN alias TEXT;

-- Aggiunge un commento alla colonna
COMMENT ON COLUMN players.alias IS 'Alias o nickname opzionale del giocatore';
