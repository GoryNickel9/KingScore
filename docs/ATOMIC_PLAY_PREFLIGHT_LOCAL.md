# Preflight locale delle RPC partite V1

`scripts/atomic-play-preflight.sql` produce un report JSON di compatibilità. Non è una migrazione: apre una transazione `READ ONLY`, legge cataloghi e duplicati BGA, poi termina la transazione. Non crea Auth, ruoli, funzioni o RPC; non modifica schema, dati, trigger, vincoli o permessi.

Il report usa `blocked` quando rileva almeno un `BLOCKER`, `conditional` quando restano decisioni esplicite, e `compatible` per il solo sottoinsieme di controlli eseguito. Il codice di uscita zero di psql indica che il controllo SQL è riuscito, anche quando il report è `blocked`. I chiamanti devono leggere `status`, `blockers`, `conditions` e `findings`.

## Controlli

1. Colonne richieste di partite e punteggi, tipi e primary key. `played_at` deve essere `date`: `timestamptz` è un blocker, senza conversioni. Il punteggio richiede `numeric` senza precisione/scala imposte. Le colonne nullable storiche restano soggette alla validazione e al controllo di editabilità delle future RPC.
2. Trigger che scrivono `updated_at`. Una colonna assente o incompatibile è un blocker. Un trigger compatibile viene conservato; abilitazione o struttura non standard richiedono una decisione. Il controllo strutturale non dimostra la correttezza del corpo della funzione. Altri trigger attivi sulle due tabelle richiedono revisione.
3. Indici UNIQUE incondizionati sull'esatta coppia `(play_id,player_id)`, anche con ordine inverso o colonne INCLUDE. Il report segnala il rischio degli aggiornamenti sequenziali di `player_id`, senza modificare il vincolo. Non certifica indici parziali, espressioni o altri vincoli di unicità.
4. Gruppi BGA duplicati per `(user_id,bga_table_id)` con owner non nullo, e import storici privi di owner. I duplicati bloccano la compatibilità: il report non sceglie una partita arbitraria e non propone cancellazioni automatiche. Lo stesso table ID per owner differenti resta consentito dal contratto.
5. Cascade FK `games -> plays` e `players -> play_scores`. Restano condizioni da risolvere prima del cutover: revocare DML sulle due tabelle non impedisce le cancellazioni a cascata originate dai cataloghi.

## Prove sul PC

Servono PowerShell 7 e PostgreSQL locale, predefinito in `C:\Program Files\PostgreSQL\17\bin`:

```powershell
pwsh -NoProfile -File scripts/test-atomic-play-preflight.ps1
```

Il runner inizializza un cluster proprio in una directory temporanea univoca, lo vincola a `127.0.0.1` su una porta libera e usa database sintetici separati. Non legge `.env`, credenziali, Supabase o il database dell'applicazione. Elimina le variabili PostgreSQL/proxy ereditate dai processi figli, usa `psql -X` e connessioni esplicite. Il `finally` arresta soltanto il cluster appena creato; report, fixture e log restano nella directory temporanea per la diagnosi.

Le prove coprono schema compatibile, tabella/colonne mancanti, data timestamp, score di tipo errato o con scala limitata, trigger orfano/valido/disabilitato, timestamp senza trigger, UNIQUE partecipanti, duplicati BGA, owner distinti e mancanti, cascade cataloghi, tabelle foreign, ereditarietà con figlio foreign e un ruolo locale con RLS che nasconde duplicati. Gli oggetti foreign non hanno handler: un tentativo di scansione fallirebbe. Ogni caso verifica `transaction_read_only=on` e confronta un fingerprint di colonne, vincoli, trigger, funzioni e righe sintetiche prima e dopo; le letture dei fingerprint usano `ONLY` e ignorano oggetti foreign.

Per una lettura diagnostica manuale, usare esclusivamente un database locale autorizzato e un ruolo con visibilità completa delle righe:

```powershell
& 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -X -w -h 127.0.0.1 -p <porta-locale> -U <ruolo-locale> -d <database-locale> -v ON_ERROR_STOP=1 -qAt -f scripts/atomic-play-preflight.sql
```

Una scansione che supera 15 secondi fallisce senza produrre un report completo. Un ruolo che non è superuser o BYPASSRLS produce una condizione sulla visibilità; con RLS attivo la scansione BGA viene saltata per evitare falsi negativi. Le scansioni usano `ONLY`; tabelle foreign, viste e tabelle che partecipano a ereditarietà/partizionamento sono blocker e non vengono scansionate.

## Limiti

Questo controllo non installa né prova le RPC. Non è una verifica completa di schema o permessi: non certifica Auth reale, FK diverse dalle cascade elencate, default, campi di visualizzazione dei cataloghi, ownership delle funzioni SECURITY DEFINER, grant effettivi, il cutover dei vecchi writer, la pubblicazione ELO o il rollout. I metadati salvati e lo storico delle migrazioni divergono: una diagnosi positiva sullo schema sintetico non rende replayabile lo storico SQL. Restano separati l'atomicità delle partite e la pubblicazione di rating/storico ELO.

Il runner non esegue operazioni cloud, deploy, commit o push. La migrazione additiva e il suo collaudo sul PC restano distinti da questo preflight. L'applicazione cloud richiede un'autorizzazione separata.
