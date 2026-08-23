# Migrazioni Supabase

Storico delle migrazioni del database, versionato con convenzione Supabase
(`<timestamp>_<nome>.sql`, applicate in ordine crescente).

## Come è stato creato questo storico

Le migrazioni esistevano già come file SQL applicati manualmente (SQL Editor
o CLI) con nomi liberi e senza timestamp, e la cartella era esclusa da git.
In Fase 1 del piano di remediazione del debito tecnico
(`TECH_DEBT_AUDIT.md`, TD-009) sono state:

- rinominate con prefisso timestamp nell'ordine logico di dipendenza
  (tabelle base → colonne → rating ELO → policy RLS → job notturno);
- il file `diagnostics_problematic_plays.sql` (query diagnostiche, nessun
  effetto sullo schema) è stato spostato in `supabase/` fuori da questa
  cartella;
- riportate sotto controllo di versione insieme a `supabase/config.toml`.

**Nota**: le migrazioni 11–15 (policy RLS) si sovrascrivono a vicenda e
raccontano una decisione invertita più volte. Lo stato finale di un replay
completo è: lettura pubblica (`USING (true)`) su plays e elo_history.

**Decisione formalizzata (2026-08-23, TD-006 opzione 3)**: la lettura pubblica
di tutte le tabelle dati è una scelta di prodotto intenzionale — statistiche
condivise del gruppo — non un disallineamento. Le scritture restano
private per utente. Se in futuro si vorrà una modalità privata, aggiungere
una colonna di visibilità (es. `is_public`) e policy dedicate, senza toccare
questo storico.

## Allineamento con il database remoto (da fare una volta)

Le migrazioni storiche sono già applicate in produzione: un `supabase db
push` su un progetto con storico CLI parziale tenterebbe di riapplicarle.
Dopo il primo `supabase link --project-ref <ref>`:

1. Verifica lo storico remoto esistente:

   ```
   supabase migration list
   ```

2. Se compaiono versioni "non applicate" che in realtà esistono già nel DB
   (le vecchie applicazioni manuali), markale come applicate:

   ```
   supabase migration repair --status applied <versione> ...
   ```

3. Genera una migrazione di allineamento con lo stato reale del DB remoto
   (tabelle/policy drift non tracciati) e verificala prima di committarla:

   ```
   supabase db pull
   ```

4. Verifica finale delle policy effettive in produzione:

   ```sql
   SELECT tablename, policyname, cmd, qual
   FROM pg_policies
   WHERE schemaname = 'public'
   ORDER BY tablename, cmd;
   ```

Da qui in poi: ogni modifica allo schema parte da qui con
`supabase migration new <nome>`.
