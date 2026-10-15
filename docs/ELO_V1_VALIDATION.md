# ELO V1: verifiche e stato della distribuzione

## Stato verificato il 15 ottobre 2026

Il codice web del commit `3277dfb` integra creazione, modifica, eliminazione e import BGA tramite RPC atomiche, con revisione della partita, ricevute e recupero esplicito delle richieste incerte. Gli amministratori possono intervenire su tutte le partite mantenendo il proprietario storico. I salvataggi non inviano ricalcoli ELO dal browser.

La classifica ELO principale è globale: include le partite di tutti i proprietari. Classifiche, storici, dettaglio partita e Wrapped leggono la pubblicazione completa tramite `get_elo_publication_v1`. Il filtro annuale di Wrapped seleziona punti dello storico completo, senza ripartire da 1000 a gennaio. Le viste per numero di giocatori restano simulazioni separate del sottoinsieme scelto, senza scritture sulle cache legacy. La formula e il comportamento del ranking restano quelli del core precedente.

La distribuzione Vercel `dpl_5eEVfPY6kcmkLEQouwzB3LgXZMqY` è stata confermata `READY` su [kingscore.baldeddu.cc](https://kingscore.baldeddu.cc), con HTTP 200 e bundle aggiornato. Include il codice del commit indicato e il filtro `.vercelignore`; il build usa `VITE_ATOMIC_PLAY_WRITES=true`. Questo conferma la pubblicazione del sito, non il completamento dei flussi attraverso l'interfaccia.

Su Supabase è stata applicata in una sola transazione guardata l'installazione 01/02/03, con backfill dell'ordine dei partecipanti e prima pubblicazione globale. Il risultato iniziale è alla revisione `1`: 483 partite, 1359 punteggi, 482 partite elaborate e una saltata; il risultato ELO corrisponde al baseline precedente e la formula non è cambiata. SHA-256 dell'installazione: `afb0dafcdd89078c8360dc51c8f91e0fc6b55f1b4d812716d3ac9cd1e308991d`.

Il worker `nightly-elo-recalc` è distribuito con verifica JWT. Il controllo HTTPS ha restituito 200 per il chiamante di servizio, 403 per il chiamante pubblico e 401 per un token contraffatto. Lo scheduler usa pg_cron, pg_net e una credenziale custodita in Vault: controlla ogni minuto e invia il lavoro soltanto quando la sorgente differisce dalla pubblicazione. I controlli sono registrati in [lettura online](evidence/elo-v1-live-read-validation.json) e [worker HTTPS](evidence/elo-v1-live-worker-validation.json); non contengono credenziali.

Il successivo collaudo live tramite SDK ha superato cinque casi: creazione con punteggio esatto e replay della stessa richiesta; modifica amministrativa di una partita altrui e rifiuto `PT409` della revisione superata; rifiuto `42501` per utente ordinario e blocco delle scritture dirette legacy; creazione, modifica ed eliminazione dei commenti propri con rifiuto degli interventi sui commenti altrui; pubblicazione ELO aggiornata tramite worker HTTPS. Il riferimento è il [report delle mutazioni online](evidence/elo-v1-live-qa-mutations.json). Queste prove verificano i percorsi SDK, Auth e permessi utilizzati, non le interazioni attraverso il browser.

Il ripristino esatto dell'hook di registrazione originale e la chiusura delle registrazioni sono stati verificati tramite SQL. Account, partite, cataloghi, commenti, ricevute e quattro pubblicazioni intermedie di prova sono stati rimossi. Restano 483 partite, 1359 punteggi, 18 giochi, 6 giocatori e 7 commenti; il risultato ELO coincide con il baseline iniziale. La pubblicazione corrente è alla revisione 41. Prova: [cleanup](evidence/elo-v1-live-qa-cleanup.json).

## Limiti del collaudo

- I controlli live coprono lettura pubblica, salvataggi e permessi nei cinque casi SDK descritti, oltre al worker HTTPS. Il collaudo dell'interfaccia web con account autenticati non è stato eseguito: non sono verificati nel browser login, compilazione dei moduli, navigazione e recupero visibile degli esiti.
- La suite sintetica locale e lo shadow privato sul PC verificano transazioni, replay, conflitti e conservazione dei dati; restano evidenze distinte dai cinque casi Auth/permessi eseguiti sul backend remoto. La pulizia del collaudo remoto è verificata, con zero account, ricevute e pubblicazioni temporanei.
- Il runner `node scripts/test-web-elo-read-fixture.mjs` ha superato otto controlli con SDK reale su HTTP loopback: stessa identità per le quattro proiezioni, variazioni partita, metadati delle immagini, stati `stale`/`missing`, scope errato, payload parziale e assenza di chiamate legacy. Non controlla il DOM o l'aspetto delle pagine. Il tentativo di collaudo browser non ha trovato superfici abilitate: CUA ha risposto `Browser is not available: iab`, con inventario `apps: []`, `browsers: []`.
- I risultati `stale` e `missing` non espongono rating precedenti. Le pagine chiedono di ricaricare per verificare gli aggiornamenti: non eseguono polling automatico. La frequenza dello scheduler non garantisce che un calcolo termini entro un minuto.
- L'editor richiede localStorage e Web Locks disponibili: se il giornale o il blocco tra schede non sono verificabili, impedisce nuovi salvataggi. Il giornale conserva dati della richiesta e ricevuta, senza bearer token. La sua gestione è distinta dai dati già confermati nel database.

Il backend sostiene la prima stabile privata Android 0.5.0/code 15, verificata con MainActivity e account reali su emulatore del PC. La prova Android non sostituisce il collaudo dell'interfaccia web dopo il deploy, che resta non eseguito.

## Ripetere la verifica locale

Il runner `scripts/test-elo-v1-candidate.mjs` ripete i 14 casi della suite candidata: installazione 01/02, permessi, ordine dei partecipanti, pubblicazione/replay, conflitti, invalidazione e rollback, worker globale, concorrenza, cascade, storico vuoto, cutover 03 e scheduler 04 con mock locali. Non apre connessioni cloud e non legge credenziali.

Servono Windows, Node 24, le dipendenze del checkout già installate e PostgreSQL 17 (`initdb.exe`, `pg_ctl.exe`, `psql.exe`). La fixture è una dipendenza esplicita: il generatore di KingScore-Android ricrea schema e ruoli dal catalogo salvato nell'audit, senza importare account o partite reali.

Da PowerShell, adattare il percorso del checkout Android; eseguire il secondo comando dalla radice web:

```powershell
$androidRepo = 'C:/percorso/KingScore-Android'
node "$androidRepo/local-tests/generate-baseline.mjs" "$androidRepo/.work/elo-v1-baseline.sql"
node scripts/test-elo-v1-candidate.mjs --fixture-sql "$androidRepo/.work/elo-v1-baseline.sql" --postgres-bin "C:/Program Files/PostgreSQL/17/bin"
```

Il runner crea un cluster nuovo in `.work/local-elo-v1/<UUID>`, sceglie una porta libera e usa soltanto `127.0.0.1`. Rimuove dall'ambiente dei processi le variabili PostgreSQL/PostgREST ereditate, usa un file password vuoto e arresta esclusivamente il proprio cluster nel `finally`. Conserva report e log; non elimina directory e non avvia CI. Un errore produce exit code 1. Il report deve riportare `status=PASS`, `caseCount=14`, `serverStopped=true` e `remoteContacted=false`.

Il caso 04 esegue il corpo dello script originale con mock di `net.http_post`, `cron.schedule` e Vault; rimuove soltanto i due `CREATE EXTENSION` dalla copia in memoria. Verifica token sintetico, richiesta soltanto quando la sorgente cambia, timeout e pianificazione ogni minuto. Non verifica installazione delle estensioni, consegna HTTPS, GoTrue o scheduler cloud.

I risultati pubblicabili sono in [elo-v1-candidate-validation.json](evidence/elo-v1-candidate-validation.json). Il distinto [elo-v1-shadow-validation.json](evidence/elo-v1-shadow-validation.json) registra i sei controlli dello shadow locale sul baseline privato: guard contro modifiche successive alla cattura, transazione completa, identità del risultato ELO, conservazione dei punteggi e revoca dei permessi legacy. Contiene soltanto conteggi, esiti e hash; dati applicativi e SQL di installazione restano fuori dal repository. Il runner sintetico non ripete questo collaudo con dati reali.
