# Centro notifiche e menzioni

Il sito e Android 0.8.0/code 35 condividono un centro notifiche per risposte, reazioni ai propri commenti e menzioni. La campanella mostra le notifiche non lette. Aprire una voce la segna come letta e porta al commento; «Segna tutte come lette» aggiorna lo stesso account su entrambi i client.

Le notifiche iniziano dall'installazione della migrazione `20261102010000_discussion_notifications_and_mentions.sql`. Non viene ricostruita l'attività storica. Le versioni Android precedenti continuano a funzionare e le loro risposte e reazioni generano notifiche per i destinatari che usano un client aggiornato.

## Menzionare una persona

Scrivere `@` nel commento o nella sua modifica apre una ricerca tra gli account registrati. Selezionare una persona inserisce `@nome` e aggiunge il suo identificativo ai destinatari. I nomi uguali sono distinguibili tramite un suffisso dell'ID. La ricerca restituisce al massimo venti risultati; un commento può menzionare al massimo dieci account. L'elenco non espone email o metadati di accesso.

Il testo scritto senza selezione non genera una menzione. Il collegamento resta valido dopo un cambio di nome perché `play_comments.mentions` conserva `{user_id, label}`: l'ID identifica il destinatario e il nome è una copia del testo selezionato. Il controllo «Rimuovi menzione» conserva il testo ma rimuove il destinatario. Eliminare il testo `@nome` rimuove anche il destinatario. Gli aggiornamenti dai vecchi client rimuovono le menzioni il cui testo non è più presente.

## Eventi e integrità

I trigger creano la notifica nella stessa transazione del commento o della reazione. Il destinatario può essere offline. Non vengono generate notifiche per le proprie azioni. Una risposta che menziona anche l'autore originale produce una sola voce per quella persona. Le menzioni ad altre persone producono le rispettive voci.

Modificare il testo non ripete una notifica già generata. Aggiungere un nuovo destinatario genera una menzione; rimuoverlo ritira quella notifica. Cambiare emoji aggiorna la voce esistente senza riportarla tra le non lette. Rimuovere la reazione elimina la sua notifica. Eliminare un commento o una partita elimina le relative voci; le risposte indipendenti restano gestite dal contratto precedente. Le reazioni alle note non notificano nessuno perché le note non hanno un autore univoco.

`discussion_notifications` ha RLS e un indice per destinatario, data e ID, più un indice delle non lette. Il client può solo leggere le proprie righe. Le scritture dirette sono revocate. Le RPC `notification_feed`, `mark_notifications_read` e `search_mention_users` richiedono un account autenticato; il destinatario viene ricavato da `auth.uid()`. I trigger non sono invocabili dai client. Le funzioni con privilegi del proprietario hanno `search_path` vuoto e oggetti qualificati. [Sicurezza delle funzioni PostgreSQL](https://www.postgresql.org/docs/current/sql-createfunction.html), [RLS Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).

Il feed usa pagine da quaranta voci e un cursore composto da timestamp e UUID. Il client conserva la precisione del timestamp. La lettura è idempotente e usa l'orario del server. I risultati tardivi vengono scartati dopo uscita o cambio account. Un errore di lettura mantiene i dati precedenti e mostra il mancato aggiornamento.

## Aggiornamento e limiti

Il feed si aggiorna ogni trenta secondi mentre il client è visibile, al rientro nell'app e con «Aggiorna». Il conteggio comprende tutte le non lette. Le pagine precedenti già aperte restano visibili durante l'aggiornamento; «Aggiorna» rilegge l'elenco dalla prima pagina. Le schede web sincronizzano anche il segnale di lettura tramite storage locale, quando disponibile. Le letture effettuate su un altro dispositivo diventano visibili al successivo aggiornamento; ricaricare l'elenco aggiorna anche le singole righe delle pagine precedenti.

Questa versione non integra push di sistema, Firebase, email o service worker. L'attività viene conservata nel database anche quando l'app è chiusa e viene letta al rientro. Commenti e reazioni mantengono il loro aggiornamento esplicito precedente.

## Verifiche ripetibili

Nel checkout Android, `node scripts/test-local-notifications.mjs` avvia un PostgreSQL 17 temporaneo sul PC e verifica trigger, isolamento RLS, privilegi, cursori con timestamp uguali, deduplicazione, rollback, menzioni e cancellazioni. Arresta il proprio cluster al termine e non contatta Supabase. `node scripts/test-local-discussion.mjs` copre il contratto precedente.

Nel checkout web: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`. I test del modulo `discussion` verificano input, ID, inserimento al cursore, rimozione del destinatario e conservazione delle pagine; il rendering verifica escape HTML e nomi con caratteri speciali. `node scripts/web-play-ui-fixture.mjs` espone una fixture sintetica su loopback per campanella, lettura, navigazione e composizione.

Nel checkout Android: `./gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest`. Le prove JVM verificano payload, sessione, rete, account, decodifica, lettura e risposte tardive. `CommentsUiTest.mentionSelectionSavesStableAccountAndNotificationOpensComment` verifica selezione e salvataggio della menzione e navigazione dalla notifica. La qualifica della release è registrata in `docs/STABILITY.md` del checkout Android.
