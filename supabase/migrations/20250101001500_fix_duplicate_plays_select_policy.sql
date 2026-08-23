-- Fix: rimuove la policy SELECT ridondante su plays che conviveva con "Public can view plays".
--
-- PROBLEMA: Dopo le migration succedutesi, sulla tabella plays coesistevano due
-- policy SELECT permissive:
--   1. "Users can view their own plays"  → USING (auth.uid() = user_id)
--   2. "Public can view plays"           → USING (true)
--
-- In PostgreSQL le policy permissive vengono combinate con OR, quindi la riga è
-- visibile se ALMENO UNA è soddisfatta. Avere entrambe è ridondante (true è un
-- superset di auth.uid() = user_id), MA nelle query UPDATE...RETURNING di PostgREST
-- la doppia policy può causare row duplication nel result set restituito al client.
-- Questo provoca l'errore 406 "Cannot coerce the result to a single JSON object"
-- quando si usa .single() sull'UPDATE.
--
-- FIX: mantenere una sola policy SELECT. Viene mantenuta "Public can view plays"
-- (USING true) poiché è l'ultima impostazione intenzionale (enable_public_read_access.sql).
-- Se vuoi accesso privato, inverti: droppla e ricrea "Users can view their own plays".

DROP POLICY IF EXISTS "Users can view their own plays" ON plays;

-- Verifica stato finale (diagnostico)
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'plays'
ORDER BY cmd, policyname;
