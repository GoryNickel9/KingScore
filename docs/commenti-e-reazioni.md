# Risposte e reazioni

Il sito e Android 0.7.11/code 33 permettono agli utenti autenticati di rispondere a un commento e reagire ai commenti o alle note di partita.

«Rispondi» apre il modulo con autore e testo del commento originale. La risposta rimane nell'elenco cronologico e può ricevere altre risposte. Su entrambi i client, solo l'autore trova i controlli per modificare o eliminare il proprio testo. Eliminare l'originale conserva le risposte, che diventano commenti indipendenti. La citazione mostra il testo corrente, senza conservarne una copia storica.

Ogni utente può scegliere una reazione per ciascun commento e una per le note della partita. Toccare un'altra emoji sostituisce la scelta; toccare quella selezionata la rimuove. Le dodici scelte sono 👍 ❤️ 😂 🎉 😮 👏 🔥 🤔 😢 😡 🤯 👎. Il numero accanto all'emoji è il conteggio degli utenti. Le note vuote non offrono reazioni. I dati si aggiornano entrando nel dettaglio, ricaricandolo o dopo una propria operazione; non è presente una sottoscrizione realtime.

## Contratto e integrità

Le migrazioni web `20261029010000_comment_replies_and_reactions.sql` e `20261029011000_validate_comment_reply_target.sql` aggiungono `play_comments.parent_comment_id` e `play_reactions`. Devono essere applicate prima di pubblicare i client. La prima migrazione non è riapplicabile. Le installazioni Android precedenti continuano a leggere e scrivere commenti, senza mostrare i nuovi collegamenti o le reazioni.

Il riferimento al commento originale è facoltativo, limitato alla stessa partita e assegnato all'inserimento. Il genitore deve già esistere; inserimenti multipli non possono creare cicli. La cancellazione del genitore azzera soltanto il riferimento, senza cambiare autore o data di modifica della risposta. Il decoder Android accetta fixture precedenti prive della colonna. `contracts/v1/additive-columns.json` registra l'estensione del catalogo usata dal generatore: l'audit storico rimane invariato.

La chiave unica `NULLS NOT DISTINCT (play_id, comment_id, user_id)` garantisce una sola reazione per autore e destinazione, incluse le note (`comment_id = NULL`). Una foreign key composta impedisce reazioni su commenti di altre partite. La cancellazione del commento rimuove le sue reazioni; la cancellazione della partita elimina tutti i dati collegati. RLS consente lettura come per i commenti e limita inserimento, modifica e cancellazione delle reazioni al proprio account, anche per gli amministratori. L'emoji deve appartenere all'elenco condiviso. Non sono trasmesse notifiche.

Le scritture delle reazioni assegnano uno stato esplicito tramite upsert o cancellazione e sono idempotenti. I client rileggono i conteggi prima di confermare il risultato. Un errore mantiene le reazioni disabilitate fino a una rilettura riuscita. Le risposte riutilizzano il registro Android degli esiti incerti dei commenti, senza ripetere automaticamente una creazione.

## Verifica

Sul PC, con il checkout King-Score accanto a KingScore-Android:

```powershell
node scripts/test-local-discussion.mjs
node --test scripts/check-evidence.test.mjs contracts/tests/play-save-contracts.test.mjs
./gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest
```

La prova PostgreSQL crea un cluster isolato su loopback e lo arresta al termine. Verifica vincoli, cicli, RLS, rifiuto delle scritture anonime, note assenti, tutte le emoji, upsert delle note, sostituzione/rimozione, cancellazione e conservazione dell'attribuzione. Non contatta il database remoto.

I test JVM coprono payload, sessione verificata, destinazione restituita, isolamento tra note e commenti, blocco dopo errore e risultati tardivi dopo la chiusura dell'account. `CommentsUiTest` copre risposte, reazioni e caratteri ingranditi. Sul web i test di `playReactions` e `ReactionBar` controllano selezione, conteggi, accessibilità e blocco dopo errore; la fixture del browser verifica l'interazione con SDK e API simulate.

La qualifica dell'APK e i limiti delle prove sono registrati separatamente nella repo KingScore-Android, in `docs/STABILITY.md`. Nessun benchmark prestazionale è richiesto per questa funzione; non vengono dichiarate misure di throughput o latenza.
