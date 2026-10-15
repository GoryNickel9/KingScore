# Regole di classifica e pareggi

## Configurazione del gioco

La tabella `games` contiene due proprietà obbligatorie:

| Campo | Default | Effetto |
|---|---|---|
| `lower_score_wins` | `false` | Ordina i punteggi dal più basso al più alto |
| `shared_score_positions` | `true` | Assegna la stessa posizione ai punteggi uguali, con numerazione 1, 2, 2, 4 |

Le opzioni sono disponibili in Libreria Giochi, sia nella creazione sia nella
modifica, e nella creazione rapida del gioco dal modulo Nuova Partita. Per Pili
Pili entrambe sono attive. Il valore storico 7 resta invariato.

Se si disattivano le posizioni condivise, i punteggi uguali mantengono l'ordine
delle posizioni importate. Nei nuovi inserimenti manuali, senza posizioni
esplicite, vale l'ordine dei giocatori selezionati. Non vengono inventate regole
di spareggio specifiche del gioco. La modifica di una partita conserva le
posizioni esistenti per applicare questo ordine.

Un punteggio mancante non equivale a zero. Se tutti hanno una posizione esplicita
e manca almeno un punteggio, il motore usa la classifica importata, comprese le
posizioni condivise. Negli altri casi i punteggi mancanti vanno in fondo e non
producono un pareggio per il solo fatto di mancare.

Salvare una modifica alle regole di un gioco esistente ricalcola posizioni,
rating e cache per i proprietari delle partite coinvolte. Il ricalcolo legge
le proprietà del gioco dal database. Un errore viene mostrato all'utente con
l'indicazione di riprovare dalla pagina Rating ELO; il salvataggio delle proprietà
e il ricalcolo manuale sono operazioni distinte.

## Risultato ELO ed esito V/P/S

Il risultato ELO competitivo è la media dei confronti con gli altri giocatori:

```text
S_i = (avversari superati + 0.5 × avversari pari) / (N - 1)
R_i' = round(R_i + K_i × (S_i - E_i))
```

La formula vale per tutti i giochi competitivi, anche per i primi posti
condivisi. A posizioni `1, 1, 3` corrispondono risultati `0.75, 0.75, 0`;
a posizioni `1, 2, 2, 4` corrispondono `1, 0.5, 0.5, 0`.

Il conteggio V/P/S segue la convenzione confermata dall'utente:

- V: vittoria senza primo posto condiviso.
- P: primo posto condiviso o pareggio totale.
- S: gli altri risultati, compreso un piazzamento condiviso fra sconfitti.

Nei cooperativi i compagni non sono avversari pari: una vittoria del gruppo
conta V per tutti, una sconfitta S per tutti. Un esito di squadra esplicito vale
1 oppure 0 nel risultato ELO. La calibrazione teorica del rating cooperativo
resta distinta da quella di una competizione fra avversari.

Il win rate è `V / (V + P + S)`. I pareggi non sono vittorie né mezze vittorie
nel win rate. Dashboard, dettagli giocatore e gioco, statistiche, Wrapped e
simulazione usano lo stesso classificatore `getPlayerOutcome`.

## Posizioni nelle classifiche ELO

Nella pagina Rating ELO, la classifica generale e quella del singolo gioco
assegnano la stessa posizione ai rating uguali: `1, 2, 2, 4`. Le posizioni sono
calcolate dopo il filtro dei giocatori nascosti. Vittorie, win rate e numero di
partite non determinano spareggi. Questa regola riguarda la visualizzazione;
non modifica i rating o gli esiti delle partite.

## Produzione

L'integrazione del 16 ottobre 2026 conserva i salvataggi atomici e le letture
globali introdotti su `main`. Il modulo condiviso `playFormPayload` richiede
una durata intera positiva prima di preparare una richiesta di creazione o
modifica. I reader accettano la versione corrente `kingscore-elo-rules-v2`.
Il worker usa le RPC v2, mantenendo i tentativi limitati, il riutilizzo della
stessa richiesta dopo esiti incerti e la rilettura dopo conflitti di revisione.

La verifica dell'integrazione comprende 407 test, typecheck, lint senza errori
e build. Il reader è stato verificato anche sulla pubblicazione reale alla
revisione 76: 483 partite elaborate, nessuna esclusa.

La produzione dispone già dell'infrastruttura globale di pubblicazione ELO v1,
con revisione della sorgente, ordine persistente `play_scores.elo_ordinal` e RPC
riservate al worker. La migrazione `20261015221000` richiede questa infrastruttura
preesistente; non installa la sua baseline. Un ambiente nuovo deve allineare
questa baseline prima di applicare la migrazione.

Il worker usa `get_elo_source_v2`, che aggiunge regole del gioco ed esito
cooperativo allo snapshot. Se cambia posizioni, le salva mediante la RPC
ristretta `update_play_positions` e rilegge la revisione. Pubblica quindi il
risultato `kingscore-elo-rules-v2` tramite `publish_elo_rules_v2`.

La pubblicazione mantiene i controlli v1 su revisione e riutilizzo dell'ID.
Pubblicazione globale, rating tradizionali, generali e cache vengono allineati
nella stessa transazione. I replay obsoleti non ripristinano valori precedenti.
Il worker non riceve nuovi permessi diretti di scrittura sulle tabelle.

Nonostante il nome `nightly-elo-recalc`, il job effettivo di produzione è
`kingscore-elo-v1-refresh`, che controlla ogni minuto se occorre una nuova
pubblicazione. La frequenza è stata conservata. La sospensione durante
l'intervento è stata temporanea.

## Validazione del 15 ottobre 2026

Sono stati eseguiti 81 test, typecheck, lint e build. Il confronto legacy passa
su 74 partite di 4 giochi senza correzioni applicabili; ne esclude esplicitamente
409, per le quali la vecchia semantica non è più il riferimento corretto.

Il worker di produzione è stato invocato con successo: 482 partite elaborate,
una partita vuota saltata. La rilettura del database ha verificato 75 rating per
gioco, 6 generali e 2.718 righe di storico. I conteggi di ogni giocatore soddisfano
`V + P + S = partite`. Tutti i punteggi e gli altri dati sorgente sono conservati.

| Pili Pili | V | P | S | ELO |
|---|---:|---:|---:|---:|
| Silvia | 5 | 5 | 0 | 1122 |
| Ale | 2 | 5 | 4 | 1049 |
| Fabrizio | 0 | 0 | 3 | 981 |
| Il Fattone | 0 | 0 | 3 | 966 |
| Luca | 1 | 1 | 11 | 896 |

Backup prima della migrazione, risultati attesi, risposte del worker e riletture
restano nella cartella locale `Documents/KingScore Backups`, fuori dal repository.
I test SQL delle regole nuove, dei permessi, dei duplicati e delle posizioni non
valide sono stati eseguiti in una transazione conclusa con rollback.

Il frontend è pubblicato nel deployment `dpl_Cg3zkNStEW7kA9T8Ro8BKuSnthkt`.
Il controllo nel browser ha verificato V/P/S e win rate di Pili Pili. Il test
automatico successivo a un avanzamento della revisione ha ricevuto HTTP 200
e pubblicato la revisione 45. Il job è attivo e il service role continua a non
avere il permesso di cancellazione diretta dei rating.

`scripts/recalculate-rankings.ts` permette di salvare un backup, preparare un
confronto e verificare il database. Nell'intervento la scrittura finale è stata
eseguita dal worker tramite la pubblicazione protetta, non dal file SQL generato.
