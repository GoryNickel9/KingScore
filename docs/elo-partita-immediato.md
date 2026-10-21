# ELO della partita senza attesa del job globale

Modifica locale del 21 ottobre 2026. Nel dettaglio di una partita, l'ELO del
gioco può comparire mentre la pubblicazione globale è ancora in attesa.
L'ELO generale, le classifiche e la pianificazione server conservano il loro
percorso attuale. Non servono migrazioni o nuove dipendenze.

## Percorso di lettura

Se `get_elo_publication_v1` restituisce una generazione corrente, il dettaglio
usa direttamente quella generazione. Se restituisce `stale` o `missing`,
`src/utils/elo/gameDetail.ts` legge tutte le partite del solo gioco, di tutti
i proprietari, con le regole e i partecipanti necessari alla formula.

Le partite sono ordinate per `played_at,id`; i partecipanti per `elo_ordinal`,
come nello snapshot del worker. La lettura richiede il conteggio esatto delle
partite e segue tutte le pagine anche se il server le limita a meno di 1.000
righe. Un conteggio aggregato separato verifica che i punteggi di ciascuna
partita siano completi. Ordinali mancanti, duplicati o fuori ordine, partite
di un altro gioco e regole incomplete impediscono il calcolo.

Dopo aver letto la sorgente, il client rilegge la revisione globale. Se la
pubblicazione è diventata corrente, usa il risultato del server. Se è ancora
in attesa e la revisione non è cambiata, richiama `simulateEloSource`, che
condivide validazione e simulatore con il worker. Se la revisione è cambiata,
scarta tutto e ripete una volta la lettura completa; un secondo conflitto
produce un errore esplicito, senza mostrare un risultato composto da revisioni
diverse. La validità si riferisce all'ultima revisione verificata: modifiche
successive richiedono una nuova lettura, come per le pubblicazioni normali.

Il rating di un gioco dipende soltanto dalle partite precedenti dello stesso
gioco. Per questo il replay del sottoinsieme restituisce gli stessi rating e
le stesse variazioni del replay globale per quel gioco. Sono conservati
rating iniziale, K, ordinamento, arrotondamenti, pareggi e regole cooperative.
Il generale prodotto incidentalmente dalla simulazione del sottoinsieme
viene scartato: non viene presentato come ELO generale globale.

Il percorso non scrive rating, storico, pubblicazioni o cache. Non avvia il
worker e non cambia la frequenza del job. Si applica soltanto alla pagina web
di dettaglio con il percorso atomico attivo; non alle classifiche, ai grafici
globali o all'app Android. Il messaggio nel dettaglio distingue esplicitamente
«ELO della partita aggiornato» da «ELO generale in attesa».

## Verifiche eseguite

La suite completa supera 448 test in 23 file. I 19 nuovi casi, con SDK reale
su HTTP loopback, coprono pubblicazione corrente senza letture grezze,
generale ancora nascosto, filtro per gioco senza filtro proprietario,
paginazione limitata dal server, pubblicazione completata durante la lettura,
retry di revisione, conflitti ripetuti, input incompleti e non validi, errori
HTTP e parità fra replay per gioco e replay globale con giochi intercalati.

La suite del worker e della pubblicazione passa dopo l'estrazione di
`simulateEloSource`: la formula in `simulation.ts` non cambia. Passano anche
TypeScript, build e gli otto controlli di `test-web-elo-read-fixture.mjs`.
Il lint termina con zero errori e i 16 avvisi già presenti nei file esistenti.

La prova browser usa la fixture sintetica locale: con pubblicazione `stale`,
il dettaglio mostra 1024/+24 e 976/−24 nella colonna ELO e lascia il generale
vuoto. Le API della fixture non contattano servizi remoti.

## Misure su dati reali, in sola lettura

Alla revisione globale 129, il replay per gioco coincide con tutti i punti
dello storico pubblicato per tutti i 17 giochi presenti. Il confronto include
nomi, date, rating, variazioni e ordine dei punti.

Per il gioco della partita appena registrata, cinque campioni del nuovo
percorso richiedono **579,18 / 477,78 / 481,13 / 292,88 / 275,06 ms**.
Sono tempi aggiuntivi dopo la lettura iniziale dello stato globale: includono
la lettura delle partite del gioco, la verifica finale della revisione e il
calcolo, non il caricamento completo della pagina.

La pubblicazione reale era corrente. Per esercitare il ramo rapido senza
invalidare dati di produzione, il trasporto della prova sostituisce soltanto
la risposta locale con un envelope `stale`, conservando la revisione realmente
letta dal server. Righe e controlli di revisione restano letture reali. La
verifica finale scarica quindi il risultato completo prima di nasconderlo
localmente, mentre un vero `stale` invierebbe un corpo più piccolo. Questa è
una simulazione del ramo in attesa, non una misura di un nuovo salvataggio
reale con il codice distribuito. Nessuna prestazione è garantita su altre
reti o su storici più grandi.

Hardware e runtime: lo stesso PC delle [misure iniziali](elo-timing-2026-10-21.md),
Intel Core i3-10100F, circa 32 GiB RAM, Windows, Node v24.19.0; moduli compilati
con esbuild, nessun throttling. I dati aggregati della prova sono in
[evidence/elo-game-detail-2026-10-21.json](evidence/elo-game-detail-2026-10-21.json).

## Avviso di salvataggio

`PlayWriteStatus` non mostra più «Ultimo salvataggio confermato» e il relativo
link. Lo stato durevole di conferma resta conservato nel journal. Restano
visibili controllo account, operazioni in corso, errori e recupero degli
esiti incerti. La rimozione riguarda tutti i consumer del componente:
creazione, modifica, dettaglio e importazione.

Nel browser locale sono stati verificati un salvataggio normale senza avviso,
una risposta persa dopo il commit sintetico, la comparsa del pulsante di
recupero e il recupero con confronto fra bozza e dati aggiornati. Nessuna
partita reale è stata modificata da queste prove.

## Distribuzione e controllo pubblico

Le modifiche sono online su https://kingscore.baldeddu.cc dal 21 ottobre 2026.
Commit applicativo: `bac2159`; deploy Vercel
`dpl_7QtVGR8bimREoxPVHLPL35i1SErX`, stato verificato `READY`, dominio pubblico
associato. La pubblicazione include anche Invio per i commenti da PC e la
rimozione dell'avviso persistente di salvataggio.

Nel browser sul dominio pubblico, tre aperture del dettaglio della partita
reale hanno mostrato gli ELO in **1.002 / 883 / 934 ms**. La pubblicazione era
già corrente alla revisione 129: questa prova misura l'apertura del dettaglio,
non un nuovo salvataggio con pubblicazione in attesa. Include l'overhead
dell'automazione. Per il ramo in attesa restano valide le misure di
275–579 ms aggiuntivi riportate sopra; non vanno sommate come benchmark di una
singola prova né presentate come un tempo garantito dal click su Salva.

Il controllo HTTPS del bundle distribuito conferma il percorso rapido, il
testo della scorciatoia commenti, `requestSubmit`, la rimozione di testo e link
del vecchio avviso nel componente condiviso e la conservazione del recupero.
I valori ELO del gioco e generali sono visibili nel browser pubblico. Su
richiesta dell'utente, il collaudo autenticato dei commenti è affidato a lui:
l'agente non ha pubblicato commenti o modificato partite reali.

Evidenza: [release-2026-10-21.json](evidence/release-2026-10-21.json).

Il messaggio «Classifica ELO globale · revisione …» è stato successivamente
rimosso da dettaglio, classifiche, statistiche e Wrapped. Con dati correnti
non viene mostrato alcun riquadro vuoto. Restano gli avvisi di caricamento,
aggiornamento in attesa ed errore; le revisioni continuano a essere verificate
internamente.
