# Automazione dell'Aggiornamento ELO — Job Notturno a Mezzanotte
> Generato il 19 Agosto 2026 — Piano di implementazione per l'aggiornamento automatico dei punti ELO una volta al giorno a mezzanotte.

> **🟡 STATO: CODICE PRONTO, DEPLOY DA ESEGUIRE** — 19 Agosto 2026
>
> | Fase | Stato |
> |---|---|
> | Fase 0-1 — Core puro condiviso | ✅ fatto (`src/utils/elo/simulation.ts` + `src/utils/elo/recalc.ts`) |
> | Fase 2 — Edge Function | ✅ scritta (`supabase/functions/nightly-elo-recalc/`) con migrazione `add_elo_recalc_runs.sql` e README operativo |
> | Fase 3 — Deploy e schedule | ⬜ **da fare** (richiede dashboard/CLI: vedi il README della funzione) |
> | Fase 4-5 — Osservabilità e verifica end-to-end | ⬜ dopo il deploy |
>
> **Scostamento dal piano originale:** la guardia anti-sovrapposizione usa la tabella `elo_recalc_runs` (insert "running" + controllo di freschezza) invece dell'advisory lock §7 — i lock di sessione PostgreSQL non sono affidabili su HTTP connessioni in pool (le chiamate rpc successive possono cadere su sessioni diverse), mentre la riga di tracciamento è atomica e ispezionabile. La funzione verifica anche che il JWT chiamante abbia `role = service_role`, così nemmeno l'anon key può lanciarla.

---

## Indice
1. [Contesto e Obiettivo](#1-contesto-e-obiettivo)
2. [Stato Attuale](#2-stato-attuale)
3. [Requisiti](#3-requisiti)
4. [Opzioni Valutate](#4-opzioni-valutate)
5. [Soluzione Consigliata — Edge Function Supabase Pianificata](#5-soluzione-consigliata--edge-function-supabase-pianificata)
6. [Sicurezza](#6-sicurezza)
7. [Concorrenza, Idempotenza e Consistenza](#7-concorrenza-idempotenza-e-consistenza)
8. [Limiti della Piattaforma](#8-limiti-della-piattaforma)
9. [Fasi di Implementazione](#9-fasi-di-implementazione)
10. [Rischi e Mitigazioni](#10-rischi-e-mitigazioni)
11. [Criteri di Accettazione](#11-criteri-di-accettazione)
12. [Stima dell'Impegno](#12-stima-dellimpegno)
13. [Sinergie con l'Ottimizzazione delle Performance](#13-sinergie-con-lottimizzazione-delle-performance)

---

## 1. Contesto e Obiettivo

L'app (React + Vite, deploy su Vercel, backend Supabase) calcola i rating ELO dei giocatori **esclusivamente lato client**, in `src/utils/eloCalculator.ts`. Oggi i punti si aggiornano solo in seguito ad azioni dell'utente nell'interfaccia.

**Obiettivo:** un job automatico che ogni notte a mezzanotte (ora italiana) ricalcoli rating ELO per gioco, ELO Generale e cache dello storico (`elo_history`), così che classifiche e grafici siano sempre aggiornati anche senza aprire l'app né premere il pulsante manuale "Ricalcola Tutti gli ELO".

---

## 2. Stato Attuale

L'ELO viene aggiornato oggi in tre modi, tutti legati all'uso dell'interfaccia:

| Trigger | Codice | Cosa fa |
|---|---|---|
| Registrazione/import di una partita | `src/pages/AddPlay.tsx:493`, `src/pages/Import.tsx` | `updateELOAfterGame` aggiorna `player_ratings` e `player_general_ratings` |
| Modifica di una partita | `src/pages/EditPlay.tsx` → `invalidateELOHistory` (`eloCalculator.ts:1078`) | Invalida l'intera cache `elo_history`; il ricalcolo avviene pigramente alla prossima visita di Stats |
| Pulsante manuale | `src/pages/ELO.tsx:170` (`handleRecalculateAll`) | Ricalcolo completo per tutti i giochi + ELO Generali |

Vincoli architetturali rilevanti:

- **Non esiste codice server.** `vercel.json` contiene solo il rewrite SPA; non ci sono funzioni Vercel né cartella `supabase/functions`.
- **RLS attivo** sulle tabelle (`plays`, `play_scores`, `player_ratings`, `player_general_ratings`, `elo_history`): il client scrive con il token dell'utente. Un job server dovrà usare la **service role key** che bypassa RLS.
- **Struttura multi-utente** (`user_id` su plays/players/elo_history): il job deve processare tutti gli utenti distinti presenti in `plays`, non solo uno.
- **Cache `elo_history`** con flag `is_general` e `user_id` (migrazione `supabase/migrations/add_elo_history.sql`): il job notturno deve rigenerarla in modo coerente con la invalidazione attuale.

---

## 3. Requisiti

**Funzionali**
- Ricalcolo completo e automatico, una volta al giorno a mezzanotte **ora di Roma** (Europe/Rome), per tutti gli utenti.
- Ricalcola: `player_ratings` (per gioco), `player_general_ratings`, `elo_history` (specifica per gioco e generale).
- Risultati **identici** al ricalcolo manuale attuale (stesso algoritmo, stesso ordinamento, stessa assegnazione posizioni).

**Non funzionali**
- Durata dell'esecuzione ben dentro i limiti di piattaforma (v. §8).
- Nessuna chiave privilegiata nel codice frontend o nel repository.
- Esecuzione sicura in concorrenza con modifiche utente (v. §7).
- Log di esecuzione verificabili e notifica in caso di fallimento.

---

## 4. Opzioni Valutate

| Opzione | Come funziona | Pro | Contro |
|---|---|---|---|
| **A. Edge Function Supabase pianificata** *(consigliata)* | Funzione TypeScript (Deno) su Supabase, schedulata via dashboard/pg_cron | Logica TS riusabile quasi tale e quale; tutto su Supabase; schedule con timezone; service role disponibile come env nativa | Un primo extraction della logica è comunque necessario |
| B. pg_cron + funzione PL/pgSQL | Job dentro Postgres che esegue una funzione SQL | Zero servizi esterni, transazionale | Riscrittura completa dell'algoritmo in SQL: costosa e a rischio drift rispetto al TS |
| C. Vercel Cron + Serverless Function | `crons` in `vercel.json` chiama un'API route | Deploy già su Vercel | Piano Hobby: max 1 esecuzione/giorno e orario non garantito al minuto; richiede comunque la funzione server + service role key su Vercel; solo UTC |
| D. GitHub Actions pianificato | Workflow `schedule` che lancia uno script Node | Gratuito, flessibile | Solo UTC (slitta col DST); segreto service role su GitHub; un pezo infrastrutturale in più da mantenere; parte solo se il runner è disponibile |

**Perché A:** minimizza il lavoro (riuso del TypeScript esistente anziché riscrittura in SQL), elimina dipendenze esterne (niente segreti su Vercel/GitHub), e la dashboard Supabase permette di specificare `Europe/Rome` risolvendo il problema dell'ora legale. Le alternative B/C/D sono documentate sopra per completezza; B in particolare è la scelta giusta **solo se** in futuro si vorrà atomicità transazionale completa a costo di una doppia implementazione dell'algoritmo.

---

## 5. Soluzione Consigliata — Edge Function Supabase Pianificata

### 5.1 Architettura

```
Schedule Supabase (Europe/Rome, 00:00)
        │
        ▼
Edge Function "nightly-elo-recalc"  (Deno, TypeScript)
        │  service role key (env nativa SUPABASE_SERVICE_ROLE_KEY)
        │  1. SELECT distinct user_id FROM plays
        │  2. per ogni utente: un'unica lettura bulk di plays + play_scores + players
        │  3. simulazione ELO completa in memoria (riuso del core di eloCalculator)
        │  4. scritture bulk: player_ratings, player_general_ratings, elo_history
        ▼
Database aggiornato ── la mattina dopo l'app mostra tutto già fresco
```

### 5.2 Riuso della logica (passo chiave)

`eloCalculator.ts` mescola due responsabilità: **calcolo puro** (le funzioni `calculate*`: matematica pura, già riusabile così com'è) e **persistenza** (le funzioni `update*`/`get*`: usano il client supabase-js del browser e `import.meta.env`).

Piano di estrazione:

1. Creare un **modulo core puro** (es. `src/utils/elo/simulation.ts`): funzioni che ricevono l'elenco partite/punteggi e restituiscono rating finali + storico, **senza alcun accesso al DB**. Gran parte del corpo di `getGeneralELOHistory` e `getELOHistoryForGame` (la parte simulazione, `eloCalculator.ts:696-798` e `859-1040`) si sposta qui quasi senza modifiche.
2. Il **frontend** usa il core puro e mantiene i suoi percorsi di persistenza attuali (nessun cambio di comportamento per l'utente).
3. L'**Edge Function** importa lo stesso core puro (Deno supporta import da percorsi relativi nel bundle della funzione) e implementa solo la lettura/scrittura bulk con service role.

Questo garantisce **una sola fonte di verità** per l'algoritmo: client e server non possono divergere. L'alternativa — duplicare la logica dentro la funzione — è sconsigliata: il drift tra le due copie produrrebbe rating incoerenti tra ricalcolo manuale e notturno.

### 5.3 Configurazione dello schedule

- Via **dashboard**: Edge Functions → funzione → *Schedules* → tutti i giorni alle 00:00, timezone **Europe/Rome**. La dashboard genera per conto tuo una entry `pg_cron` (visibile poi in *Database → Cron*).
- Via **SQL** (equivalente programmatico, da mettere in una migrazione per tracciabilità):

```sql
-- Bozza illustrativa: pg_cron opera in UTC; 00:00 Europe/Rome
-- corrisponde a 22:00 UTC (CEST, estate) / 23:00 UTC (CET, inverno).
-- Se si usa questo percorso manuale, gestire il DST; con la dashboard
-- il timezone è nativo e questa complessità scompare.
select cron.schedule('nightly-elo-recalc', '0 22 * * *', $$
  select net.http_post(
    url    := 'https://<PROJECT_REF>.supabase.co/functions/v1/nightly-elo-recalc',
    headers:= '{"Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb
  );
$$);
```

> Nota: modificare/eliminare entry cron esistenti non è coperto da `supabase/migrations` automaticamente; se si crea via SQL, tracciare anche una migrazione di rimozione/aggiornamento.

### 5.4 Struttura della funzione (bozza delle responsabilità)

La funzione deve, in ordine:

1. Rifiutare richieste non autenticate (v. §6).
2. Acquisire un **advisory lock** PostgreSQL (v. §7) per evitare esecuzioni sovrapposte.
3. Elencare gli `user_id` distinti da `plays`.
4. Per ogni utente: lettura bulk di `plays` + `play_scores` + `players` (una query con join, come già fa `getGeneralELOHistory`), simulazione con il core puro, poi:
   - upsert massivo di `player_ratings` (chiave `player_id + game_id`);
   - upsert massivo di `player_general_ratings` (chiave `player_id + user_id`);
   - delete + insert massivi di `elo_history` per quell'utente (coerente con `invalidateELOHistory`).
5. Rilasciare il lock, loggare un riepilogo (utenti processati, partite, durata).

L'approccio "simula tutto in memoria, scrivi in blocco" è lo stesso descritto in `docs/ottimizzazione-calcolo-elo-generale.md`: senza di esso, il job notturno erediterebbe le migliaia di richieste sequenziali del ricalcolo manuale attuale e sforerebbe i limiti di esecuzione.

---

## 6. Sicurezza

- **verify_jwt attivo**: Supabase invoca le funzioni pianificate con credenziali interne firmate; le invocazioni esterne senza JWT valido vengono rifiutate. Lasciare la protezione attiva e non esporre la funzione pubblicamente.
- **Service role key**: nelle Edge Functions è disponibile come variabile d'ambiente nativa (`SUPABASE_SERVICE_ROLE_KEY`); non va mai copiata nel codice, nel repository, né in variabili `VITE_*` del frontend. Questa chiave **bypassa RLS**: la funzione deve usarla solo per le operazioni del job e filtrare sempre esplicitamente per `user_id`.
- **Psw.txt nel repository**: già segnalato in `docs/codebase-review.md` — non correlato a questo job, ma vale la regola generale: nessun segreto nel repo.
- **Multi-utente**: con RLS bypassato è responsabilità della funzione non mescolare i dati tra utenti (processare un utente alla volta e filtrare ogni lettura/scrittura per `user_id`).

---

## 7. Concorrenza, Idempotenza e Consistenza

- **Sovrapposizione di esecuzioni**: improbabile a mezzanotte, ma possibile (rilancio manuale, retry). Mitigazione: advisory lock di sessione (es. `pg_try_advisory_lock`) all'inizio; se il lock è occupato, la seconda esecuzione termina subito con esito "skipped".
- **Modifica utente durante il job** (utente sveglio a mezzanotte che registra una partita): la sequenza delete-then-insert di `elo_history` e gli upsert idempotenti rendono il risultato finale corretto alla successiva esecuzione; in aggiunta si può schedulare il job poco dopo mezzanotte (es. alle 00:15) per minimizzare la finestra. Alternative più elaborate (code, transazioni) sono sproporzionate per un'app personale.
- **Idempotenza**: ogni esecuzione parte dai dati raw (`plays`/`play_scores`), che sono la fonte di verità, e ricostruisce tutto: rieseguire il job produce sempre lo stesso risultato. È la proprietà più importante da preservare in qualsiasi implementazione.
- **Coerenza con `invalidateELOHistory`**: il job deve rigenerare `elo_history` con gli stessi criteri (flag `is_general`, `games_played` valorizzato solo per il generale, `user_id` sempre impostato).

---

## 8. Limiti della Piattaforma

| Limite | Valore indicativo (piano free) | Impatto e mitigazione |
|---|---|---|
| Wall-clock Edge Function | ~150 s per esecuzione | Con lettura bulk + simulazione in memoria + scritture massive, un intero storico personale (centinaia/migliaia di partite) si processa in pochi secondi: margine ampio |
| Invocations | 500K/mese inclusi | 1-esecuzione/giorno = ~30/mese: irrilevante |
| Timeout HTTP del client | n/d (job server-side) | Non applicabile: la funzione gira su Supabase, non dal browser |

Da verificare sul piano effettivo in essere al momento dell'implementazione.

---

## 9. Fasi di Implementazione

- [ ] **Fase 0 — Prerequisito:** completare (o procedere in parallelo con) l'estrazione del core puro di calcolo descritta in `docs/ottimizzazione-calcolo-elo-generale.md` — il job notturno dipende da un percorso di ricalcolo bulk efficiente.
- [ ] **Fase 1 — Estrazione core puro:** modulo di simulazione senza dipendenze da supabase-js né da `import.meta.env`; il frontend continua a funzionare senza cambi percepibili.
- [ ] **Fase 2 — Edge Function:** `supabase/functions/nightly-elo-recalc/` con struttura del §5.4; test di uguaglianza: risultato della funzione == risultato del pulsante manuale sugli stessi dati.
- [ ] **Fase 3 — Deploy e schedule:** deploy della funzione (`supabase functions deploy`), schedule giornaliero alle 00:00 Europe/Rome via dashboard; verificare la entry generata in *Database → Cron*.
- [ ] **Fase 4 — Osservabilità:** log di riepilogo per esecuzione; (opzionale) notifica via email/webhook in caso di fallimento usando un webhook esterno già in proprio possesso.
- [ ] **Fase 5 — Verifica end-to-end:** invocazione manuale via dashboard, confronto rating prima/dopo, apertura dell'app e conferma che Stats mostri i dati da cache rigenerata.
- [ ] **Fase 6 — (Opzionale) Pulizia:** valutare se ridurre il ruolo del pulsante "Ricalcola Tutti gli ELO" (che resta comunque utile come fallback manuale e per il ricalcolo a caldo dopo una modifica).

---

## 10. Rischi e Mitigazioni

| Rischio | Probabilità | Impatto | Mitigazione |
|---|---|---|---|
| Drift tra logica client e server | Media | Alto (rating incoerenti) | Unico modulo core puro condiviso; test di parità automatico in Fase 2 |
| Service role key esposta | Bassa | Alto | Solo env nativa della funzione; mai in repo/frontend; verify_jwt attivo |
| Job fallisce silenziosamente | Media | Medio (dati stale senza accorgersene) | Log di riepilogo + notifica fallimenti; il pulsante manuale resta come recovery |
| Sovrapposizione con modifiche utente | Bassa | Basso | Advisory lock; scheduling a 00:15; idempotenza per costruzione |
| Slittamento ora legale | — (risolto) | — | Schedule con timezone Europe/Rome via dashboard; se via SQL crudo, mappare manualmente CET/CEST |
| Limiti di esecuzione superati | Bassa | Medio | Approccio bulk (§5.4); monitorare la durata nei log nelle prime settimane |

---

## 11. Criteri di Accettazione

1. Il job esegue ogni giorno all'ora italiana corretta (verificare nei log sia in periodo CEST che CET, oppure confidence dalla configurazione timezone).
2. Dopo un'esecuzione notturna senza attività utente, i valori in `player_ratings`, `player_general_ratings` ed `elo_history` coincidono con quelli prodotti dal ricalcolo manuale sugli stessi dati.
3. La pagina Stats apre al mattino usando la cache rigenerata, senza ricalcolo client visibile.
4. Una seconda invocazione concorrente termina come "skipped" senza corrompere dati.
5. Nessun segreto nel repository o nel bundle frontend.

---

## 12. Stima dell'Impegno

| Fase | Stima |
|---|---|
| Estrazione core puro (condivisa col piano performance) | 3–5 ore |
| Edge Function + test di parità | 2–3 ore |
| Deploy, schedule, verifica end-to-end | 1–2 ore |
| Osservabilità e raffinamenti | 1 ora |
| **Totale** | **~7–11 ore** (di cui circa metà in comune con il piano di ottimizzazione) |

---

## 13. Sinergie con l'Ottimizzazione delle Performance

Questo piano **dipende** dal percorso bulk descritto in `docs/ottimizzazione-calcolo-elo-generale.md`:

- il core puro estratto per le performance è lo stesso che l'Edge Function riusa;
- le scritture massive sono ciò che tiene il job dentro i limiti di esecuzione;
- l'ordine consigliato è: prima l'estrazione/ottimizzazione lato client, poi il job notturno.

Viceversa, una volta disponibile l'Edge Function, il job notturno può diventare il ricalcolo "ufficiale" quotidiano e il pulsante manuale restare solo per correzioni a caldo — semplificando la manutenzione futura della logica client.
