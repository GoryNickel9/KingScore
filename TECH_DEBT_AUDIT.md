# Audit Debito Tecnico TypeScript — BGStats

**Data audit:** 2026-08-23
**Ambito:** intero codebase (`src/`, `supabase/`, `scripts/`, config di build)
**Strumento:** analisi statica/architetturale tramite agente TypeScript-Tech-Debt-Specialist
**Livello di debito complessivo:** 🟠 **MEDIO-ALTO**, con un difetto di correttezza **critico** nella pipeline ELO incrementale

> **Nota sul contesto**: il progetto NON è Next.js. È una SPA **Vite + React 19 + react-router-dom 7**, con Supabase come BaaS (DB, Auth, Storage, una Edge Function Deno `nightly-elo-recalc`). L'audit è stato condotto su questa struttura reale.

## Punti di forza da preservare

Non tutto è debito. Il progetto ha scelte architetturali corrette che vanno difese durante il refactoring:

- Il core ELO puro in `src/utils/elo/simulation.ts` è ben isolato, zero-dipendenze, condiviso tra frontend ed Edge Function.
- Il ricalcolo bulk (`src/utils/elo/recalc.ts`) è idempotente e documentato.
- Esiste un golden test di parità (`scripts/compare-elo.ts`).
- `tsconfig.json` ha `strict: true`.
- La guardia anti-sovrapposizione del job notturno (`elo_recalc_runs`) è un buon pattern.

## ⚡ Azione più urgente

**TD-001** — l'aggiunta di una partita calcola l'ELO con rating iniziali hardcoded (1000/K=48) invece dei rating correnti, corrompendo i rating fino al ricalcolo notturno. Fix suggerito in Fase 0 della roadmap.

---

## 1. Registro del debito tecnico (priorizzato per Impatto × Probabilità)

| ID | Titolo | Categoria | Severità | Evidenza | Sforzo | Rischio |
|----|--------|-----------|----------|----------|--------|---------|
| TD-001 | ELO incrementale calcolato da rating hardcoded (1000/0), sovrascrive i rating reali | Correttezza | **Critica** (25) | `src/pages/AddPlay.tsx:482-493`, `src/pages/Import.tsx:557-568`, `src/utils/eloCalculator.ts:85-141` | M | Basso |
| TD-009 | Migrazioni non versionate: `supabase/migrations/` in `.gitignore`, tracking parziale, nomi senza timestamp, migrazioni contraddittorie | Operativo/Tooling | Alta (16) | `.gitignore:56-62`; 10/20 file tracciati via git | M | Medio |
| TD-021 | Zero test automatizzati; nessuna CI; core ELO puro (testabilissimo) non testato | Testing | Alta (16) | `package.json` (nessun runner), nessuna cartella test, no `.github/` | M | Basso |
| TD-006 | RLS SELECT `USING (true)` su tutte le tabelle dati: ogni utente anonimo legge i dati di tutti gli utenti | Sicurezza | Alta se non intenzionale (15) | `supabase/migrations/enable_public_read_access.sql:5-38`, `repair_rls_policies.sql:16-22` | M | Medio |
| TD-010 | Tipi duplicati: `DbGame/DbPlayer/DbPlay/DbPlayScore` ridefiniti in 12+ pagine; nessun tipo generato dal DB; ~40 assertion `as` | Type safety | Alta (15) | `src/pages/*.tsx` (28 definizioni locali), `src/types/index.ts` in disuso | L | Basso |
| TD-002 | Ricalcolo ELO bulk non transazionale: delete→insert multipli senza rollback; job notturno senza isolamento per utente | Correttezza/Resilienza | Alta (12) | `src/utils/elo/recalc.ts:127-208`, `supabase/functions/nightly-elo-recalc/index.ts:92-99` | M | Medio |
| TD-003 | Import BGA: lookup giochi senza filtro `user_id` su tabella a lettura pubblica → collegamento cross-tenant | Sicurezza/Correttezza | Alta (12) | `src/pages/Import.tsx:501-502` | S | Basso |
| TD-005 | Cache ELO non invalidata dopo Import e dopo eliminazione partita → statistiche stantie fino al job notturno | Correttezza | Media (12) | `src/pages/Import.tsx` (nessun uso di `invalidateELOHistory`), `src/pages/PlayDetail.tsx:148-163` | S | Basso |
| TD-015 | Errori gestiti solo con `console.error` o `catch` vuoti: UI silente su fallimenti dati e invalidazioni cache | Affidabilità/UX | Media (12) | `src/pages/Stats.tsx:397-398`, `AddPlay.tsx:495`, `EditPlay.tsx:293`, `eloCalculator.ts:150-153` | M | Basso |
| TD-022 | God-components: AddPlay 1060 righe, Stats 923, Wrapped 761, Import 695 con logica business dentro i componenti React | Architettura | Media (12) | `src/pages/AddPlay.tsx:410-462` (posizioni), `Import.tsx:476-593` | L | Medio |
| TD-018 | Import: pattern N+1 massiccio (~7-10 query per partita, sequenziali) | Performance | Media (12) | `src/pages/Import.tsx:492-573`, `eloCalculator.ts:91-155` | M | Medio |
| TD-011 | `any` espliciti e doppie assertion `as unknown as` sulle query Supabase | Type safety | Media (10) | `src/utils/eloCalculator.ts:236`, `src/utils/diagnosePlays.ts:26,71,127`, `AddPlay.tsx:215`, `recalc.ts:151,167,208` | S | Basso |
| TD-020 | Edge function: legge fino a 10.000 righe di `plays` per ottenere i `user_id` distinti | Performance | Media (10) | `supabase/functions/nightly-elo-recalc/index.ts:82-89` | S | Basso |
| TD-017 | Troncamento silenzioso righe: `Dashboard.tsx` query mensili senza `.limit()` (cap di default 1000), fix già applicata altrove ma non qui | Correttezza/Performance | Media (9) | `src/pages/Dashboard.tsx:113-117` vs commento in `Stats.tsx:166-167` | S | Basso |
| TD-025 | Copertura type-check parziale ed ESLint non type-aware: `tsc --noEmit` esclude `scripts/`; `no-floating-promises` non attivabile | Tooling | Media (8) | `tsconfig.json:33`, `eslint.config.js:28-34` | S | Basso |
| TD-023 | Dead code: `diagnosePlays.ts` mai importato, parametri morti, export inutilizzati, migrazioni duplicate al 95% | Manutenibilità | Bassa (8) | `src/utils/diagnosePlays.ts` (241 righe), `imageUpload.ts:100,121` | S | Basso |
| TD-016 | Nessun timeout/retry su fetch BGG/BGA e chiamate Supabase | Resilienza | Media (6) | `src/pages/AddPlay.tsx:180-204`, `Import.tsx` (fetchBGG) | M | Medio |
| TD-004 | EditPlay: delete+insert di `play_scores` non atomico → rischio perdita punteggi | Correttezza | Media (6) | `src/pages/EditPlay.tsx:266-284` | M | Medio |
| TD-014 | Nessun AbortController: fetch continuano dopo unmount/cambio rotta; race su richieste concorrenti | Affidabilità | Media (6) | 0 occorrenze di `AbortController` in `src/` | M | Basso |
| TD-019 | `updateELOAfterGame` read-modify-write non atomica (contatori incrementati lato client) | Correttezza/Concorrenza | Media (6) | `src/utils/eloCalculator.ts:103-140` | S | Basso |
| TD-008 | Edge function: verifica `service_role` senza firma; guardia anti-overlap TOCTOU; manca `config.toml` | Sicurezza/Operativo | Bassa (6) | `nightly-elo-recalc/index.ts:28-40,57-74`; no `supabase/config.toml` | M | Basso |
| TD-024 | Client Supabase singleton globale con env non validata; pagine importano il singleton direttamente | Architettura/DX | Bassa (6) | `src/lib/supabase.ts:3-16` | S | Basso |
| TD-012 | Contratti di ritorno mentitori: `getGeneralELO/updateGeneralELO` dichiarano camelCase ma restituiscono righe snake_case | Type safety | Bassa (6) | `src/utils/eloCalculator.ts:290,312,331` | S | Basso |
| TD-013 | Gestione errori eterogenea: `(error as Error).message` ripetuto 20+ volte senza helper | Manutenibilità | Bassa (5) | `AuthContext.tsx:59-89`, `Import.tsx:447-448,578-589` | S | Basso |
| TD-007 | `psw.txt` nella root del progetto (non tracciato da git) | Sicurezza | Nota (2) | `psw.txt` (30 byte) | S | Basso |
| TD-026 | **Nuovo (emerso nella Fase 2):** 5 pagine (AddPlay, Games, EditPlay, GameDetail, Images) elencano i giochi di TUTTI gli utenti (select senza filtro `user_id` su tabella a lettura pubblica). Stessa famiglia di TD-003/TD-006: da decidere insieme alla politica di visibilità | Sicurezza / Prodotto | Da valutare (dipende da TD-006) | `AddPlay.tsx:95`, `Games.tsx:67`, `EditPlay.tsx:113`, `GameDetail.tsx:45`, `Images.tsx:28` | S | Basso |

---

## 2. Findings dettagliati

### TD-001 — ELO incrementale calcolato da rating hardcoded 🔴 CRITICO

**Categoria:** Correttezza · **Confidenza:** Alta (direttamente osservabile)

**Problema.** Quando si registra una partita (UI o import BGA), l'aggiornamento ELO "a caldo" viene calcolato con `currentRating: 1000` e `gamesPlayed: 0` per tutti i giocatori, con il commento — falso — "Verrà aggiornato da updateELOAfterGame". `updateELOAfterGame` invece usa i valori passati così come sono:

```ts
// src/pages/AddPlay.tsx:482-490
const playersData = playersWithPositions.map(player => {
  return {
    playerId: player.playerId,
    currentRating: 1000, // "Verrà aggiornato da updateELOAfterGame" ← NON VERO
    gamesPlayed: 0,      // "Verrà aggiornato da updateELOAfterGame"
    ...
```

In `src/utils/eloCalculator.ts:88` il `calculateELOForGame(players)` usa `players` direttamente; la SELECT di `existingRating` (riga 92) avviene **dopo** il calcolo e serve solo a decidere update vs insert. La riga 108 scrive `rating: result.newRating` (≈1000+delta, K=48) **sovrascrivendo** il rating esistente.

**Conseguenze.**
- Ogni partita aggiunta dopo la prima resetta di fatto i rating del gioco verso ~1000 e usa sempre K=48.
- I contatori W/L/D vengono incrementati correttamente ma su rating sbagliati; `player_general_ratings` (media ponderata) eredita l'errore.
- Il dato sbagliato è visibile in UI (pagina ELO, PlayDetail) fino al ricalcolo notturno o manuale, che con `performFullRecalc` corregge tutto. L'errore è quindi "auto-riparante" una volta al giorno, ma persiste per ore e invalida la fiducia nel dato.

**Remediazione incrementale.**
1. **Passo sicuro immediato (S):** eliminare la strada a caldo. In `AddPlay.tsx` e `Import.tsx` sostituire `updateELOAfterGame(...)` con `performFullRecalc(supabase, user.id)` (già condiviso col job notturno, ~6-10 richieste) + `invalidateELOHistory`. Alternativa minimale: far leggere a `updateELOAfterGame` i rating correnti da `player_ratings` **prima** di chiamare `calculateELOForGame`.
2. **Intermedio:** se si vuole mantenere il percorso incrementale, SELECT in blocco di `player_ratings` per `player_id IN (...) AND game_id = X` e costruire i `PlayerInput` con i valori reali; upsert con `onConflict` invece di select+update.
3. **Finale:** rimuovere `updateELOAfterGame` o ridurlo a wrapper di `performFullRecalc`.

**Validazione:** unit test del nuovo flusso (fixture: 2 partite consecutive sullo stesso gioco, rating atteso = simulazione completa); confronto del rating mostrato in `/elo` subito dopo l'aggiunta di una partita con l'output di `npm run compare:elo`.
**Definition of done:** nessun `currentRating: 1000` hardcoded nei call-site; il rating post-inserimento coincide con `performFullRecalc` sullo stesso dataset.

---

### TD-002 — Ricalcolo bulk non transazionale + job notturno fragibile

**Categoria:** Correttezza / Resilienza operativa · **Confidenza:** Alta

**Problema (due livelli).**

A) `performFullRecalc` (`src/utils/elo/recalc.ts:127-208`) esegue, come richieste HTTP separate: delete a chunk di `player_ratings` (50 game_id per volta) → insert a batch di 500 → upsert `player_general_ratings` → delete totale `elo_history` → insert a batch. **Nessuna transazione**: un fallimento al batch 2 di 3 lascia i rating del gioco parzialmente ricostruiti (le delete sono già state eseguite).

B) `supabase/functions/nightly-elo-recalc/index.ts:92-99`: loop `for (const userId of userIds)` con un solo try/catch esterno — l'errore di un utente interrompe il ricalcolo di tutti i successivi; il run viene marcato `failed` senza indicare quali utenti sono rimasti indietro. Nessun retry sui batch.

**Conseguenze.** Rischio di dati ELO mancanti/parziali per interi giochi; il job fallisce "a metà" senza ripresa selettiva; diagnosi notturna difficile (solo `String(error)` nel summary).

**Remediazione incrementale.**
1. Isolare gli errori per utente nel loop dell'Edge Function: try/catch interno, raccogliere `{userId, error}`, marcare `succeeded_with_errors`, non bloccare gli utenti successivi (S, rischio basso).
2. Retry con backoff su batch falliti in `insertInBatches`/`upsertInBatches` (2-3 tentativi, esponenziale).
3. Spostare le scritture critiche in una **funzione RPC Postgres transazionale** (`SECURITY DEFINER` in schema non esposto, con verifica `auth.uid()`) che esegua delete+insert in un'unica transazione, oppure approccio "shadow": scrivere le nuove righe, poi switchare/eliminare le vecchie.

**Validazione:** test di inserimento batch fallito simulato (errore forzato al secondo batch) → verificare che al retry successivo lo stato torni consistente; log del job con conteggio utenti processati/falliti.
**DoD:** un fallimento a metà non lascia tabelle parzialmente svuotate; il report notturno elenca per-utente successi/fallimenti.

---

### TD-003 — Lookup giochi senza filtro utente nell'import (cross-tenant)

**Categoria:** Sicurezza / Correttezza dati · **Confidenza:** Alta

```ts
// src/pages/Import.tsx:501-502
const { data: existingGame } = await supabase.from('games').select('id')
  .eq('name', play.game_name).maybeSingle()   // ← manca .eq('user_id', user!.id)
```

I lookup di `plays` (riga 498) e `players` (riga 530) filtrano correttamente per `user_id`; solo `games` no. Con la policy SELECT `USING (true)` (TD-006) la query vede i giochi di **tutti** gli utenti.

**Conseguenze.** Un gioco con lo stesso nome di un altro utente viene riusato: la partita importata viene collegata al gioco altrui; statistiche e raggruppamento ELO per `game_id` mescolano dati di utenti diversi. Inoltre `.maybeSingle()` solleva un errore se esistono più giochi con lo stesso nome (due utenti con "Azul").

**Remediazione (S):** aggiungere `.eq('user_id', user!.id)` alla select.
**Validazione:** import con un nome di gioco già posseduto da altro utente → viene creato un gioco proprio; nessun 406 da `maybeSingle` su nomi duplicati cross-utente.

---

### TD-006 — Lettura pubblica di tutte le tabelle dati

**Categoria:** Sicurezza · **Confidenza:** Alta sul fatto; Media sull'intenzionalità

**Evidenza.** `supabase/migrations/enable_public_read_access.sql:5-38` e `enable_public_access_for_dashboard.sql` (quasi identica): `CREATE POLICY ... FOR SELECT USING (true)` su `games, plays, players, play_scores, player_ratings, player_general_ratings`; `add_elo_history.sql:49-51` e `repair_rls_policies.sql` fanno lo stesso. La UI è effettivamente pubblica (`src/App.tsx:40-112`: Dashboard, Plays, Games, Stats, ELO, Wrapped fuori dalla ProtectedRoute). `Stats.tsx:168-179` e `Dashboard.tsx:74-117` leggono **tutte** le partite di **tutti** gli utenti senza filtro `user_id` e mostrano aggregati globali.

**Conseguenze.** Chiunque con l'anon key legge nomi reali dei giocatori, storico partite con date/luoghi/note, rating. Se il prodotto è "statistiche pubbliche del gruppo" è una decisione legittima, ma: (a) `notes` e `location` di ogni partita sono dati potenzialmente personali esposti a chiunque su Internet; (b) le scritture restano private, quindi l'esposizione è solo di lettura; (c) le migrazioni contraddittorie (`restore_plays_rls.sql` ripristina l'accesso privato, `repair_rls_policies.sql` lo ri-rende pubblico) indicano che la decisione è stata invertita più volte senza una fonte di verità.

**Remediazione.**
1. Decisione esplicita e documentata: cosa è pubblico (aggregati dashboard) vs privato (note, luogo, giocatori).
2. Se serve solo la dashboard pubblica: creare una **view** con dati aggregati in schema esposto (o `security_invoker` + policy dedicate) e rimuovere `USING (true)` dalle tabelle base, filtrando le query client per `user_id` dove già presente.
3. Se invece è tutto volutamente pubblico: aggiungere policy con colonna di visibilità (`is_public`) per preparare una futura modalità privata, e rimuovere la migrazione contraddittoria dalla storia (vedi TD-009).

**Validazione:** con anon key e token di un utente B, verificare che la query su `plays` di A restituisca solo ciò che la policy decisa consente; `supabase db advisors` dopo le modifiche.

---

### TD-009 — Schema DB non versionato correttamente

**Categoria:** Operativo / Tooling · **Confidenza:** Alta

**Evidenza.**
- `.gitignore:56-62` ignora `supabase/migrations/` e `docs/`; `git ls-files supabase` mostra solo **10 migrazioni tracciate su 20** presenti su disco.
- Nomi file **senza timestamp** (`add_elo_history.sql`, `repair_rls_policies.sql`, `restore_plays_rls.sql`): l'ordine di applicazione non è deterministico dall'albero; `restore_plays_rls.sql` e `repair_rls_policies.sql` si contraddicono (vedi TD-006).
- Manca `supabase/config.toml`: schedule dell'Edge Function e `verify_jwt` esistono solo nella dashboard.

**Conseguenze.** Impossibile ricostruire l'ambiente (`supabase db reset`) in modo affidabile; il DB reale e il repo divergeranno (sta già divergendo); gli interventi RLS "al volo" in produzione non sono tracciabili; onboarding/disaster recovery bloccati.

**Remediazione.**
1. Rimuovere `supabase/migrations/` e `docs/` da `.gitignore`, rinominare le migrazioni esistenti con timestamp (`supabase migration new` e riclassificazione), committare tutto.
2. `supabase db pull` per generare una migrazione di allineamento con lo stato remoto effettivo e verificare le policy reali con una SELECT su `pg_policies`.
3. Creare `supabase/config.toml` con schedule + `verify_jwt = true` per l'Edge Function.

**Validazione:** `supabase db reset` locale produce uno schema con le stesse policy di `pg_policies` remote; `supabase migration list` senza conflitti.

---

### TD-021 — Nessun test automatizzato, nessuna CI

**Categoria:** Testing · **Confidenza:** Alta

**Evidenza.** Nessun test runner in `package.json`; nessuno script `test`; nessuna cartella di test; nessuna directory `.github/`. L'unico controllo di qualità è il golden test manuale `scripts/compare-elo.ts` (buono, ma richiede `.env.local` e dati reali nel DB, e non copre i percorsi di scrittura). Proprio il modulo più critico e più testabile — `src/utils/elo/simulation.ts`, puro, zero dipendenze — non ha unit test; **TD-001 è passato proprio perché non esisteva un test "seconda partita → rating ≠ reset"**.

**Remediazione.**
1. Aggiungere Vitest (S) e scrivere unit test di caratterizzazione su `simulation.ts`: K-factor, expected/actual score, posizioni assegnate, pari (`withAssignedPositions`), ELO Generale progressivo vs ricalcolo da zero (la proprietà OP3 già documentata nel codice).
2. Test su `performFullRecalc` con client Supabase mockato (l'interfaccia è già iniettata: buon punto di partenza).
3. CI minimale (GitHub Actions): `npm run lint && npx tsc --noEmit && vitest run && npm run build`.

**DoD:** pipeline verde su PR; suite ≥ 20 casi su simulation/recalc; `compare-elo` ancora esistente come verifica d'integrazione su dati reali.

---

### TD-010 / TD-011 / TD-012 — Type safety: tipi duplicati, `any`, contratti mentitori

**Categoria:** Type safety · **Confidenza:** Alta

**Evidenza.**
- **Duplicazione di massa**: `DbGame` definito in 8 file, `DbPlayer` in 11, `DbPlay`/`DbPlayScore` in 7+ (28 interfacce `Db*` locali in `src/pages/*`). Il file canonico `src/types/index.ts` è usato quasi solo da contexts/utils: le pagine definiscono varianti leggermente diverse (es. `Games.tsx:10` include `image_url`, `types/index.ts` usa `image`). `EloHistoryEntry` esiste in tre versioni incompatibili (`eloCalculator.ts:48`, `Stats.tsx:98`, `PlayDetail.tsx`).
- **Client non tipizzato**: `createClient` in `src/lib/supabase.ts:16` senza generic `Database` → ogni `.select()` ritorna `any`, da cui le ~40 assertion `as`/`as unknown as` (es. `Dashboard.tsx:84,91`, `ELO.tsx:153,164`, `recalc.ts:151,167,208`).
- **`any` espliciti**: `eloCalculator.ts:236` (`rating: any`), `diagnosePlays.ts:26,71,127`, `AddPlay.tsx:215` (parser XML BGG non tipizzato).
- **Contratti mentitori**: `getGeneralELO` (`eloCalculator.ts:322-336`) dichiara `Promise<GeneralELOResult | null>` (campi camelCase) ma ritorna la riga DB snake_case; stesso problema in `updateGeneralELO` (righe 290/312). Compila solo perché `data` è `any`.

**Conseguenze.** Ogni modifica allo schema si propaga in 8-11 punti con bug silenziosi; le assertion `as unknown as` disabilitano ogni controllo sul dato in ingresso più critico (risultati query); i consumer di `getGeneralELO` leggerebbero `undefined` da `playerId`.

**Remediazione incrementale.**
1. Generare i tipi DB: `supabase gen types typescript --schema public > src/types/db.ts` e `createClient<Database>(...)`. Questo da solo trasforma la maggior parte delle assertion in errori di compilazione reali.
2. Derivare `DbGame/DbPlayer/...` da `Database['public']['Tables']['...']['Row']` in un unico modulo; sostituire le interfacce locali un file alla volta (cambi meccanici, verificati da `tsc`).
3. Sostituire gli `any` del parser XML con tipi `Record<string, unknown>` + type guard; eliminare `diagnosePlays.ts` (dead code, TD-023).
4. Correggere le firme di `getGeneralELO/updateGeneralELO` con un mapper riga→dominio.

**Validazione:** `npx tsc --noEmit` verde dopo ogni passo; rimozione progressiva misurabile con `grep -c " as Db"` per pagina.

---

### TD-022 — Logica business dentro componenti giganti

**Categoria:** Architettura · **Confidenza:** Alta

**Evidenza.** `AddPlay.tsx` (1060 righe), `Stats.tsx` (923), `Wrapped.tsx` (761), `Import.tsx` (695). In `AddPlay.tsx:410-462` la regola di assegnazione posizioni (vincenti/cooperativo/ordinamento per punteggio) è implementata inline nel submit handler; una variante della stessa regola vive in `simulation.ts:238-263` (`withAssignedPositions`) — duplicazione concettuale con semantica leggermente diversa. `EditPlay.tsx:238-264` ha una **terza** variante. Import gestisce in component la persistenza di giocatori/giochi/partite/punteggi/ELO.

**Conseguenze.** Le regole di dominio non sono testabili senza renderizzare React; tre implementazioni divergenti della stessa regola sono già presenti; ogni nuova feature tocca file da 1000 righe.

**Remediazione.**
1. Estrarre `assignPositions(players, {isCooperative, teamWon})` come funzione pura unica in `src/utils/` (fonte di verità) e usarla nei tre call-site; unit test (dipende da TD-021).
2. Estrarre da `Import.tsx` un modulo `src/services/bgaImport.ts` con le funzioni di persistenza (riceve `supabase` come parametro) e ridurre il componente a UI + orchestrazione.
3. Ripetere il pattern per AddPlay (form state → payload puro) e Stats (calcolo aggregati già quasi puro in `calculateStats`).

---

### TD-018 / TD-019 / TD-020 — Persistenza inefficiente e non atomica

- **TD-018 (Import N+1)**: per ogni partita: 1 select play + 1 select game + 1 insert play + per giocatore 1 select + 1 insert score + ELO per giocatore (select+update) + ELO generale (select+upsert) → per 100 partite × 4 giocatori ≈ **2.000+ richieste sequenziali**. **Rimedio:** pre-caricare giocatori e giochi esistenti in memoria con 2 query (`in`), bufferizzare gli insert di `play_scores` e fare un insert bulk finale; per l'ELO usare `performFullRecalc` una sola volta a fine import (sinergico con TD-001). Sforzo M · validare con import di prova e conteggio richieste in DevTools.
- **TD-019 (read-modify-write)**: `eloCalculator.ts:103-117` — `games_played: existingRating.games_played + 1` calcolato client e `rating: result.newRating` sovrascrive: due inserimenti concorrenti (doppio click, due tab) perdono un incremento. **Rimedio:** upsert `onConflict: 'player_id,game_id'` con incrementi atomici via RPC, oppure eliminazione del percorso (TD-001 passo 1).
- **TD-020 (edge nightly)**: `nightly-elo-recalc/index.ts:82-89` scarica fino a 10.000 righe di `plays` per estrarre i `user_id` distinti. **Rimedio (S):** una view `distinct_play_users` o RPC `get_play_user_ids()` nel DB, oppure `.select('user_id')` con `distinct` via PostgREST header.

### TD-015 / TD-016 / TD-017 / TD-014 — Gestione errori, resilienza, race

- `AddPlay.tsx:495` e `EditPlay.tsx:293`: `try { await invalidateELOHistory(...) } catch { /* non bloccare il flusso */ }` — se l'invalidazione fallisce la cache resta stantia **senza nessun segnale** all'utente.
- `Stats.tsx:397-398,432-434`, `Dashboard.tsx:143-144`, `ELO.tsx:135-137`, `Wrapped.tsx`: errori solo `console.error` → pagine vuote senza spiegazione; `eloCalculator.ts:147-155` ingoia gli errori dell'ELO Generale.
- Nessun timeout/retry: `AddPlay.tsx:180-204` (fetch BGG), tutte le chiamate Supabase; l'Edge Function non ha retry (collegato a TD-002).
- `Dashboard.tsx:113-117`: query mensile senza `.limit()` → il cap predefinito di 1000 righe tronca silenziosamente; la stessa fix è già applicata in `Stats.tsx:166-179` con `.limit(10000)` e commento esplicito — ma non è stata riportata ovunque.
- Zero `AbortController` in `src/`: cambiando gioco rapidamente in `/elo`, `fetchRatings` concorrenti possono risolvere in ordine arbitrario (l'ultimo stato non corrisponde necessariamente all'ultima richiesta).

**Rimedi:**
1. Helper `withRetry(fn, {retries: 2, timeoutMs})` per le chiamate dati + `getErrorMessage(error)` tipizzata (TD-013).
2. Al fallimento dell'invalidazione cache: toast di avviso "Storico ELO non aggiornato, verrà corretto stanotte".
3. `.limit(10000)` sulla query mensile di Dashboard (S).
4. `AbortController` + cleanup negli useEffect di fetch delle pagine principali (pattern standard React 19); in alternativa flag `cancelled` nel cleanup.

### TD-005 — Invalidazione cache mancanti

`Import.tsx` non chiama mai `invalidateELOHistory` (import presenti solo in `AddPlay.tsx:495` e `EditPlay.tsx:293`); `PlayDetail.tsx:148-163` elimina la partita senza invalidare né ricalcolare (le righe `elo_history` cascanno via FK, ma i rating per gioco restano sovrastimati fino al job notturno). **Rimedio (S):** chiamare `invalidateELOHistory` a fine import e dopo la delete; per la delete valutare `performFullRecalc` asincrono.

### TD-004 — EditPlay non atomico

`EditPlay.tsx:266-284`: delete totale di `play_scores` + insert nuovo set in due richieste; un fallimento di rete tra le due lascia la partita **senza punteggi** (la validazione pre-delete riduce ma non elimina il rischio). **Rimedio:** RPC Postgres `replace_play_scores(p_play_id, p_scores)` transazionale (SECURITY DEFINER con check `plays.user_id = auth.uid()`), oppure fallback: insert nuovi con `position` shifted + delete per id in un secondo momento. Sforzo M.

### TD-023 — Dead code e duplicazione

`src/utils/diagnosePlays.ts` (241 righe, con `any`) non è importato da nessuna pagina; `imageUpload.ts:100,121` parametri morti `_gameId/_playerId`; `deleteGameImage`/`getGameImageUrl` esportati ma mai usati; `enable_public_read_access.sql` e `enable_public_access_for_dashboard.sql` sono identiche al 95%. **Rimedio (S):** eliminare file/parametri/export; consolidare le migrazioni durante TD-009.

### TD-024 / TD-025 / TD-013 / TD-008 / TD-007 — Tooling e operational

- **TD-024**: `src/lib/supabase.ts:3-4` — `import.meta.env.VITE_SUPABASE_URL as string` è ridondante (`vite-env.d.ts` già li tipizza) e il client viene creato anche con env mancanti (crash differito con messaggio generico). **Rimedio:** `if (!url || !key) throw new Error(...)` esplicito; hook `useSupabase()` per iniettare il client nelle pagine (testabilità).
- **TD-025**: `tsconfig.json:33` (`include: ["src", "vite.config.ts"]`) — `scripts/compare-elo.ts` non è type-checked dal build. **Rimedio:** aggiungere `scripts` a include o tsconfig dedicato. `eslint.config.js:32`: `no-explicit-any: 'warn'` non bloccante e nessuna regola type-aware (`no-floating-promises`); attivare `recommendedTypeChecked` con `parserOptions.project`.
- **TD-013**: `(error as Error).message` ripetuto 20+ volte (`AuthContext.tsx:59-89`, `Import.tsx:447-448,578-589`). **Rimedio:** helper `getErrorMessage` unico.
- **TD-008**: `nightly-elo-recalc/index.ts:28-40` — `isServiceRoleRequest` decodifica il payload **senza verificare la firma**: sicuro solo se `verify_jwt` è attivo in deploy, ma non esiste `config.toml` che lo codifichi; la guardia su `elo_recalc_runs` (righe 57-74) è check-then-insert non atomica (TOCTOU: due invocazioni simultanee passano entrambe). **Rimedio:** `config.toml` con `verify_jwt = true` + schedule; guardia atomica con unique constraint parziale su `status='running'` o RPC `try_claim_run()`.
- **TD-007**: `psw.txt` (30 byte) nella root: non tracciato da git e coperto da `.gitignore` — nessun leak nel repository, ma un file password in chiaro accanto al codice è un rischio operativo locale (spostarlo in un gestore password ed eliminarlo).

---

## 3. Roadmap di remediazione

### Fase 0 — Quick win (1-3 giorni, rischio basso)

1. **TD-001 passo 1** — sostituire l'ELO a caldo con `performFullRecalc` in AddPlay/Import (nessuna dipendenza; è il fix a maggior ritorno).
2. **TD-003** — filtro `user_id` sul lookup giochi in Import (una riga).
3. **TD-017** — `.limit(10000)` sulla query mensile di Dashboard.
4. **TD-005** — `invalidateELOHistory` dopo import e delete.
5. **TD-023** — rimozione dead code (`diagnosePlays.ts`, parametri morti).
6. **TD-024** — fail-fast sulle env in `lib/supabase.ts`.
7. **TD-020** — view/RPC per i `user_id` distinti nel job notturno.

### Fase 1 — Fondamenta (1-2 settimane) — dipende da Fase 0 (punto 2)

1. **TD-021** — Vitest + test di caratterizzazione su `simulation.ts` e poi sul nuovo flusso di salvataggio partita; CI GitHub Actions (lint + tsc + test + build). **Prima di ogni refactor successivo.**
2. **TD-002 (parziale)** — isolamento errori per utente + retry sui batch nell'Edge Function.
3. **TD-009** — versionare migrazioni (timestamp, rimozione da `.gitignore`, `db pull` di allineamento) + `config.toml`.
4. **TD-025** — estendere type-check a `scripts/`; ESLint type-aware con `no-floating-promises`.
5. **TD-015 (parziale)** — helper `getErrorMessage` + `withRetry` e adozione nelle pagine più colpite.

### Fase 2 — Medio termine (2-6 settimane) — dipende da Fase 1 (test e migrazioni versionate)

1. **TD-010/TD-011/TD-012** — tipi `Database` generati, modulo tipi unico, eliminazione graduale delle interfacce `Db*` locali pagina per pagina.
2. **TD-006** — decisione formalizzata su RLS/visibilità pubblica, policy per-utente o view aggregate dedicate; rimozione della migrazione contraddittoria.
3. **TD-018** — Import con pre-caricamento in memoria + insert bulk; **TD-019** eliminato dal percorso (già rimosso con TD-001 passo 1) o corretto con upsert atomici.
4. **TD-022** — estrazione `assignPositions` pura unica (con test) e modulo `services/bgaImport.ts`; poi AddPlay/Stats progressive.
5. **TD-004/TD-002 (finale)** — RPC transazionali per replace scores e ricalcolo.

### Fase 3 — Lungo termine (trimestre) — dipende da Fase 2 (tipi unificati e confini moduli)

1. Completamento estrazione layer dati (`src/services/*` con client iniettato) e rimozione degli import diretti del singleton dalle pagine.
2. Paginazione/streaming per Stats/Wrapped (oggi caricano fino a 10k righe con join completi).
3. Se la base utenti cresce: spostare il ricalcolo ELO "a caldo" completamente lato DB (trigger/RPC) e ridurre l'Edge Function a coordinamento.

---

## Stato implementazione

### Fase 0 — Quick win — ✅ completata il 2026-08-23

| Item | Stato | Note |
|------|-------|------|
| TD-001 ELO a caldo da rating 1000 | ✅ | AddPlay e Import usano ora `performFullRecalc` (rating correnti, cache elo_history rigenerata). Import: un solo ricalcolo a fine import invece che per partita. Rimosso `updateELOAfterGame` (e con esso `updateGeneralELO`, `calculateGeneralELO`, `getELOForGame`, `getELOForPlayer`, tutti orfani). Validare in UI: rating in /elo corretti subito dopo l'aggiunta. |
| TD-003 lookup giochi senza user_id | ✅ | `.eq('user_id', user.id)` sulla select games in Import.tsx. |
| TD-017 limite query mensile Dashboard | ✅ | `.limit(10000)` con commento. |
| TD-005 cache ELO non invalidata | ✅ | Superato strutturalmente: import e delete passano da `performFullRecalc`, che rigenera elo_history (l'invalidazione puntuale non serve più). |
| TD-023 dead code | ✅ | Eliminati `diagnosePlays.ts`, parametri morti `_gameId`/`_playerId`, export inutilizzati `deleteGameImage`/`getGameImageUrl` e le 5 funzioni orfane di eloCalculator. |
| TD-024 env non validate | ✅ | `lib/supabase.ts`: throw esplicito con messaggio actionable se le env mancano. |
| TD-020 utenti distinti nel job notturno | ✅ | Migrazione `20260823184217_create_play_user_ids_rpc.sql`: RPC `get_play_user_ids()` (SECURITY DEFINER, REVOKE a anon/authenticated, GRANT a service_role — verificato: anon riceve 42501), applicata via `db push`. Edge Function aggiornata e ridistribuita. |

### Fase 1 — Fondamenta — ✅ completata il 2026-08-23

| Item | Stato | Note |
|------|-------|------|
| TD-021 Vitest + test core ELO | ✅ | 36 test di caratterizzazione su `src/utils/elo/simulation.test.ts`, incluso il test di regressione TD-001 ("seconda partita riparte dai rating reali"). Script `npm run test`. |
| TD-021 CI GitHub Actions | ✅ | `.github/workflows/ci.yml`: lint + typecheck (src e scripts) + test + build su Node 24. Attiva al primo push. |
| TD-002 (parziale) isolamento per utente | ✅ | L'Edge Function continua dopo l'errore di un utente; status `succeeded_with_errors` con lista `failures` nel summary (colonna TEXT, nessuna migrazione necessaria). |
| TD-002 (parziale) retry batch | ✅ | `withRetry` (backoff esponenziale, 3 tentativi) su insert/upsert/delete a chunk in `recalc.ts`. Rischio duplicati su timeout ambigui accettato: la pipeline è idempotente e riparte da una delete. |
| TD-009 versionamento migrazioni | ✅ | 18 migrazioni rinominate `<timestamp>_<nome>.sql` in ordine di dipendenza; `.gitignore` aggiornato (anche `docs/`); `diagnose_problematic_plays.sql` spostato fuori (query diagnostica). Storico allineato al remoto: `supabase link` (progetto ScoreKing) + `migration repair --status applied` su tutte le 18 versioni (il DB non aveva storico CLI: tutto applicato via SQL Editor). `db pull` opzionale differito (richiede Docker). |
| TD-009 config.toml | ✅ | `supabase/config.toml` con `project_id` reale e `verify_jwt = true`. Lo schedule resta in dashboard (timezone esplicita Europe/Rome = corretto con ora legale; un cron UTC in config slitterebbe di 1h per metà anno). Edge Function ridistribuita con `supabase functions deploy` (CLI aggiornata a 2.115). |
| TD-025 type-check scripts/ | ✅ | `scripts/tsconfig.json` (lib ES2020 + tipi node); script `npm run typecheck` che verifica src + scripts. |
| TD-025 ESLint type-aware | ✅ | `no-floating-promises: error` e `no-misused-promises` su src/scripts via `projectService`; Edge Function Deno in blocco separato non type-aware. 36 promise flottanti corrette con `void`. Set `recommendedTypeChecked` completo differito a TD-010 (client Supabase non tipizzato → genererebbe ~centinaia di `no-unsafe-*`). |
| TD-015 (parziale) helper errori | ✅ | `src/utils/errors.ts` (`getErrorMessage`) + `src/utils/retry.ts` (`withRetry`). Adottati in AuthContext, Import (incluso retry sui fetch BGG), Games. |

**Validazione Fase 1**: `npm run lint` 0 errori (21 warning pre-esistenti:
exhaustive-deps, no-explicit-any, react-refresh), `npm run typecheck` pulito,
`npm run test` 36/36, `npm run build` OK.

**Passi completati dopo l'implementazione** (2026-08-23): `supabase link`
(progetto ScoreKing `rixivmeipbizoxyvrvaf`), `migration repair` di tutte le
18 versioni, deploy dell'Edge Function. Rimanuto opzionale: `supabase db
pull` per catturare drift schema vs migrazioni (richiede Docker attivo).

### Fase 2 — Medio termine — 🔄 in corso

| Item | Stato | Note |
|------|-------|------|
| TD-010/011/012 tipi generati e unificati | ✅ (2026-08-23) | `src/types/db.ts` generato dal DB reale (`supabase gen types --linked`); client tipizzato `createClient<Database>`; `src/types/rows.ts` modulo unico dei tipi Row/join; 28 interfacce `Db*` locali rimosse (restano solo 2 view model: `DbGameWithStats`, `DbEloGame`); asserzioni `as` da ~40 a 8 (tutte legittime); `types/index.ts` ripulito dei tipi dominio divergenti (restano solo Auth/Nav/Upload). Contratti `getGeneralELO`/`getAllGeneralELO` raddrizzati sui tipi reali (TD-012). Bonus emersi dal tipo stretto: nullabilità reale gestita (`winner`, `game_id`, `player_id`, `rating.losses` nullable nel DB), guard `played_at` mancante nell'import, fix aggregazione Dashboard con `game_id` nullo. |
| TD-006 decisione RLS | ⏳ | Richiede decisione di prodotto (vedi anche TD-026). |
| TD-018 import bulk | ✅ (2026-08-23) | `src/services/bgaImport.ts`: pre-caricamento di partite/giochi/giocatori con 3 query parallele + lookup in memoria. Da ~2000 richieste (100 partite × 4 giocatori) a ~2 per partita + 3. `play_scores` resta per-partita (non bulk finale) per mantenere l'isolamento degli errori: una partita o è completa o è errore. Import.tsx: 695 → 568 righe (solo parsing/UI). |
| TD-022 estrazione assignPositions | ✅ (2026-08-23) | `src/utils/elo/positions.ts`: fonte unica di verità (algoritmo identico al core ELO + caso cooperativo), usata da simulation.ts, AddPlay ed EditPlay. Le 3 varianti divergenti sono eliminate. EditPlay ora ricalcola le posizioni da winner/score (prima riusava posizioni stale del form, il campo è stato rimosso). 7 unit test dedicati + parità verificata dai 36 test di caratterizzazione. |
| TD-004/TD-002 finale RPC transazionali | ⏳ | |

---

## Debito accettato / differito

| Item | Motivo della defer | Condizioni di riattivazione |
|------|--------------------|------------------------------|
| Dashboard pubblica con dati di tutti gli utenti (TD-006, lato query) | Sembrerebbe una scelta di prodotto deliberata (commenti "public data" diffusi) | Prima richiesta di privacy da un utente / aggiunta di dati sensibili nelle note |
| Caricamento full-table in Stats/Wrapped | Dimensione dataset personale piccola; funziona | Oltre ~5.000 partite o lentezza percepita |
| `compare-elo.ts` come test manuale su DB reale | Serve proprio a verificare parità su dati reali | Sostituirlo solo quando la suite unitaria copre la semantica completa |
| Migrazione a Next.js/SSR | Non è debito: è un'architettura SPA coerente con gli obiettivi | Requisiti SEO/rendering server reali |

---

## Comandi di validazione consigliati dopo ogni fase

```
npm run lint
npx tsc --noEmit
npm run build
npm run compare:elo        # golden test ELO su dati reali
supabase db advisors       # dopo ogni cambiamento di policy RLS
```

## Assunzioni e limitazioni dell'audit

- Nessun accesso al DB remoto: le policy RLS sono valutate dalle sole migrazioni SQL (il cui stato effettivo è incerto, vedi TD-009).
- Nessun build/test eseguito (analisi statica read-only).
- Il numero di utenti reali è sconosciuto: le stime di impatto multi-tenant partono dallo schema (colonna `user_id` ovunque).
