-- Aggiunge il campo position alla tabella play_scores
-- Questo campo è necessario per il calcolo corretto del sistema ELO

ALTER TABLE play_scores
ADD COLUMN position INTEGER;

-- Aggiorna i dati esistenti: assegna la posizione 1 ai vincitori
-- e posizioni successive agli altri giocatori basate sul punteggio
WITH ranked_players AS (
  SELECT
    ps.id,
    ps.play_id,
    ps.player_id,
    ps.winner,
    ps.score,
    ROW_NUMBER() OVER (
      PARTITION BY ps.play_id
      ORDER BY
        ps.winner DESC,
        ps.score DESC NULLS LAST
    ) as calculated_position
  FROM play_scores ps
)
UPDATE play_scores ps
SET position = rp.calculated_position
FROM ranked_players rp
WHERE ps.id = rp.id;
