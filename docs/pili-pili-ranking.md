# Classifica ed ELO di Pili Pili

Questo documento registra il primo intervento su Pili Pili. La configurazione
è stata successivamente estesa a tutti i giochi e il conteggio V/P/S è stato
corretto: la specifica corrente è in [game-ranking-rules.md](game-ranking-rules.md).
Le sezioni seguenti descrivono lo stato precedente a questa estensione.

La regola si applica al gioco con ID `904579b2-3b31-42fd-8d7b-25d68d1e5ce5`.
È dichiarata in `src/utils/elo/gameRules.ts`, condivisa da browser e job Deno.
Non richiede colonne nuove o migrazioni del database. Se il gioco viene ricreato
con un ID diverso, occorre aggiornare la configurazione.

## Posizioni

I vincitori selezionati mantengono il primo posto. Gli altri partecipanti sono
ordinati per punteggio crescente. Punteggi uguali condividono la posizione,
con numerazione competitiva: `1, 2, 2, 4`, oppure `1, 1, 3`.
Il punteggio zero è valido; i punteggi mancanti vanno in fondo e non generano
pareggi. Il valore storico 7 resta invariato, senza introdurre un limite di 6.

La stessa funzione assegna le posizioni nei moduli di inserimento e modifica,
nella tabella del dettaglio, nell'importazione BGA e nella simulazione ELO.
Negli altri giochi restano le regole storiche; l'importazione conserva le loro
posizioni esplicite BGA. Il dettaglio ora mostra la posizione condivisa anche
quando più vincitori hanno già il primo posto nel motore.

## Risultato ELO

Per Pili Pili il risultato di un giocatore è:

```text
S_i = (numero di avversari superati + 0.5 × numero di avversari pari) / (N - 1)
R_i' = round(R_i + K_i × (S_i - E_i))
```

Si confrontano le posizioni, senza assegnare una vittoria piena a ogni vincitore
ex aequo. Con posizioni `1, 1, 3`, i risultati sono `0.75, 0.75, 0`; in un
pareggio totale sono tutti `0.5`. Con posizioni `1, 2, 2, 4`, sono
`1, 0.5, 0.5, 0`. Rating diversi possono produrre delta diversi anche a pari
risultato. Risultato atteso, fattore K, arrotondamento, flag di vittoria e
contatori delle statistiche mantengono le convenzioni esistenti.

## Verifica e anteprima senza scritture

I test di regressione sono in `src/utils/elo/piliPili.test.ts`.

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run compare:elo
node --experimental-strip-types scripts/preview-pili-pili.ts a5e5dd65f10db4e52a3e13c34a6388cfae3b6fb5
```

`compare:elo` confronta con la formula storica solo i giochi senza la correzione
di Pili Pili e dichiara quante partite esclude. Le letture sono paginate.

L'anteprima compila il motore precedente dal commit indicato, incluse le sue
dipendenze. Legge le partite accessibili usando `.env.local`, separa gli storici
per proprietario e confronta i due motori sugli stessi input ordinati per data
e ID. Verifica che rating e storico degli altri giochi restino identici.
Il client blocca ogni richiesta HTTP diversa da GET; un controllo iniziale
verifica il blocco di POST senza inviare la richiesta.

Il report JSON contiene hash degli input, posizioni, ELO, delta per partita,
rating e storico attualmente salvati, oltre agli ELO generali simulati. Viene
salvato nella directory temporanea locale, fuori dal repository, perché include
nomi e identificatori dei giocatori. Un secondo argomento permette di scegliere
un altro percorso. Un file esistente non viene sovrascritto.

## Rettifica del 15 ottobre 2026

La rettifica è stata autorizzata e applicata con una singola transazione:
14 posizioni in 6 delle 13 partite, 5 rating di Pili Pili, i relativi ELO
generali e 1.232 righe di cache (storico di Pili Pili e storico generale dei
5 partecipanti). Tutti i punteggi, incluso il 7, sono rimasti invariati.

`scripts/repair-pili-pili.ts prepare` genera un backup JSON e un file SQL nella
directory temporanea locale. Non esegue il file di rettifica. Il file SQL
blocca le scritture concorrenti, controlla l'hash dello snapshot e l'assenza di
ricalcoli attivi, aggiorna i record e controlla il risultato prima del commit.
`verify <directory>` rilegge il database e verifica anche che punteggi, giocatori,
partite, altri rating per gioco e cache fuori ambito siano rimasti identici.
I backup e i payload contengono dati personali e restano fuori dal repository.

La verifica preliminare ha rilevato 10 rating di altri giochi diversi dal replay
completo corrente. La rettifica li ha conservati: per il generale ha usato gli
storici per gioco già salvati, sostituendo soltanto quello di Pili Pili. La media
finale è stata verificata contro i rating e i conteggi partite effettivamente
presenti nel database. Per questo alcuni generali differiscono di un punto
dall'anteprima basata sul replay completo. Un successivo ricalcolo completo può
riallineare anche queste differenze preesistenti; non sono state corrette qui.

La funzione di produzione `nightly-elo-recalc` è stata aggiornata alla versione 6
con il core corretto e verifica JWT attiva; la richiesta senza service role
restituisce 403 prima di eseguire scritture. Anche il frontend è stato distribuito
su `https://kingscore.baldeddu.cc` con deployment Vercel
`dpl_7yKcQefrkEs6pSkiH5Cneu8e8Ftq`.
Lo script di anteprima resta in sola lettura e non esegue alcuna di queste rettifiche.

## Altri giochi e configurazione

Negli altri giochi la regola ELO storica è invariata: i vincitori condividono il
primo posto e ricevono risultato 1; gli sconfitti a pari punteggio ricevono ancora
posizioni distinte. Non viene applicato mezzo punto per il loro confronto pari.

I moduli di creazione dei giochi non espongono ancora il flag. Per configurare
giochi nuovi dall'interfaccia servono proprietà persistenti nella tabella games,
i relativi controlli nei moduli e il passaggio delle regole al motore condiviso.
La configurazione attuale identifica solo il record esistente di Pili Pili.
