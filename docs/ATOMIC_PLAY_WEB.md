# Salvataggi web atomici — integrazione locale

Stato al 15 ottobre 2026: codice preparato nel branch `codex/atomic-play-writers`; nessun push web, deploy Vercel o modifica Supabase. Le cinque RPC devono essere installate e verificate prima dell'attivazione. Questa integrazione non certifica il backend online.

## Comportamento

Creazione, modifica, eliminazione e import BGA usano `AtomicPlayWriter`. Non esiste fallback verso INSERT/UPDATE/DELETE separati di `plays` e `play_scores`. `VITE_ATOMIC_PLAY_WRITES=true` abilita i nuovi moduli; il valore assente o diverso da `true` li blocca. Il flag non è un controllo di autorizzazione: il database deve verificare ogni richiesta.

Il client verifica l'utente tramite Auth, il ruolo admin e la connessione prima di procedere. La modifica carica `get_play_editor_v1`, conserva proprietario storico, ID dei punteggi, colore, ruolo e decimali testuali. Un conflitto 409 conserva la bozza e mostra il confronto; solo una scelta esplicita sostituisce la bozza e la revisione. I dati storici incompatibili rimangono consultabili e non vengono normalizzati per forzarne il salvataggio.

Il journal del browser conserva UUID, corpo originale e conferma per progetto/attore, senza bearer token. Un esito incerto blocca nuovi salvataggi. Il pulsante di verifica ripete soltanto la richiesta memorizzata; la conferma persistita viene ripristinata senza una nuova POST. Le Web Locks impediscono due mutazioni contemporanee fra schede; il loro mancato supporto blocca il salvataggio. Il coordinatore ignora risultati di una pagina smontata o di un account precedente.

La cancellazione richiede uno snapshot verificato e una conferma. Se la partita cambia dopo lo snapshot, il server deve rifiutarla. L'import risolve tutti i partecipanti prima di salvare ciascuna partita; un esito incerto ferma il batch. Il server gestisce deduplicazione attore/tavolo e replay. Il batch completo non è una singola transazione.

Giochi e giocatori di catalogo vengono creati separatamente. Possono rimanere se il salvataggio successivo fallisce; una creazione con risposta persa richiede riconciliazione del catalogo, non un retry automatico. Nella creazione manuale gli ID temporanei vengono sostituiti conservando punteggio e vincitore. Il parser BGA mantiene i punteggi come testo e il giorno locale indicato nel testo; nomi numericamente ambigui richiedono conferma.

## ELO e pubblicazione

I nuovi handler non invocano il vecchio ricalcolo/invalidation dopo la mutazione: erano richieste separate, non coordinate con la revisione, e nel caso di admin globale potevano usare l'account sbagliato. La conferma riguarda partita e punteggi; il messaggio segnala che le classifiche richiedono un ricalcolo separato. Questa differenza di comportamento resta un blocco alla pubblicazione, finché viene definito e verificato il protocollo ELO.

Il successivo [contratto ELO con prove locali](ELO_PUBLICATION.md) verifica una generazione completa associata alla revisione sorgente, mantenendo la formula. Rimane un prototipo separato: non è ancora collegato ai writer o ai reader reali.

Restano da coordinare anche i writer server/notturni, `replace_play_scores`, vecchie schede web e cancellazioni di giochi/giocatori che producono cascade. La migrazione `scripts/atomic-play-migrations/01-install-rpcs.sql` è additiva: non chiude questi percorsi. Non attivare il flag in produzione soltanto perché build e unit test passano.

L'accesso pubblico del sito resta invariato. Il login obbligatorio e il blocco totale senza Internet dell'app Android non vengono trasferiti alle pagine pubbliche web.

## Risultati del checkpoint

Il 15 ottobre 2026: 250 test in 12 file PASS; typecheck PASS; lint 0 errori e 16 warning; build con flag disabilitato e abilitato PASS. Il report verificabile è [web-play-integration.json](evidence/web-play-integration.json), con hash dei sorgenti e dei log sintetici. Le tre regressioni per storage negato e la revoca admin sono incluse nelle verifiche.

## Prove riproducibili sul PC

```powershell
npm test
npm run typecheck
npm run lint
npm run build
node scripts/web-play-ui-fixture.mjs
```

L'ultimo comando avvia una fixture HTTP e Vite esclusivamente su `127.0.0.1`, stampa gli URL e scrive `.work/web-ui-fixture.json`. Sovrascrive la configurazione Auth/API con dati sintetici e imposta una CSP che blocca richieste fuori da loopback. Login sintetico: `admin@example.invalid`, password di prova non vuota; non inserire credenziali reali. Fermare il processo al termine.

La fixture verifica React, SDK, pagine e trasporto, non le transazioni PostgreSQL né Auth/RLS reali. L'endpoint locale `/__qa` espone lo stato sintetico e permette di selezionare `conflict`, `lost-response` (ricevuta troncata dopo il commit simulato), `uneditable`, `normal` e ruolo di prova. Non viene incluso nel bundle del sito.

Collaudo browser eseguito: admin su partita di altro proprietario; confronto 409 senza autosave; salvataggio dopo sostituzione esplicita; nuovo giocatore con score `9007199254740993.125` e vincitore; eliminazione con snapshot; recupero dopo reload con UUID/body identici e una ricevuta; storico incompatibile non modificabile; import BGA con data e score esatti. Il vecchio dettaglio pubblico usa ancora numeri JavaScript: il test di precisione riguarda editor, payload e database, non quella visualizzazione preesistente.

La migrazione congelata è stata rieseguita separatamente nel runner PostgreSQL/PostgREST della repo Android: 16 profili di compatibilità e 21 casi di accettazione PASS, senza contatti remoti; server fermati. Il browser non è stato collegato direttamente a quel database: i due livelli di verifica restano distinti.

GitHub CI non eseguita. Prima di qualsiasi deploy occorrono inventario reale autorizzato, decisioni sui percorsi legacy e sull'ELO, backup e ripristino collaudati, verifica Auth/RLS effettiva e approvazione esplicita delle modifiche cloud.

Il successivo [contratto di lettura ELO](ELO_READ_CONTRACT.md) fissa una classifica globale su tutte le partite, come richiesto dall'utente. Decoder e proiezioni sono verificati separatamente sul PC; le pagine legacy non sono ancora collegate al nuovo servizio e l'editor resta subordinato alle condizioni backend.
