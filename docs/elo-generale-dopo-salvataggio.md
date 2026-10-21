# ELO Generale dopo il salvataggio

Dal 22 ottobre 2026 il trigger `kingscore_elo.mark_dirty()` accoda il worker ELO quando una transazione modifica partite, punteggi, giochi o giocatori. La richiesta usa il dispatcher privato già installato e parte dopo il commit, come previsto da [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net).

La migrazione `supabase/migrations/20261022010000_dispatch_elo_after_source_commit.sql` sostituisce soltanto il trigger esistente. Formula, worker, permessi e pubblicazione atomica restano quelli già in uso. Una variabile locale alla transazione evita richieste duplicate quando il salvataggio scrive sia partita sia punteggi. Il rollback annulla anche l'accodamento; un errore di accodamento viene intercettato senza annullare il salvataggio. Il job periodico esistente, ogni minuto, resta attivo per il recupero.

`waitForCurrentGlobalElo` aggiorna Dettaglio partita, Rating ELO, Statistiche e Wrapped ogni secondo finché la pubblicazione è `missing` o `stale`. Le richieste sono sequenziali e terminano quando il risultato è corrente, dopo tre errori consecutivi o dopo due minuti. Uscire dalla pagina annulla timer e richiesta in corso. In caso di errore la schermata propone di ricaricare. L'ELO della singola partita conserva il percorso rapido introdotto nella release precedente.

## Verifiche

- `npm test`: 457 test superati, inclusi nove casi sul nuovo aggiornamento automatico.
- `npm run typecheck` e `npm run build`: superati. Lint: zero errori, 16 warning già presenti.
- `node scripts/test-immediate-elo-dispatch.mjs`: sette casi su PostgreSQL 17 locale, inclusi rollback, savepoint, errore del dispatcher e assenza di ricorsione. Il test usa una coda transazionale simulata e non contatta la produzione.
- Browser con fixture locale: il dettaglio passa da ELO Generale assente a valori pubblicati senza navigazione o reload. Classifica, Statistiche e Wrapped mostrano i risultati quando la fixture diventa corrente.
- Produzione: aggiornamento senza variazioni di contenuto su una partita esistente; revisione 129 → 130, worker HTTP 200, 496 partite elaborate, zero saltate. Il risultato completo prima e dopo ha lo stesso SHA-256.

Nella prima prova online la lettura pubblica è diventata corrente entro **7,486 secondi dall'avvio del comando di verifica**, comprendendo il tempo del comando amministrativo e della rete. La prima lettura dopo il ritorno del comando era ancora in attesa; 4,180 secondi dopo il ritorno era corrente. Il vecchio controllo aveva osservato circa 40,3 secondi dopo un salvataggio reale. Le due prove hanno punti di partenza diversi: il nuovo tempo è una misura tecnica su un aggiornamento senza variazioni, non una garanzia per ogni salvataggio da browser.

Il campo `created` della risposta pg_net non viene usato per stimare la durata del calcolo: non rappresenta una misura affidabile della fine del worker. L'evidenza usa le letture pubbliche successive all'operazione.

## Pubblicazione e limiti

La migrazione è stata applicata esplicitamente al database collegato dopo aver verificato la definizione del trigger e conservato una copia privata per il ripristino. Non è stato eseguito un aggiornamento generale delle vecchie migrazioni. Il frontend viene pubblicato separatamente su Vercel.

Più transazioni contemporanee possono avviare più worker; il controllo della revisione esistente impedisce la pubblicazione di risultati superati. Un'importazione con molti salvataggi separati può quindi generare più richieste. Il calcolo dipende dalla disponibilità del worker e della rete; il job periodico resta il recupero in caso di errore. Non sono state create partite o commenti di prova in produzione.
