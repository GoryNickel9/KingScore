# Ottimizzazione della Velocità di Calcolo dell'ELO Generale
> Generato il 19 Agosto 2026 — Analisi delle prestazioni e piano di intervento per il calcolo dell'ELO Generale e del ricalcolo completo.

> **✅ STATO: IMPLEMENTATO (OP1-OP5)** — 19 Agosto 2026
>
> | Pezzo | Dove |
> |---|---|
> | Core puro di simulazione (OP1+OP3) | `src/utils/elo/simulation.ts` |
> | Pipeline bulk di ricalcolo (OP1+OP2) | `src/utils/elo/recalc.ts` (`performFullRecalc`) |
> | Cache e percorsi riscritti (OP1+OP4+OP5) | `src/utils/eloCalculator.ts`, `src/pages/ELO.tsx` |
> | Golden test di parità | `scripts/compare-elo.ts` → `npm run compare:elo` |
>
> **Verifiche eseguite:** parità totale col vecchio algoritmo sui dati reali (392 partite, 15 giochi: storici per gioco, storico generale, rating finali per gioco, ELO Generali finali con W/S — zero divergenze); `tsc --noEmit` e `vite build` verdi; lint senza nuovi errori (66 preesistenti invariati).
>
> **Miglioramenti extra:** `limit(10000)` esplicito sulle letture bulk (il vecchio codice troncava silenziosamente oltre le 1000 righe); il ricalcolo completo rigenera ora anche la cache `elo_history`; `last_played_at` riflette l'ultima partita invece dell'orario del ricalcolo.

---

## Indice
1. [Contesto e Obiettivo](#1-contesto-e-obiettivo)
2. [Diagnosi: Dove Va il Tempo Oggi](#2-diagnosi-dove-va-il-tempo-oggi)
3. [Quantificazione del Problema](#3-quantificazione-del-problema)
4. [Principi Guida](#4-principi-guida)
5. [Interventi Dettagliati](#5-interventi-dettagliati)
6. [Architettura di Riferimento del Ricalcolo](#6-architettura-di-riferimento-del-ricalcolo)
7. [Parità dei Risultati e Strategia di Test](#7-parità-dei-risultati-e-strategia-di-test)
8. [Rischi e Mitigazioni](#8-rischi-e-mitigazioni)
9. [Miglioramenti Attesi](#9-miglioramenti-attesi)
10. [Criteri di Accettazione](#10-criteri-di-accettazione)
11. [Fasi di Implementazione](#11-fasi-di-implementazione)
12. [Collegamento con il Job Notturno](#12-collegamento-con-il-job-notturno)

---

## 1. Contesto e Obiettivo

Il calcolo dell'ELO è **matematicamente banale** (qualche migliaio di operazioni elementari, millisecondi in JavaScript) ma **architetturalmente costoso**: la logica in `src/utils/eloCalculator.ts` interagisce con Supabase con centinaia o migliaia di richieste HTTP sequenziali dal browser. La latenza di rete, sommata su tutte, domina il tempo totale.

**Obiettivo:** portare i tre flussi di calcolo (apertura Stats, ricalcolo dopo modifica, ricalcolo manuale completo) da minuti a pochi secondi, mantenendo **risultati identici** a quelli attuali.

---

## 2. Diagnosi: Dove Va il Tempo Oggi

### Flusso A — Apertura di Stats / PlayDetail con cache valida
`src/pages/Stats.tsx:429` e `src/pages/PlayDetail.tsx:130` chiamano `getGeneralELOHistory` (`eloCalculator.ts:829`), che legge la cache `elo_history` e ritorna subito. **Veloce: nessun intervento necessario.**

### Flusso B — Apertura di Stats con cache invalidata
Ogni modifica di una partita cancella l'intero storico generale (`invalidateELOHistory`, `eloCalculator.ts:1078` — corretto per design, perché l'ELO è cumulativo). Alla visita successiva `getGeneralELOHistory` ricalcola tutto:

- **1 query grande** (buono): `plays` + `play_scores` + `players`, ma include anche il join `games(*)` (riga 868) **mai utilizzato** nella funzione — payload gonfiato con tutte le righe dei giochi (immagini incluse) scaricato per nulla.
- **Simulazione in memoria con riscansioni**: per ogni partita e per ogni giocatore, la media pesata dell'ELO Generale viene ricalcolata da zero scorrendo **tutti i giochi** due volte — prima dell'aggiornamento (righe 972-988) e dopo (righe 999-1026). Costo O(partite × giocatori × giochi).
- **Scritture cache già batchate** (500 righe per volta, righe 1044-1059): questa parte è già ok.

### Flusso C — Ricalcolo completo (il caso peggiore)
Il pulsante "Ricalcola Tutti gli ELO" (`ELO.tsx:170`) scorre i giochi in sequenza e per ognuno chiama `recalculateAllELOForGame` (`eloCalculator.ts:544`), che per **ogni singola partita** invoca `updateELOAfterGame` (`eloCalculator.ts:238`). Ogni invocazione fa:

| Operazione | Richieste HTTP |
|---|---|
| SELECT rating esistente per ogni giocatore | P |
| UPDATE o INSERT rating per ogni giocatore | P |
| `updateGeneralELO` per ogni giocatore → SELECT di **tutti** i rating del giocatore + UPSERT | 2P |
| **Totale per partita** | **~4P** |

con P = giocatori per partita. **L'ELO Generale viene ricalcolato dal database dopo ogni singola partita**, quando dipende solo dai rating finali per gioco: è lavoro ridondante al quadrato.

In più `handleRecalculateAll` esegue i giochi uno dopo l'altro (`ELO.tsx:184-189`) e alla fine `recalculateAllGeneralELO` (`eloCalculator.ts:521`) rifà un ciclo di SELECT+UPSERT per giocatore.

---

## 3. Quantificazione del Problema

Scenario realistico per un uso personale intensivo: **300 partite**, media **4 giocatori**, **40 giochi** distinti.

| Flusso | Richieste HTTP sequenziali oggi | A ~150 ms l'una |
|---|---|---|
| C — Ricalcolo completo | ~300 × 16 ≈ **4.800** | **~12 minuti** |
| B — Stats dopo una modifica | 1 grande + ~2-3 scritture batch | ~2-4 s (payload join inutile incluso) |
| A — Stats con cache | 1 | < 0,5 s |

Il collo di bottiglia è evidente: il Flusso C fa **quasi 5.000 round-trip** per produrre un risultato che una singola simulazione in memoria calcolerebbe in millisecondi.

---

## 4. Principi Guida

1. **I/O minimo**: leggere tutto in una query, scrivere tutto in poche scritture massive. Nessuno stato intermedio va persistito — conta solo lo stato finale.
2. **Fonte di verità unica**: `plays` + `play_scores` sono i dati raw; rating e storico sono **derivati** e ricostruibili sempre da zero in modo deterministico.
3. **Simulazione pura**: separare il calcolo (funzioni pure, testabili) dalla persistenza (poche funzioni di lettura/scrittura bulk).
4. **Parità bit-per-bit**: nessuna modifica algoritmo (formula, K-factor, assegnazione posizioni, ordinamento `played_at`): solo a *come e quando* si legge/scrive.

---

## 5. Interventi Dettagliati

### OP1 — Simulazione unica in memoria + scritture massive *(impatto massimo)*
**Cosa:** estrarre la simulazione già presente in `getELOHistoryForGame`/`getGeneralELOHistory` in un modulo puro che, dati `plays[]` ordinati, restituisce: rating finali per (giocatore, gioco), statistiche aggregate e storico completo. Il ricalcolo completo diventa: 1 lettura bulk → simulazione → 1 upsert massivo su `player_ratings` (chiave `player_id + game_id`), 1 su `player_general_ratings` (chiave `player_id + user_id`), 1 delete + insert massivo su `elo_history`.
**File coinvolti:** nuovo `src/utils/elo/simulation.ts` (core puro), `src/utils/eloCalculator.ts` (diventa consumer del core), `src/pages/ELO.tsx` (`handleRecalculateAll` sostituito da una singola chiamata).
**Effetto:** Flusso C da ~4.800 richieste a **~6**. Da minuti a 1-3 secondi.

### OP2 — ELO Generale calcolato una sola volta, alla fine
**Cosa:** eliminare la catena `updateELOAfterGame` → `updateGeneralELO` → `calculateGeneralELO` dal percorso di ricalcolo (resta valida per l'aggiornamento incrementale a caldo dopo la registrazione di una singola partita). L'ELO Generale è funzione dei soli rating finali per gioco: si calcola una volta dopo la simulazione.
**File coinvolti:** `eloCalculator.ts:298-309` (ramo generale in `updateELOAfterGame`), percorso di `recalculateAllELOForGame`/`recalculateAllGeneralELO`.
**Effetto:** da solo dimezza le richieste del Flusso C; incluso a regime in OP1.

### OP3 — Somme progressive per la media ponderata
**Cosa:** nel Flusso B, mantenere per ogni giocatore due accumulatori (somma pesata Σ(rating×partite) e peso Σpartite) aggiornati incrementalmente quando un rating di gioco cambia, invece di riscorrere tutti i giochi due volte per partita. Il rating generale diventa O(1) per aggiornamento.
**File coinvolti:** `eloCalculator.ts:968-1026` (i due blocchi prima/dopo), da spostare nel core puro.
**Effetto:** il costo CPU della simulazione passa da O(N×P×G) a O(N×P); con storici grandi elimina l'unico punto che cresce più che linearmente.

### OP4 — Rimozione del join `games(*)` inutilizzato
**Cosa:** `getGeneralELOHistory` seleziona `games(*)` (riga 868) senza mai usarlo (usa solo `play.game_id`). Rimuoverlo riduce il payload della query grande.
**Effetto:** minore tempo di trasferimento, specialmente con molte immagini giochi.

### OP5 — Correzioni minori (zero rischio, colpo d'occhio)
- `playCounter` è incrementato due volte per iterazione (`eloCalculator.ts:894` e `:1039`): il log di riepilogo riporta il doppio delle partite processate.
- I `console.log` per partita saltata (riga 901) saturano la console del browser: ridurli a un riepilogo aggregato.

### OP6 — (Opzionale, fase successiva) Calcolo lato server via RPC
**Cosa:** spostare la simulazione in una funzione Postgres (RPC) o Edge Function richiamabile dal client, con transazioni atomiche.
**Effetto:** elimina i round-trip del browser e dona atomicità; **non necessario** per ottenere il grosso del miglioramento (OP1-OP4 bastano), ma è il naturale passo 2 se si vuoleatomicità transazionale. Nota: è esattamente l'infrastruttura richiesta dal job notturno (v. §12).

---

## 6. Architettura di Riferimento del Ricalcolo

Stato finale dopo OP1-OP3:

```
┌─────────────────────── Frontend (browser) ───────────────────────┐
│                                                                   │
│  Lettura (1 query)          Simulazione (pura, in memoria)        │
│  plays + play_scores  ───►  per ogni partita in ordine:           │
│  + players (niente           • posizioni, ELO per gioco           │
│   join games)                • accumulatori generali (OP3)         │
│                            ▼                                     │
│  Risultato: rating finali (gioco + generale), storico completo    │
│                            │                                      │
│  Scritture (3-4 bulk):      ▼                                     │
│  • upsert player_ratings (chiave player_id+game_id)               │
│  • upsert player_general_ratings (chiave player_id+user_id)       │
│  • delete+insert elo_history (batch da 500, schema esistente)     │
└───────────────────────────────────────────────────────────────────┘
```

Consumatori:
- **Stats / PlayDetail** (Flusso B): stessa pipeline, ma la scrittura di `elo_history` usa già `saveELOHistoryEntries` (upsert con `ignoreDuplicates`, `eloCalculator.ts:649`) — invariata.
- **Pulsante manuale** (Flusso C): una sola chiamata alla pipeline completa.
- **Registrazione partita** (`AddPlay.tsx:493`): **invariata** — l'aggiornamento incrementale a caldo di una singola partita resta il percorso veloce che è oggi.

---

## 7. Parità dei Risultati e Strategia di Test

Il requisito non negoziabile è che i rating prodotti dopo l'ottimizzazione siano **identici** a quelli attuali. La strategia:

1. **Golden test**: prima di toccare il codice, eseguire il ricalcolo manuale attuale e salvare uno snapshot di `player_ratings`, `player_general_ratings` ed `elo_history` (esport CSV/JSON dalle tabelle). Dopo l'ottimizzazione, rieseguire e confrontare: nessuna differenza ammessa.
2. **Test unitari sul core puro**: le funzioni di simulazione estratte non toccano il DB → testabili con fixture di partite (casi: 2 giocatori, 3+ giocatori, pareggi, partite senza posizioni, partite con un solo punteggio da saltare, ordinamento per `played_at`).
3. **Casi limite da coprire esplicitamente** (già gestiti dal codice attuale, da non perdere):
   - partite con < 2 `play_scores` da ignorare (`eloCalculator.ts:896-904`);
   - assegnazione posizioni in assenza di `position` (ordinamento per winner/punteggio, righe 941-963);
   - pareggi multipli (stessa posizione);
   - K-factor dipendente dalle partite giocate.
4. **Verifica RLS sulle scritture bulk**: upsert/delete massivi funzionano con il token utente attuale? Le policy esistenti (migrazioni `fix_*` e `restore_plays_rls`) vanno verificate sui path di scrittura nuova — in caso contrario valutare l'RPC di OP6 che esegue server-side.

---

## 8. Rischi e Mitigazioni

| Rischio | Probabilità | Impatto | Mitigazione |
|---|---|---|---|
| Divergenze di risultato (ordinamenti, arrotondamenti, posizioni) | Media | Alto | Golden test su dati reali (§7.1); test unitari con fixture; nessuna modifica alla matematica |
| Scritture bulk bloccate da policy RLS | Media | Medio | Verificare le policy sui nuovi path in fase di test; fallback: RPC server-side (OP6) |
| Scrittura parziale in caso di errore a metà batch | Bassa | Medio | Pipeline idempotente: rieseguire il ricalcolo ricostruisce tutto da zero; `elo_history` con `ignoreDuplicates` già tollera retry |
| Perdita del comportamento "aggiornamento a caldo" dopo AddPlay | Bassa | Alto | `AddPlay.tsx` resta sul percorso incrementale attuale, non toccato |
| Regressioni in EditPlay/import | Bassa | Medio | L'invalidazione (`invalidateELOHistory`) resta concettualmente invariata |

---

## 9. Miglioramenti Attesi

| Flusso | Oggi | Dopo OP1-OP4 |
|---|---|---|
| C — Ricalcolo completo | ~4.800 richieste, **~12 min** (scenario §3) | ~6 richieste, **~1-3 s** |
| B — Stats dopo modifica | 1 query grande (payload gonfiato) + CPU O(N×P×G) | 1 query essenziale + CPU O(N×P), marginale |
| A — Stats con cache | < 0,5 s | Invariato |

L'ordine di grandezza del miglioramento sul Flusso C è **~100x**, dovuto quasi interamente alla riduzione di round-trip di rete.

---

## 10. Criteri di Accettazione

1. Golden test: rating e storico identici prima/dopo (§7.1).
2. Ricalcolo completo completato in **< 5 secondi** sullo storico corrente.
3. Numero di richieste di rete per un ricalcolo completo **≤ 10**.
4. Registrazione e modifica di una partita continuano ad aggiornare i rating a caldo come oggi.
5. Suite lint/build (`npm run lint`, `npm run build`) verde.

---

## 11. Fasi di Implementazione

- [ ] **Fase 1 — Snapshot**: esportare lo snapshot di confronto dai dati reali (golden test).
- [ ] **Fase 2 — Core puro**: estrarre `src/utils/elo/simulation.ts` (simulazione per gioco + generale, con accumulatori OP3); test unitari con fixture.
- [ ] **Fase 3 — Persistenza bulk**: funzioni di upsert massivo per `player_ratings` e `player_general_ratings`; riuso di `saveELOHistoryEntries` per lo storico.
- [ ] **Fase 4 — Rewiring**: `handleRecalculateAll` → pipeline unica; rimozione del loop per-partita in `recalculateAllELOForGame`; rimozione join `games(*)`; fix `playCounter` e log.
- [ ] **Fase 5 — Verifica**: golden test, test manuale dei tre flussi (A/B/C) e di AddPlay/EditPlay, lint/build.
- [ ] **Fase 6 — (Opzionale) OP6**: RPC/Edge Function per atomicità e riuso da parte del job notturno.

---

## 12. Collegamento con il Job Notturno

Il piano `docs/automazione-aggiornamento-elo-notturno.md` **dipende da questo documento**:

- il **core puro** estratto qui (Fase 2) è esattamente ciò che l'Edge Function notturna riusa;
- le **scritture bulk** sono ciò che tengono il job entro i limiti di esecuzione di Supabase;
- l'ordine consigliato è: prima OP1-OP5 (client), poi il job notturno; OP6, se fatta, diventa il punto d'incontro naturale dei due piani.
