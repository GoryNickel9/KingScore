# Letture ELO della classifica globale

Contratto locale del 15 ottobre 2026. L'utente ha scelto un'unica classifica calcolata su tutte le partite di tutti gli account. La formula `kingscore-elo-legacy-v1` rimane quella di `simulation.ts` e `positions.ts`. Nessun deploy, modifica cloud o collegamento dei nuovi reader alle pagine distribuite.

## Ambito e generazione

La classifica pubblica richiede esplicitamente `scopeId: "global"`. Il worker riceve tutte le partite ordinate per data e UUID e conserva l'ordine persistito dei partecipanti. Calcola sull'intero storico: sommare o mediare le classifiche separate dei proprietari produrrebbe un risultato diverso. Gli scope UUID restano disponibili nella prova solo per diagnostica e isolamento; l'account autenticato non determina l'ambito della classifica pubblica.

Il servizio deve restituire un solo snapshot consistente con queste sette chiavi:

| Campo | Significato |
| --- | --- |
| `scopeId` | `global` per tutte le letture pubbliche |
| `algorithm` | `kingscore-elo-legacy-v1`; `null` se manca una pubblicazione |
| `status` | `current`, `stale` oppure `missing` |
| `sourceRevision` | bigint non negativo, stringa decimale canonica |
| `publishedRevision` | Revisione pubblicata come stringa; `null` se manca |
| `publicationId` | UUID della generazione; `null` se manca |
| `result` | Tutte le mappe e tutti gli storici della generazione, soltanto con `current` |

`current` richiede revisioni identiche. `stale` richiede una revisione pubblicata inferiore a quella sorgente e `result:null`. `missing` richiede algoritmo, revisione pubblicata, UUID e risultato nulli. Una generazione attuale senza partite contiene mappe e array vuoti: resta distinta da una classifica in attesa di aggiornamento. Non si espongono frammenti della generazione precedente come risultati attuali.

## Decoder e viste

`decodeEloRead(response, 'global')` controlla ambito, algoritmo, revisioni fino al massimo bigint PostgreSQL, date, UUID, conteggi e corrispondenze fra storici e stati finali. Rifiuta risultati parziali, duplicati e strutture incompatibili con un errore generico, senza includere il contenuto della risposta. Clona e congela il risultato; non ricalcola rating e non scrive cache. Le verifiche strutturali non sostituiscono la fiducia nel worker matematico.

`generalStandings`, `gameStandings`, `generalHistory` e `gameHistory` in `projections.ts` ricevono lo stesso oggetto decodificato. Ogni vista conserva identità, ambito e revisioni. Tabelle e grafici devono cambiare generazione insieme; non devono avviare richieste indipendenti senza controllo dell'identità.

Le classifiche ordinano per rating decrescente e UUID crescente a parità di rating; questo ordine di presentazione non modifica posizioni o formula. I filtri gioco/giocatore conservano l'ordine degli storici. I nomi provengono dalla pubblicazione, senza join con cataloghi di un'altra revisione. Il generale usa l'ultimo nome pubblicato nel suo storico, che conserva le convenzioni del simulatore. Il gioco nullo continua a contribuire al generale secondo il comportamento storico; non diventa una voce gioco selezionabile.

Con `stale` o `missing` le viste restituiscono `data:null`. Solo una generazione attuale può restituire `data:[]`. Il lettore non avvia ricalcoli, fallback sullo storico grezzo o scritture opportunistiche. L'app Android continua a richiedere login e Internet; i dati validati in memoria non autorizzano la consultazione offline o dopo il cambio account.

## Sostituzioni necessarie prima dell'attivazione

| Caller esistente | Collegamento richiesto |
| --- | --- |
| `pages/ELO.tsx` e `eloCalculator.getAllGeneralELO` | Una generazione globale per generale e classifiche per gioco; eliminare il filtro implicito `user.id` |
| `pages/Stats.tsx`, `getELOHistoryForGame`, `getGeneralELOHistory` | Proiezioni della stessa generazione; rimuovere fallback di simulazione e upsert della cache dal percorso di lettura |
| `pages/PlayDetail.tsx` e `getGeneralELO` | Valori e storici globali della stessa generazione, compresi quelli riferiti a partite altrui |
| `utils/elo/playerCountElo.ts` | HU/3/4/5+ richiedono generazioni distinte sul sottoinsieme; filtrare l'output completo non produce quei rating |
| Client Android | Decoder equivalente e aggiornamento coordinato di viste; nessun ricalcolo nell'app |

Questi caller legacy restano invariati finché servizio, worker e invalidazione non sono integrati. Il nuovo modulo è verificato sul PC ma non ancora collegato alle schermate. I bucket per numero di partecipanti non sono coperti dalla generazione globale completa.

La fixture `local-tests/elo-publication-fixture.sql` aggiunge `snapshot_global()` e `read_global()`; le varianti UUID restano diagnostiche. Sono funzioni della prova PostgreSQL sul PC, non RPC Supabase installabili direttamente. Autenticazione, RLS, limiti di risposta e paginazione reale richiedono un contratto di trasporto verificato. Se il servizio paginerà, ogni pagina dovrà mantenere UUID e revisione e dichiarare la completezza; un array non vuoto non è prova di completezza.

## Verifica ripetibile

Eseguire `npm test`, `npm run typecheck`, lint sui moduli ELO modificati, `npm run build` e `./scripts/test-local-elo-publication.ps1` dal checkout locale. Il runner usa soltanto PostgreSQL loopback e dati sintetici; arresta il cluster al termine. Il report del checkpoint contiene gli esiti effettivi e gli hash della formula.

Il prossimo lavoro è collegare il worker riavviabile e l'invalidazione dei writer locali prima del passaggio dei caller al nuovo servizio. L'attivazione online richiede una proposta separata da esaminare.
