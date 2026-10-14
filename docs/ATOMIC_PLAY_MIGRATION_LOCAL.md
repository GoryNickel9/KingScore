# Installazione locale delle RPC partite V1

`scripts/atomic-play-migrations/01-install-rpcs.sql` è uno script transazionale di installazione, preparato per il collaudo sul PC. È separato dallo storico `supabase/migrations`: nessuna applicazione cloud o deploy è autorizzata da questo file. Richiede le tabelle, Auth e i ruoli già esistenti. Non crea utenti, ruoli o fixture Auth e non contiene l'adattatore sintetico `apply_positions`.

## Modifiche e controlli

1. Verifica proprietario fidato, PostgreSQL 15+, ruoli esistenti, tabelle ordinarie senza ereditarietà/partizionamento, tipi, nullabilità, primary key e default UUID. Il proprietario della migrazione deve possedere le tabelle applicative, poter leggere Auth e avere RLS bypass; i ruoli client non devono ereditarlo. Lo script rifiuta nomi RPC/schema privato già presenti, invece di sovrascrivere un'installazione precedente.
2. Richiede `played_at date`, senza conversioni dei timestamp o dei dati storici. Richiede `score numeric` senza precisione/scala imposte. Può aggiungere soltanto `plays.location`, `plays.bga_table_id`, `play_scores.color` e `play_scores.role` come colonne `text NULL`, se mancanti. Non riscrive owner, date, note, risultati o valori storici incompatibili.
3. Conserva i trigger timestamp validi appartenenti al profilo noto. Rimuove solo `public.play_scores.update_play_scores_updated_at` quando la colonna `updated_at` manca e nome, funzione, schema, linguaggio, corpo e struttura corrispondono al trigger noto. Non modifica `public.update_updated_at_column`, condivisa con altre tabelle. Trigger differenti, disabilitati o con struttura non supportata fermano l'installazione.
4. Converte i soli vincoli UNIQUE ordinari sull'esatta coppia `(play_id,player_id)` in `DEFERRABLE INITIALLY IMMEDIATE`, mantenendo nome, ordine delle colonne, unicità e commenti di constraint/index. Vincoli già deferrable rimangono tali. Indici autonomi, nomi constraint/index differenti, INCLUDE, predicate, espressioni, NULLS NOT DISTINCT, opclass non standard, ordinamento diverso, opzioni storage, tablespace esplicito, cluster/replica identity o FK dipendenti sono blocker. Non aggiunge un nuovo criterio di unicità e non modifica/cancella score per aggirare il vincolo.
5. Rifiuta gruppi BGA già duplicati per `(user_id,bga_table_id)` con owner non nullo prima del DDL. Non pulisce i dati e non introduce un indice BGA. Gli import senza owner restano dati storici, distinti dagli import del nuovo actor.

Le verifiche precedono il primo DDL. Lo script acquisisce lock sulle tabelle partite/punteggi per mantenere stabile lo schema e il controllo duplicati fino al commit. Qualunque errore lascia l'intera transazione senza installazione parziale. La primary key e la FK validata `play_scores.play_id -> plays.id ON DELETE CASCADE` sono prerequisiti del percorso di cancellazione.

## Contratto delle RPC

Le cinque RPC pubbliche sono `get_play_editor_v1`, `create_play_v1`, `update_play_v1`, `delete_play_v1` e `import_bga_play_v1`. Richiedono account esistente e `app_metadata.role=admin`; l'admin può operare sulle partite di qualsiasi owner. Le ricevute, la partita e i punteggi vengono scritti nella stessa transazione. Una chiave actor/request già usata accetta soltanto la stessa richiesta e restituisce la ricevuta precedente anche dopo una cancellazione.

Le revisioni continuano a includere tutte le colonne della partita e dei suoi punteggi, ordinati in modo deterministico. Escludono cataloghi, immagini, commenti e rating. Update/delete acquisiscono i lock e confrontano la revisione prima di scrivere. L'update conserva owner, location, BGA ID, created_at e i score ID mantenuti. Color e role derivano dai campi completi reinviati dal client; le colonne aggiuntive delle righe mantenute non vengono azzerate.

La scrittura score elimina soltanto i partecipanti omessi dal nuovo payload, aggiorna tutti gli score mantenuti in una singola istruzione `UPDATE ... FROM` e inserisce infine i partecipanti nuovi. Gli score mantenuti non vengono eliminati/reinseriti e `player_id` non viene posto temporaneamente a NULL. Un UPDATE bulk da solo non risolve lo scambio di due valori con una UNIQUE non deferrable: il profilo supportato richiede la conversione esplicita del vincolo, da verificare su PostgreSQL.

L'import conserva posizioni esterne e metadata. Il lookup BGA usa `INTO STRICT`: nessuna riga consente la creazione, una riga restituisce `skipped=true`, più righe producono 409. Il lock per actor/table serializza gli import delle nuove RPC. I writer legacy ancora abilitati possono creare duplicati senza cooperare: questa installazione non garantisce unicità BGA globale.

Le funzioni pubbliche sono SECURITY DEFINER, possedute dal ruolo fidato che esegue l'installazione, con search_path vuoto. I nuovi helper e le ricevute rimangono nello schema privato, senza accesso/EXECUTE per PUBLIC, anon, authenticated o service_role. Soltanto authenticated riceve EXECUTE sulle cinque RPC, che verificano comunque il ruolo admin. Lo script non revoca DML delle tabelle o l'EXECUTE di `replace_play_scores`.

## Collaudo sul PC e revisione futura

Usare soltanto PostgreSQL/PostgREST loopback e dati sintetici, tramite il harness locale. Eseguire lo script con `ON_ERROR_STOP=1`; non indirizzarlo verso il database applicativo o un servizio cloud. L'installazione imposta `lock_timeout=5s` e `statement_timeout=120s` prima del primo statement di verifica. Le funzioni hanno `lock_timeout=5s` per le attese dei lock. La proprietà `statement_timeout=30s` nelle funzioni non garantisce un limite allo statement RPC già iniziato: il timeout effettivo richiede un'impostazione esterna/PostgREST da validare separatamente prima del rollout. Il client web ha una deadline HTTP di 30s. Questa fase non modifica configurazioni cloud.

I controlli richiesti comprendono le prove di accettazione del contratto V1 e questi profili aggiuntivi: errore dello scambio con UNIQUE non deferrable, riuscita dopo la migrazione preservando ID/created_at/color/role, trigger valido conservato, trigger orfano riparato, colonne opzionali aggiunte, timestamp incompatibile con rollback, duplicati BGA con rollback e indici/vincoli non supportati rifiutati.

Il collaudo del 14 ottobre 2026 passa sul PC con PostgreSQL 17.4 e PostgREST 14.1: 16 profili di compatibilità e 21 casi di accettazione HTTP, inclusi 1.592 confronti del ranking e 170 richieste HTTP sintetiche. Il comando completo termina PASS con gateway e server propri arrestati. La fonte SQL verificata ha SHA256 `f0b4e4a28ba4bcc89c164627de8e9db2275b9aaaf1c51a083cfdbaebf8305047`.

Il runner in KingScore-Android esegue la fonte congelata, senza usare Supabase remoto:

```powershell
pwsh -NoProfile -File scripts/test-local-play-saves.ps1 -Atomic -WebMigrationDirectory .work/King-Score-atomic/scripts/atomic-play-migrations
```

Il comando va eseguito dalla repo Android con questo worktree web locale disponibile. I profili comprendono conversione UNIQUE in entrambi gli ordini, conservazione dei commenti e di metadati aggiuntivi, rifiuto di FK dipendenti e Auth senza PK, errore ON CONFLICT atteso e import ambiguo creato da writer legacy dopo l'installazione. Quest'ultimo restituisce PT409 senza scritture o ricevute. Ogni database clonato viene rimosso dopo il caso, lasciando query e report. L'adattatore di posizioni e il cutover usati dai 21 casi sono fixture locali separate: non entrano in questo SQL e non integrano i job reali. Auth/GoTrue e caller browser non sono collaudati da questa suite.

La conversione UNIQUE ricostruisce l'indice fisico esistente sotto lock; il costo dipende dai dati e non è ancora misurato su dati applicativi. Un vincolo UNIQUE deferrable non può essere usato come arbiter di `ON CONFLICT`: prima di un'applicazione cloud occorre verificare tutti i caller e le dipendenze. Il vincolo mantiene l'unicità, ma cambia il momento del controllo e le possibilità di utilizzo da SQL esterno.

La ricerca nel codice di questo checkout trova upsert su elo_history e player_general_ratings, non sulla coppia play_scores(play_id,player_id). Questo inventario del sorgente non certifica i consumer esterni o lo schema corrente del backend.

Questo file installa soltanto le RPC. Il cutover di writer web/Android, RPC legacy, service writer e cancellazioni di cataloghi resta distinto. Le cascade dai cataloghi possono ancora modificare partite/punteggi. Le RPC non ricalcolano ELO né rendono atomica la pubblicazione di rating e storico ELO. L'applicazione cloud richiede un'autorizzazione separata.
