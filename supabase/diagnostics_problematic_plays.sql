-- Query SQL per diagnosticare le partite problematiche
-- Esegui queste query nel SQL Editor del dashboard di Supabase

-- ============================================
-- QUERY 1: Trova tutte le partite senza play_scores
-- ============================================
SELECT 
  p.id AS play_id,
  p.played_at,
  p.location,
  p.duration_minutes,
  p.source,
  p.notes,
  g.name AS game_name,
  g.id AS game_id,
  0 AS play_scores_count,
  'Nessun punteggio associato' AS issue
FROM plays p
LEFT JOIN games g ON p.game_id = g.id
WHERE NOT EXISTS (
  SELECT 1 FROM play_scores ps WHERE ps.play_id = p.id
)
ORDER BY p.played_at DESC;

-- ============================================
-- QUERY 2: Trova tutte le partite con solo 1 play_score
-- ============================================
SELECT 
  p.id AS play_id,
  p.played_at,
  p.location,
  p.duration_minutes,
  p.source,
  p.notes,
  g.name AS game_name,
  g.id AS game_id,
  1 AS play_scores_count,
  'Solo un punteggio (servono almeno 2 per ELO)' AS issue
FROM plays p
LEFT JOIN games g ON p.game_id = g.id
WHERE EXISTS (
  SELECT 1 FROM play_scores ps WHERE ps.play_id = p.id
)
AND (
  SELECT COUNT(*) FROM play_scores ps WHERE ps.play_id = p.id
) = 1
ORDER BY p.played_at DESC;

-- ============================================
-- QUERY 3: Trova tutte le partite problematiche (0 o 1 play_score)
-- ============================================
SELECT 
  p.id AS play_id,
  p.played_at,
  p.location,
  p.duration_minutes,
  p.source,
  p.notes,
  g.name AS game_name,
  g.id AS game_id,
  COALESCE(ps_count, 0) AS play_scores_count,
  CASE 
    WHEN COALESCE(ps_count, 0) = 0 THEN 'Nessun punteggio associato'
    WHEN COALESCE(ps_count, 0) = 1 THEN 'Solo un punteggio (servono almeno 2 per ELO)'
    ELSE 'OK'
  END AS issue
FROM plays p
LEFT JOIN games g ON p.game_id = g.id
LEFT JOIN (
  SELECT play_id, COUNT(*) AS ps_count
  FROM play_scores
  GROUP BY play_id
) ps ON p.id = ps.play_id
WHERE COALESCE(ps_count, 0) < 2
ORDER BY p.played_at DESC;

-- ============================================
-- QUERY 4: Dettagli completi delle partite problematiche con giocatori
-- ============================================
SELECT 
  p.id AS play_id,
  p.played_at,
  p.location,
  p.duration_minutes,
  p.source,
  p.notes,
  g.name AS game_name,
  g.id AS game_id,
  COALESCE(ps_count, 0) AS play_scores_count,
  CASE 
    WHEN COALESCE(ps_count, 0) = 0 THEN 'Nessun punteggio associato'
    WHEN COALESCE(ps_count, 0) = 1 THEN 'Solo un punteggio (servono almeno 2 per ELO)'
    ELSE 'OK'
  END AS issue,
  (
    SELECT json_agg(
      json_build_object(
        'player_id', ps.player_id,
        'player_name', pl.name,
        'player_alias', pl.alias,
        'score', ps.score,
        'winner', ps.winner,
        'position', ps.position
      )
    )
    FROM play_scores ps
    JOIN players pl ON ps.player_id = pl.id
    WHERE ps.play_id = p.id
  ) AS players
FROM plays p
LEFT JOIN games g ON p.game_id = g.id
LEFT JOIN (
  SELECT play_id, COUNT(*) AS ps_count
  FROM play_scores
  GROUP BY play_id
) ps ON p.id = ps.play_id
WHERE COALESCE(ps_count, 0) < 2
ORDER BY p.played_at DESC;

-- ============================================
-- QUERY 5: Statistiche generali sulle partite
-- ============================================
SELECT 
  COUNT(*) AS total_plays,
  COUNT(CASE WHEN ps_count IS NULL THEN 1 END) AS plays_without_scores,
  COUNT(CASE WHEN ps_count = 1 THEN 1 END) AS plays_with_one_score,
  COUNT(CASE WHEN ps_count >= 2 THEN 1 END) AS plays_with_multiple_scores,
  COUNT(CASE WHEN COALESCE(ps_count, 0) < 2 THEN 1 END) AS problematic_plays
FROM plays p
LEFT JOIN (
  SELECT play_id, COUNT(*) AS ps_count
  FROM play_scores
  GROUP BY play_id
) ps ON p.id = ps.play_id;

-- ============================================
-- QUERY 6: Trova partite specifiche per ID
-- (Sostituisci gli ID con quelli delle partite che vuoi investigare)
-- ============================================
SELECT 
  p.id AS play_id,
  p.played_at,
  p.location,
  p.duration_minutes,
  p.source,
  p.notes,
  g.name AS game_name,
  g.id AS game_id,
  COALESCE(ps_count, 0) AS play_scores_count,
  CASE 
    WHEN COALESCE(ps_count, 0) = 0 THEN 'Nessun punteggio associato'
    WHEN COALESCE(ps_count, 0) = 1 THEN 'Solo un punteggio (servono almeno 2 per ELO)'
    ELSE 'OK'
  END AS issue,
  (
    SELECT json_agg(
      json_build_object(
        'player_id', ps.player_id,
        'player_name', pl.name,
        'player_alias', pl.alias,
        'score', ps.score,
        'winner', ps.winner,
        'position', ps.position
      )
    )
    FROM play_scores ps
    JOIN players pl ON ps.player_id = pl.id
    WHERE ps.play_id = p.id
  ) AS players
FROM plays p
LEFT JOIN games g ON p.game_id = g.id
LEFT JOIN (
  SELECT play_id, COUNT(*) AS ps_count
  FROM play_scores
  GROUP BY play_id
) ps ON p.id = ps.play_id
WHERE p.id IN (
  '691e03bd-c008-4582-ad68-51168a59f4d4',
  '609aabce-3117-41e7-a4d1-08d7b2516585'
)
ORDER BY p.played_at DESC;

-- ============================================
-- QUERY 7: Elimina partite problematiche (ATTENZIONE: IRREVERSIBILE!)
-- ============================================
-- Prima di eseguire questa query, verifica che i risultati siano corretti!
-- Sostituisci gli ID con quelli delle partite che vuoi eliminare

-- Uncommenta la riga seguente per eliminare le partite specifiche:
-- DELETE FROM plays WHERE id IN ('691e03bd-c008-4582-ad68-51168a59f4d4', '609aabce-3117-41e7-a4d1-08d7b2516585');

-- Oppure elimina tutte le partite senza play_scores:
-- DELETE FROM plays WHERE NOT EXISTS (SELECT 1 FROM play_scores ps WHERE ps.play_id = plays.id);

-- ============================================
-- ISTRUZIONI PER L'USO
-- ============================================
-- 
-- 1. Vai al dashboard di Supabase (https://supabase.com/dashboard)
-- 2. Seleziona il tuo progetto
-- 3. Vai su "SQL Editor" nel menu laterale
-- 4. Copia e incolla una delle query sopra
-- 5. Clicca su "Run" per eseguire la query
-- 6. Analizza i risultati
-- 
-- Per le partite problematiche:
-- - Se hanno 0 punteggi: verifica se sono partite di test o errate, poi eliminale
-- - Se hanno 1 punteggio: aggiungi almeno un altro giocatore o elimina la partita
-- 
-- Per eliminare le partite problematiche:
-- - Usa la QUERY 7 (ATTENZIONE: è irreversibile!)
-- - Assicurati di aver verificato i risultati prima di eliminare
