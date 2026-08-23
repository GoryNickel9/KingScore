-- Tracciamento delle esecuzioni del job notturno di ricalcolo ELO
-- (supabase/functions/nightly-elo-recalc).
--
-- Ogni esecuzione registra una riga: status "running" all'avvio, poi
-- "succeeded", "succeeded_with_errors" (alcuni utenti falliti) o "failed"
-- (nessun utente ricalcolato). La funzione usa questa tabella anche come
-- guardia anti-sovrapposizione (un "running" più recente di 10 minuti
-- blocca rilanci concorrenti).

CREATE TABLE IF NOT EXISTS elo_recalc_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',   -- running | succeeded | failed
  summary JSONB
);

CREATE INDEX IF NOT EXISTS idx_elo_recalc_runs_status_started
  ON elo_recalc_runs(status, started_at DESC);

-- Nessuna policy di accesso pubblico: la tabella è gestita solo
-- dall'Edge Function con service role (che bypassa RLS).
ALTER TABLE elo_recalc_runs ENABLE ROW LEVEL SECURITY;
