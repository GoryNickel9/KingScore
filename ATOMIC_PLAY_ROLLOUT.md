# Rollout delle scritture partite

I writer web di creazione, modifica, eliminazione e import BGA sono pronti per le RPC atomiche. L'attivazione è esplicita: `VITE_ATOMIC_PLAY_WRITES=true`. In assenza del flag il sito usa i percorsi precedenti, così una build non richiede funzioni ancora assenti dal database. Con il flag attivo un errore RPC non provoca mai un fallback alle scritture dirette.

Nessuna migrazione è stata applicata al Supabase remoto durante questa attività. La CI GitHub resta sospesa. Le modifiche all'app Android riguardano la documentazione: la build 0.4.0 mantiene l'editor partite disabilitato.

## Contratti e salvataggi

| Percorso | Operazione |
| --- | --- |
| AddPlay | `create_web_play_v1`: partita e tutti gli score nella stessa transazione |
| EditPlay | `get_web_play_editor_v1`, poi `update_web_play_v1` con revisione e score ID conservati |
| PlayDetail | Snapshot all'apertura della conferma, poi `delete_play_v1` con la stessa revisione |
| Import BGA | `import_bga_play_v1` con location, bga_table_id e posizioni esterne nullable |

Gli adattatori web usano punteggi come stringhe decimali, per esempio `9007199254740993.125`. Il server converte in NUMERIC dopo aver verificato receipt e lock, senza passare da Number JavaScript. La revisione resta uguale a quella del getter Android, che continua a restituire token JSON numerici. Una nuova migrazione sostituisce il corpo dell'helper comune e mantiene i contratti Android originali.

Il client verifica online l'utente con il token della sessione, poi lega la richiesta RPC a quel token tramite Authorization. Un cambio account non può associare la richiesta pendente al nuovo utente. I comandi hanno request_id fissi; i consumer bloccano il doppio invio e permettono soltanto un retry esplicito della stessa richiesta dopo un esito incerto. Il modulo resta congelato durante quella verifica. Conflitti richiedono una rilettura esplicita, che avvisa della sostituzione della bozza. Risposte lette obsolete vengono scartate.

I comandi pendenti restano nella pagina aperta. Ricarica, smontaggio o chiusura del browser li perdono: non sono una garanzia di recupero della richiesta dopo un riavvio. Per un create manuale incerto verificare lo storico prima di creare una nuova partita dopo tali eventi. Non esiste una coda o un reinvio automatico. L'import BGA ha anche deduplica server per owner/table_id, utile quando si ripresenta lo stesso export dopo un timeout.

## Import e comportamento ELO del sito

L'import precarica interamente giochi, giocatori e table ID in pagine da 1.000, senza il filtro inesistente games.user_id o il precedente tetto silenzioso di 10.000 righe. Risolve tutti i partecipanti prima della RPC: un errore non lascia una partita senza score e non scarta silenziosamente una persona. Un esito incerto interrompe il batch e distingue partita incerta da partite non inviate; la pagina non dichiara l'import completato con successo. Le posizioni importate sono mantenute e non vengono derivate dal ranking manuale.

Le RPC non modificano rating o avviano ELO. I flussi web di ricalcolo già esistenti restano separati, dopo un successo confermato. Delete usa il proprietario storico dello snapshot. L'invalidazione dopo edit filtra esplicitamente lo storico per owner anche per admin globali; con owner null non ne inventa uno. Questa correzione non cambia l'algoritmo ELO. Android resta esclusivamente in lettura sui rating e non usa questi flussi web.

## Verifica locale

Richiede PowerShell 7, PostgreSQL 17 e Node 24:

```powershell
pwsh -NoProfile -File scripts/test-atomic-plays.ps1 -IncludeBgaImport -IncludeWebWriters -ConcurrentScript "$PWD/supabase/tests/atomic_play_concurrency.mjs"
npm run test
npm run lint
npm run typecheck
npm run build
```

Il runner applica su un cluster loopback separato le tre migrazioni additive, le suite SQL e il cutover simulato. Le prove concorrenti coprono create/update/delete, doppio import BGA e aggiornamento simultaneo web/Android. I test callback React usano hook controllati: verificano le decisioni dei callback, non DOM, focus, accessibilità o comportamento reale del browser. Le claim SQL sono sintetiche; firma JWT, login e gateway Supabase richiedono ancora collaudo HTTP.

## Sequenza di attivazione

1. Preparare un ambiente di prova separato e verificare nuovamente catalogo, grant e policy. Il fixture SQL locale contiene ruoli e funzioni auth sintetici: non applicarlo a un Supabase cloud.
2. Applicare, in ordine, `20261013000000_atomic_play_writes.sql`, `20261013010000_atomic_bga_import.sql` e `20261013020000_web_play_score_text.sql`, dopo aver riconciliato la storia delle migrazioni. Non eseguire un push indiscriminato delle migrazioni vecchie.
3. Collaudare via HTTP account admin/ordinario, revoca del ruolo, timeout, revisioni, import e consumer web con il flag true. Il limite V1 resta 1..63 partecipanti e 1 MiB di payload. NUMERIC si salva esattamente, mentre il ranking manuale conserva il confronto Float64 del sito.
4. Distribuire tutti i writer web con il flag true e poi applicare separatamente `supabase/rollout/atomic_play_cutover.sql`. Questo script revoca DML diretto e `replace_play_scores` ad anon/authenticated; le vecchie pagine devono essere ricaricate. Le RPC e le letture restano abilitate. Non è una migrazione automatica, per impedire che la preparazione disabiliti il sito precedente.
5. Abilitare l'editor Android solo dopo queste verifiche. Prima della stabile restano collaudo browser, JWT reali, telefoni, rete e APK firmato.

Il cutover richiede che ogni writer sia adeguato: finché scritture dirette o replace_play_scores sono accessibili, un client vecchio può ancora produrre modifiche non atomiche. Dopo il cutover non riportare il frontend al percorso legacy senza una procedura esplicita di rollback dei permessi.
