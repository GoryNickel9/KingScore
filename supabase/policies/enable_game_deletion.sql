-- ─── Policy RLS per permettere l'eliminazione dei giochi ──────────────────────

-- Abilita RLS sulla tabella games se non è già abilitato
ALTER TABLE games ENABLE ROW LEVEL SECURITY;

-- Policy per permettere agli utenti autenticati di eliminare giochi
-- Questa policy permette a qualsiasi utente autenticato di eliminare qualsiasi gioco
-- Modifica questa policy se vuoi limitare l'eliminazione solo ai giochi creati dall'utente

CREATE POLICY "Allow authenticated users to delete games"
ON games
FOR DELETE
TO authenticated
USING (true);

-- Se vuoi limitare l'eliminazione solo ai giochi creati dall'utente,
-- usa invece questa policy (scommenta e rimuovi quella sopra):

-- CREATE POLICY "Allow users to delete their own games"
-- ON games
-- FOR DELETE
-- TO authenticated
-- USING (
--   -- Nota: questa policy richiede che la tabella games abbia una colonna user_id
--   -- Se non esiste, dovrai aggiungerla prima:
--   -- ALTER TABLE games ADD COLUMN user_id UUID REFERENCES auth.users(id);
--   user_id = auth.uid()
-- );

-- Policy per permettere agli utenti autenticati di eliminare le partite associate
-- Questo è necessario perché eliminiamo le partite prima di eliminare il gioco

CREATE POLICY "Allow authenticated users to delete plays when deleting game"
ON plays
FOR DELETE
TO authenticated
USING (true);

-- Verifica le policy create
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename IN ('games', 'plays')
ORDER BY tablename, policyname;
