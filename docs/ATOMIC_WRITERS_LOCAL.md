# Preparazione dei writer atomici sul PC

L'utente ha autorizzato il 14 ottobre 2026 modifiche al codice web e preparazione della migrazione, con test locali. Gli amministratori devono poter modificare tutte le partite. Questa fase non autorizza pubblicazione del sito, deploy o modifiche al database remoto.

`src/services/playSaveRequests.ts` prepara gli argomenti delle cinque RPC V1 definite nel contratto conservato in KingScore-Android. Mantiene UUID e corpo originale per il recupero esplicito, senza rigenerare una richiesta dopo esito incerto. I punteggi restano stringhe decimali; null e zero sono distinti. Controlla campi, metadati, UUID, date, partecipanti unici, risultato cooperativo, posizioni BGA e limiti UTF-8 del JSONB.

Il modulo non esegue HTTP, non verifica l'identità e non salva ricevute. Non è ancora collegato alle pagine: trasporto, gestione dell'esito e migrazione rimangono da implementare e collaudare. La verifica admin appartiene al writer e al database, non al costruttore della richiesta.

Verifiche locali: 16 nuovi casi; suite completa 62 test superati; typecheck applicazione/script ed ESLint dei due nuovi file superati. I test usano dati sintetici e non inviano richieste al backend.

Prima della migrazione occorre verificare la compatibilità: storico SQL e catalogo salvato divergono su tipi/colonne, trigger e vincoli. Il caso di scambio dei partecipanti con UNIQUE(play_id,player_id), i duplicati BGA e le cancellazioni cascade dei cataloghi richiedono prove aggiuntive. La fixture locale non va convertita in migrazione togliendo semplicemente il suo guard. Le RPC partita non rendono atomica la pubblicazione dei rating/storico ELO.
