# RPC partite: prove locali

Questa suite crea un cluster PostgreSQL separato su `127.0.0.1`, applica uno schema sintetico ricavato dal catalogo Supabase auditato il 13 ottobre 2026 e verifica la sola migrazione `20261013000000_atomic_play_writes.sql`. Non usa `.env`, connessioni Supabase, password o dati di produzione. Le claim sono simulate: queste prove non verificano la firma JWT o il gateway HTTP.

Da PowerShell 7 nella radice di King-Score, con PostgreSQL 17 e Node 24 installati:

```powershell
pwsh -NoProfile -File scripts/test-atomic-plays.ps1 -ConcurrentScript "$PWD/supabase/tests/atomic_play_concurrency.mjs"
```

Il runner avvia un cluster univoco, esegue fixture, migrazione, test SQL e prove concorrenti, poi arresta il proprio server nel `finally`. Log e report restano in `.work/atomic-play-tests/<run>/`; aggiungere questo percorso a `.git/info/exclude` prima del primo avvio. Non pubblicare i file del cluster. `-BootstrapOnly` verifica solo il runner e restituisce `BOOTSTRAP_PASS`, distinto dal risultato della suite completa.

`atomic_play_writes.sql` verifica permessi, payload, revisioni, replay, rollback, campi conservati e cascade. `atomic_play_concurrency.mjs` apre sessioni SQL distinte, mette le richieste in attesa su un lock e verifica le collisioni create/update/delete. Confronta inoltre il ranking SQL con la funzione web effettiva `src/utils/elo/positions.ts`: nessuna copia della funzione di riferimento.

Update conserva le posizioni quando ID/player/score/winner, modalità ed esito team restano invariati, anche se la lista cambia ordine. Modifiche a note, color e role non riclassificano i pareggi. V1 non offre riordino manuale; un cambiamento dei dati che determinano il ranking applica il sort al nuovo input.

## Limiti della preparazione

La migrazione è additiva e non è stata deployata. I writer web `AddPlay`, `EditPlay`, `PlayDetail`, l'import BGA e `replace_play_scores` usano ancora operazioni separate: prima del rollout Android devono adottare transazioni e ordine dei lock compatibili. Le prove fra RPC non garantiscono atomicità dei writer legacy. Non revocare INSERT/UPDATE/DELETE al sito prima di aver completato tale adeguamento.

Le RPC V1 accettano da 1 a 63 partecipanti e payload fino a 1 MiB. Il limite del ranking consente di riprodurre il percorso V8 per piccoli array, inclusa la comparazione non transitiva dei punteggi nulli che l'utente ha chiesto di mantenere. Un input oltre il limite viene rifiutato, senza troncamento; le letture storiche non cambiano. NUMERIC conserva il valore ricevuto, mentre il confronto usa Float64 come il sito. Overflow e underflow non rappresentabili sono rifiutati. Altri motori JavaScript e array maggiori richiedono una specifica ulteriore: non presumere equivalenza universale del comparator con NULL.

`PT404` e `PT409` dichiarano gli status HTTP 404 e 409 secondo la [documentazione PostgREST](https://docs.postgrest.org/en/v12/references/errors.html). Il test HTTP resta da eseguire nel Supabase isolato. Il server richiede sempre `auth.uid()` e il ruolo admin in `app_metadata`, anche prima del replay; la ricevuta privata sopravvive alla cancellazione della partita e viene eliminata con l'account.

La migrazione rimuove soltanto il trigger `update_play_scores_updated_at`, incompatibile con lo schema reale, e revoca TRUNCATE/REFERENCES/TRIGGER a anon/authenticated su plays e play_scores. Mantiene le policy, le letture e le scritture ordinarie del sito. Nessuna RPC invoca o ricalcola ELO. Il DELETE conserva le cascade esistenti, compresa quella su elo_history; i rating possono restare precedenti ai dati modificati.

Prima del deploy verificare nuovamente il catalogo dell'ambiente di destinazione: le migrazioni storiche del repository non sono una ricostruzione affidabile del database auditato. Non eseguire un push indiscriminato delle vecchie migrazioni.
