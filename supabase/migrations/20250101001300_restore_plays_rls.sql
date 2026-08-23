-- Ripristina le policy RLS originali per la tabella plays
-- Rimuove le policy pubbliche e ripristina le policy per gli utenti

-- Elimina la policy pubblica per la tabella plays
DROP POLICY IF EXISTS "Public can view plays" ON plays;

-- Ripristina la policy originale per la tabella plays
DROP POLICY IF EXISTS "Users can view their own plays" ON plays;
CREATE POLICY "Users can view their own plays"
  ON plays FOR SELECT
  USING (auth.uid() = user_id);

-- Nota: Le altre policy (INSERT, UPDATE, DELETE) dovrebbero essere già presenti
-- e non sono state modificate dalla migrazione enable_public_read_access.sql
