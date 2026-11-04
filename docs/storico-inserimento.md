# Storico per data di inserimento

Nel sito, Partite mostra sempre le ultime inserite usando `plays.created_at`: una partita giocata anni fa e registrata oggi compare tra gli ultimi inserimenti. Il selettore «Ordina per» e la dicitura «Ordine: data e ora di inserimento» sono stati rimossi il 4 novembre 2026. Le vecchie preferenze in `localStorage` non vengono più lette. Il database confronta il timestamp completo, incluse ore, minuti, secondi e microsecondi. Ogni scheda mostra sempre la data giocata e la data di inserimento con ore, minuti e secondi nel fuso del dispositivo.

Ricerca e filtri conservano l'ordine per inserimento. Anno e mese si riferiscono sempre a `played_at`, la data della partita. Cambiare o rimuovere i filtri riporta alla prima pagina.

La correzione del 4 novembre 2026 risolve la vista iniziale della 0.8.1, che usava soltanto giorno e ID: le partite dello stesso giorno potevano quindi apparire fuori ordine rispetto all'inserimento. `played_at` contiene il giorno, senza ora effettiva della partita; `created_at` contiene l'orario della registrazione. Il client non ricostruisce l'ora giocata a partire dall'ora di registrazione.

Nel sito il database ordina prima per `created_at` decrescente, poi per ID decrescente in caso di parità. I record senza `created_at` vengono dopo quelli datati e mostrano «Data di inserimento non disponibile». Il client non ricostruisce né modifica le date mancanti. Le partite importate seguono il timestamp salvato nel database, che può coincidere per un intero import.

Il web legge tutte le pagine REST prima di applicare i filtri e visualizza venti partite per pagina: lo storico supera quindi il limite di mille righe per risposta. Le risposte precedenti vengono scartate dopo un cambio utente, un nuovo tentativo o l'uscita dalla pagina. Un errore mostra «Riprova» e non presenta una risposta parziale come storico completo. L'uso di memoria e il tempo di caricamento crescono con il totale delle partite.

Android conserva il proprio selettore d'ordine e il caricamento progressivo di cinquanta righe. Il cursore usa timestamp di inserimento e UUID nella vista «Ultime inserite», mantenendo la precisione del server e gestendo anche la coda dei timestamp nulli. I filtri del periodo continuano a usare la data giocata. Le modifiche web del 4 novembre 2026 non cambiano il client Android.

Non servono migrazioni: `created_at` fa già parte dello schema e dei contratti dei due client. Questa modifica non costituisce uno storico delle modifiche o delle cancellazioni. La funzione è inclusa nell'aggiornamento Android 0.8.1/code 36.

## Ordine dei calcoli ELO

Gli ELO vengono calcolati per data giocata crescente (`played_at`), con ID crescente a parità di data. Questo ordine era già in uso prima del selettore e vale sia per il calcolo globale sia per i percorsi di dettaglio. La RPC `get_elo_source_v2` lo impone nello snapshot; `simulateEloSource` in `src/utils/elo/publication.ts` rifiuta sequenze fuori ordine. L'ordine fisso «Ultime inserite» cambia soltanto la visualizzazione dello storico.

## Verifiche

Per la modifica web del 4 novembre 2026: 539 test superati, typecheck e build superati, lint senza errori e con 15 avvisi preesistenti. Il controllo nel browser, su dati sintetici locali, verifica l'ordine per inserimento anche con la vecchia preferenza `played_at`, l'assenza dei controlli rimossi, l'esclusione di Player 1 dai nuovi inserimenti e da Wrapped e il rifiuto del nome nell'aggiunta rapida. Nel modulo di modifica l'opzione storica è disabilitata; il salvataggio conserva tutti e tre i partecipanti della fixture, compresi punteggio e vittoria di Player 1. Non è stato eseguito un nuovo collaudo Android o in produzione.

Le verifiche della versione precedente restano riportate di seguito:

- Web: `npm test`, `npm run typecheck`, `npm run build`, `npx eslint src/pages/Plays.tsx`.
- Android: `:app:testDebugUnitTest`, `:app:lintDebug`, `:app:assembleDebug`, `:app:assembleDebugAndroidTest`.
- I test Android del repository verificano 1.051 record, timestamp uguali, precisione al microsecondo, offset orari equivalenti, date mancanti e rifiuto di pagine fuori ordine o cursori scaduti. Il test del ViewModel verifica che cambiare solo l'ordine azzeri il cursore e conservi gli altri filtri.
- Il controllo nel browser usa 1.003 partite sintetiche su HTTP locale, compresa una giocata nel 2020 e inserita nel 2026. Verifica totale, primo risultato, ricerca, paginazione e cambio di ordine.

Esito locale del 3 novembre 2026: 537 test web e 422 test JVM Android superati; typecheck, build web, lint Android e build dei due APK debug superati. Il lint completo web termina senza errori, con quindici avvisi in file non modificati; `Plays.tsx` non ne produce. Il browser verifica anche il recupero dopo un errore sulla seconda pagina e i timestamp mancanti. Il test UI Android `insertionOrderShowsBothDatesAndKeepsLegacyRowsVisible` passa su emulatore Android 15, con dati sintetici. Nessun collaudo su telefono fisico o in produzione.
