# Tempi ELO misurati il 21 ottobre 2026

Il calcolo aritmetico non spiega un'attesa di decine di secondi: sul PC della
verifica, il core esistente ricalcola tutte le 495 partite in una mediana di
3,50 ms. Questa misura riguarda la CPU locale, non il tempo del worker remoto.
Il codice ELO, il database e la pianificazione non sono stati modificati.

## Misure

Sito: https://kingscore.baldeddu.cc. Backend pubblico Supabase, pubblicazione
globale, al momento delle misure di caricamento, alla revisione 125, con 495 partite elaborate, nessuna saltata
e 1.388 punti in ciascuno dei due storici.

| Operazione | Campioni | Risultato |
| --- | --- | --- |
| Lettura HTTPS della pubblicazione completa | 5 | 323,94 / 216,90 / 161,99 / 117,51 / 142,09 ms |
| Apertura della classifica fino alla revisione corrente visibile | 3 | 1.400 / 1.028 / 1.053 ms |
| Apertura del dettaglio fino a ELO partita visibile | 3 | 1.206 / 944 / 1.034 ms |
| Simulazione locale completa, con storico generale | 30 | mediana 3,50 ms; minimo 2,50; massimo 5,57 |
| Validazione e congelamento del risultato letto | 30 | mediana 25,41 ms; minimo 17,62; massimo 35,66 |
| Proiezioni di classifica generale e due storici | 30 | mediana 0,26 ms; minimo 0,21; massimo 1,31 |

La risposta contiene 626.719 byte di JSON decompresso. Il trasporto usa gzip:
questo numero non misura i byte trasferiti sulla rete. Il download del corpo
richiede 22,62–25,95 ms nei cinque campioni; il resto della richiesta comprende
connessione, rete, gateway e lavoro del server, che non sono separabili con
questa prova. Il parsing JSON richiede 1,76–3,43 ms e non è incluso nella durata
HTTPS riportata.

## Metodo e controlli

Le richieste usano solo letture pubbliche, con lo stesso endpoint
`get_elo_publication_v1` usato dal sito. Nessun worker è stato invocato e nessuna
partita di prova è stata creata in produzione. Il relativo HTTP POST è una
lettura RPC. Le cinque chiamate sono sequenziali e non simulano cinque utenti
concorrenti; la connessione può essere riutilizzata.

La sorgente pubblica è stata letta ordinando le partite per `played_at,id` e i
partecipanti per `elo_ordinal`, verificando `Content-Range: 0-494/495`. Una prima
query diagnostica ha ricevuto HTTP 400 perché la colonna `play_scores.draw`
non esiste: la lettura riuscita la omette, come consente il core. Il risultato
della simulazione coincide con tutti i campi della pubblicazione, dopo aver
normalizzato soltanto l'ordine delle chiavi JSON. Gli array mantengono il loro
ordine. Non viene modificata la formula.

I benchmark CPU eseguono cinque riscaldamenti e trenta campioni sul codice
esistente compilato tramite esbuild. Hardware: Intel Core i3-10100F 3,60 GHz,
8 CPU logiche, 31,94 GiB RAM; Windows, Node v24.19.0. I tempi del browser sono
misurati intorno a reload e attesa del contenuto visibile tramite automazione:
includono l'overhead dello strumento e non sono misure Web Vitals. Nessun
throttling di rete è stato applicato. Il controllo non rappresenta un telefono
o una rete mobile.

## Attesa dopo il salvataggio

L'osservazione in sola lettura è iniziata alle 22:34:32,794 Europe/Rome, con
campionamento ogni due secondi più il tempo delle richieste. Controlla la
creazione di una nuova partita e la sua presenza in entrambi gli storici della
pubblicazione corrente. La prima finestra di otto minuti si è chiusa senza una
nuova partita osservata: la revisione è rimasta 125. Dopo la conferma dell'utente
sono state eseguite nuove letture sulla partita reale appena registrata.

| Evento del 21 ottobre, Europe/Rome | Orario | Distanza da `created_at` |
| --- | --- | --- |
| Creazione della partita, `created_at` server | 22:44:31,687947 | 0 |
| Prima risposta RPC: `stale`, sorgente 129 e pubblicazione 125 | 22:44:57,354 | 25,667 s |
| `updated_at` dei rating del gioco e generali dei due partecipanti | 22:45:02,749948 | 31,062 s |
| Prima risposta RPC osservata: `current`, revisione 129, partita presente in entrambi gli storici | 22:45:11,999 | 40,312 s |

Il completamento è avvenuto tra i due controlli, non è stato cronometrato
esattamente a 40,312 secondi. La prima richiesta è partita alle 22:44:56,949:
l'intervallo conservativo, dalla creazione alla disponibilità, è quindi
25,261–40,312 secondi. Tra le due richieste c'è stato un intervallo di circa
14,6 secondi durante la preparazione del secondo controllo; non si tratta di
una serie continua con campionamento ogni secondo.

Il timestamp dei rating è un ulteriore indicatore server, coerente per ELO del
gioco e generale dei due partecipanti. Il trigger documentato usa `NOW()`:
indica l'inizio della transazione, non il commit e non la durata del calcolo.
Anche `created_at` è un timestamp di transazione, non il momento esatto del
click o della risposta al salvataggio. Le differenze sono calcolate rispetto
alla creazione nel database.

Il collector della seconda lettura ha salvato il risultato e poi è terminato
con un'asserzione di Node su Windows durante la chiusura degli handle. Una
lettura indipendente, terminata con exit code 0, ha riconfermato revisione 129
e presenza della partita in entrambi gli storici. Nessun dato o ricalcolo è
stato scritto da questi controlli.

Nel codice di distribuzione, `04-schedule-elo.sql` pianifica il controllo ogni
minuto. Dopo un salvataggio, la schermata richiede una pubblicazione una sola
volta e non ne controlla automaticamente il completamento. La pianificazione
introduce quindi una possibile attesa fino al controllo successivo, cui si
aggiungono avvio, calcolo, persistenza e trasporto. L'aggiornamento osservato
poco dopo lo scatto delle 22:45 è compatibile con questa pianificazione. Il
ritardo di decine di secondi non coincide con i millisecondi misurati per la
CPU locale o con il tempo delle letture. Senza log del worker e dello scheduler
non è però possibile separare attesa del job, avvio a freddo, calcolo remoto e
persistenza, né confermare la configurazione cloud attuale. L'assenza di polling
nel codice della schermata può allungare ulteriormente l'attesa visibile fino
a quando l'utente ricarica; questo controllo non ha misurato una pagina rimasta
aperta durante la transizione.

L'intervento prioritario proposto è avviare il lavoro server dopo il commit del
salvataggio e rileggere automaticamente la pubblicazione finché diventa corrente,
con limiti e intervalli adeguati. Va conservata la verifica di revisione per
evitare rating calcolati su dati superati. Non è stato implementato.

## Commenti: modifica separata

Invio pubblica un nuovo commento sui computer riconosciuti; Shift+Invio resta a
capo. Telefono, tablet e dispositivi non riconosciuti mantengono Invio a capo.
Il riconoscimento usa user agent, piattaforma e touch point per distinguere anche
iPadOS in modalità desktop; uno user agent alterato può rendere ambigua la
classificazione. La scorciatoia ignora i modificatori e la composizione IME,
compreso il codice 229. La modifica di un commento esistente conserva il tasto
Salva.

Il form blocca richieste concorrenti e ripetizioni automatiche del tasto.
Conserva la bozza e ripristina l'invio in caso di errore. Non sono state aggiunte
dipendenze. Il README descrive il comportamento.

Controlli eseguiti: 429 test in 22 file, TypeScript e build superati; lint con
zero errori e 16 avvisi in file non modificati. I test unitari comprendono
Windows, macOS, Linux, PC touch, Android, iPhone, iPad, iPadOS desktop, dispositivi
non riconosciuti, modificatori e composizione.

Nel browser con API sintetica su loopback: Shift+Invio conserva due righe;
tre Invio rapidi inviano una sola richiesta; errore HTTP 500 conserva la bozza
e consente una nuova pubblicazione; un commento vuoto non viene inviato. In una
seconda fixture con identificazione Android simulata, Invio e Shift+Invio
producono righe nuove e zero POST commenti. Non è una prova su hardware mobile
reale. I commenti di collaudo restano in memoria nelle fixture locali.

La modifica ai commenti è stata successivamente pubblicata il 21 ottobre 2026,
insieme al percorso ELO rapido del dettaglio. Il [report del rilascio](elo-partita-immediato.md#distribuzione-e-controllo-pubblico)
distingue le verifiche pubbliche online dal collaudo autenticato affidato
all'utente.
