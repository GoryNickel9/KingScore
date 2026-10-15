# Contratto di pubblicazione ELO — prova locale

Definito il 15 ottobre 2026. Questo documento e il prototipo servono a verificare il protocollo sul PC. Non sono una migrazione Supabase. Nessun reader, ricalcolo web, job notturno o client Android è stato collegato al prototipo; nessun deploy è stato eseguito.

## Formula e input conservati

L'adattatore `src/utils/elo/publication.ts` richiama direttamente `simulateAllPlays`; non contiene una seconda implementazione dell'ELO. La versione del calcolo è `kingscore-elo-legacy-v1`.

- Rating iniziale 1000 per giocatore/gioco; K 48 con meno di 10 partite già giocate, 32 fino a 29, 24 da 30.
- Atteso logistico con divisore 400; per almeno tre giocatori, media dei confronti pairwise. Aggiornamento `Math.round(rating + K * (reale - atteso))`.
- Generale come media dei rating per gioco pesata con le partite giocate, arrotondata.
- Rimangono il confronto attuale dei punteggi nulli, i pareggi, i vincitori multipli, i contatori draw e il comportamento cooperativo già presente nel simulatore. Le posizioni persistite vengono ricalcolate come prima. Partite con meno di due partecipanti vengono saltate.

Le partite arrivano ordinate per `played_at, id`; l'adattatore controlla l'ordine e non lo corregge. Non riordina i partecipanti. Date valide `YYYY-MM-DD`, UUID, revisione bigint testuale e valori numerici finiti sono verificati prima del calcolo. Le posizioni zero/negative vengono tollerate entro il tipo integer del database, perché il simulatore le sostituisce. Un gioco assente mantiene il comportamento del core, compreso il bucket `null` nel risultato del generale; il tipo storico del core dichiara ancora `gameId:string`, mentre quel valore è `null` a runtime.

Score non finiti o record incompatibili fanno fallire il job senza pubblicare una classifica parziale. Non vengono ripuliti o reinterpretati automaticamente. La conversione numerica resta quella del percorso JavaScript attuale: preservare i decimali nel salvataggio delle partite non cambia la precisione della formula ELO esistente.

Il runner controlla gli hash del core prima di eseguire i casi:

| File | SHA-256 del sorgente verificato sul PC |
| --- | --- |
| `simulation.ts` | `6928038ff5fe0ccbb3b8807a12ac7268ebe033741d9692192d9a36c930996b7f` |
| `positions.ts` | `65d5c06f4d94ecb714c468db5607c9ac9258c8ea3a8d21b1657b82e007d2d6d5` |

## Perimetro dei risultati

Nel prototipo `scopeId` identifica il proprietario storico delle partite, come il filtro di `performFullRecalc` attuale. L'amministratore che modifica una partita non diventa proprietario della classifica. Ogni proprietario ha una generazione separata; due account con lo stesso gioco e giocatore non possono sostituirsi a vicenda.

Il codice esistente ha però proiezioni incompatibili fra loro: `player_ratings` non ha owner, alcune cache leggono senza owner mentre il fallback lo filtra. La prova conserva la coorte del ricalcolo per utente, ma non decide implicitamente come debba aggregare il sito pubblico. Prima dell'integrazione occorre rendere esplicita questa scelta in tabelle, API e reader. I bucket HU/3/4/5+ sono calcoli indipendenti sul proprio sottoinsieme: non devono usare questa generazione come se fossero semplici filtri del risultato completo.

L'ordine dell'array dei partecipanti influisce sui casi con punteggi assenti o uguali. Le query correnti non ne fissano un ordine esplicito. La fixture usa una colonna **sintetica** `ordinal` per conservare e testare la sequenza ricevuta: non afferma che quella colonna esista nel database online. Servono una decisione e una verifica dello storico prima di introdurre un ordine persistente reale; ordinare per UUID senza questa verifica può cambiare i risultati pur lasciando intatta la formula.

## Protocollo e invarianti

1. **Modifica sorgente.** Ogni INSERT/UPDATE/DELETE/TRUNCATE di partite, punteggi, giocatori o giochi incrementa una revisione nella stessa transazione. Il rollback annulla anche l'incremento. Le cascade sono comprese. La prima versione invalida conservativamente anche modifiche ai soli metadati o a un altro proprietario.
2. **Snapshot.** Una sola lettura MVCC restituisce revisione e intero storico della coorte. Include nomi/alias necessari all'output. Non combina pagine lette in momenti differenti.
3. **Calcolo.** Il worker calcola fuori dalla transazione dei salvataggi e costruisce un risultato completo: rating per gioco, generali, storici e conteggi. Pubblica un UUID e un corpo immutabile; la revisione viaggia come stringa, anche oltre `2^53`.
4. **Pubblicazione.** Nella stessa transazione, il database acquisisce il lock usato dai writer sorgente, verifica la revisione, inserisce la generazione e sostituisce il puntatore della coorte. Se la revisione è superata, rifiuta il risultato e richiede nuovo snapshot e nuovo calcolo. Un errore nel cambio puntatore annulla anche l'inserimento della generazione.
5. **Lettura e recupero.** Il reader restituisce in una sola lettura tutta la generazione corrente oppure `missing/stale` con `result:null`. Lo stesso UUID con lo stesso corpo conferma il commit precedente senza duplicarlo; un corpo diverso viene rifiutato. Il replay non riporta mai il puntatore a una generazione precedente e non rende attuale un risultato ormai superato.

Il contatore e il lock sono globali nel prototipo. Serializzano i writer e possono invalidare più proprietari del necessario: è una scelta conservativa per dimostrare la correttezza, non un'ottimizzazione. Un futuro partizionamento richiederà prove equivalenti, soprattutto quando un gioco, giocatore o account coinvolge più coorti.

La generazione è un unico payload JSONB. Non esistono batch visibili al reader, né staging parziale da scambiare per una cache completa. La dimensione e le paginazioni del servizio reale restano da progettare: è stata verificata una storia di 1.200 partite, non una capacità illimitata. La lettura di più coorti o di più pagine dovrà conservare lo stesso identificatore/revisione e rilevare eventuali cambiamenti; non basta leggere separatamente le vecchie tabelle.

## API del prototipo

| Operazione | Contratto |
| --- | --- |
| `elo_local.snapshot(owner)` | `{scopeId, sourceRevision, plays}` completo e consistente |
| `buildEloPublication(snapshot, publicationId)` | `{publicationId, scopeId, sourceRevision, algorithm, result}` senza I/O |
| `elo_local.publish(body)` | Conferma `{publicationId, scopeId, sourceRevision, replayed}`; revisione superata → SQLSTATE `40001`; UUID riusato con altro corpo → `23505` |
| `elo_local.read(owner)` | `{status, sourceRevision, publishedRevision, publicationId, result}`; `result` presente solo con stato `current` |

Solo il worker fidato può acquisire snapshot e pubblicare. Il reader non può pubblicare; il worker non può modificare sorgenti o generazioni direttamente. Il database controlla involucro e tipi principali, ma si fida del worker per il contenuto matematico: l'app non deve poter inviare i propri rating alla funzione di pubblicazione. Le simulazioni non vengono eseguite dentro la transazione di salvataggio della partita.

## Risultati verificati

Il checkpoint supera 36 nuovi test dell'adattatore (286 test web complessivi), 28 casi PostgreSQL 17.4, typecheck, lint mirato e build. Il report [elo-publication-validation.json](evidence/elo-publication-validation.json) conserva casi, hash e limiti. Il cluster del run `b14ee366b35043409efae700484548d3` è stato arrestato; nessun servizio remoto è stato contattato.

I due errori iniziali del runner sono conservati nei log: selezione ambigua di Node dal PATH e confronto testuale dell'indirizzo PostgreSQL con suffisso `/32`. Sono stati corretti rispettivamente selezionando un solo eseguibile e verificando `host(inet_server_addr())`; le protezioni loopback della fixture non sono state allentate.

## Prove locali e limiti

```powershell
npm test
npm run typecheck
npx eslint src/utils/elo/publication.ts src/utils/elo/publication.test.ts scripts/test-elo-publication.mjs
./scripts/test-local-elo-publication.ps1
```

Il runner crea un cluster PostgreSQL temporaneo su `127.0.0.1`, un database `kingscore_elo_local_tests` e ruoli sintetici. La fixture rifiuta l'installazione senza database, marker e indirizzo loopback previsti; si trova in `local-tests`, fuori dalle migrazioni. Il runner usa le dipendenze già installate, non contatta servizi cloud e arresta il proprio cluster in `finally`. Log e report restano in `.work/local-elo-publication`.

I test dell'adattatore comprendono valori noti 997/1003 dopo due vittorie alternate, soglie K, null/pari, cooperativi, draw, giochi multipli, gioco assente, input immutabili e confronto differenziale su 25 storie deterministiche di 40 partite. Le prove PostgreSQL coprono snapshot, concorrenza, rollback, replay, coorti sovrapposte, rimozione dell'ultima partita, cascade, metadati, revisioni grandi e una generazione completa oltre 1.000 partite.

Il caso di risposta persa ripete la chiamata SQL dopo un commit già concluso: non simula una caduta HTTP reale. I ruoli locali non certificano Auth/RLS Supabase. Il runner può pubblicare fixture e resettare il contatore come proprietario del database esclusivamente per isolare i casi; questi privilegi non vengono concessi ai ruoli applicativi sintetici.

Prima di preparare una migrazione reale rimangono: coorti e ordine dei partecipanti espliciti; inventario dello schema effettivo; collegamento dell'invalidazione ai writer reali, incluse cascade e import; worker riavviabile con recupero delle richieste incerte; lettori senza scritture opportunistiche di cache; chiusura dei writer ELO legacy e notturni; retention, limiti, backup e ripristino verificati. Il risultato locale dimostra il protocollo, non chiude questi lavori di integrazione.
