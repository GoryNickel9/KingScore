# Storico per data di inserimento

In Partite, «Ordina per» permette di scegliere «Ultime inserite» (vista iniziale) o «Ultime giocate». La prima scelta usa `plays.created_at`: una partita giocata anni fa e registrata oggi compare tra gli ultimi inserimenti. Il database confronta il timestamp completo, incluse ore, minuti, secondi e microsecondi. Ogni scheda mostra sempre la data giocata e la data di inserimento con ore, minuti e secondi nel fuso del dispositivo.

Ricerca e filtri si applicano a entrambe le viste. Anno e mese si riferiscono sempre a `played_at`, la data della partita. Cambiare ordine riporta alla prima pagina e conserva i filtri; rimuovere i filtri conserva l'ordine scelto. Il sito conserva la scelta in `localStorage`, anche al ritorno dal dettaglio e dopo un ricaricamento. Se lo storage è bloccato, la selezione resta valida nella pagina corrente e alla riapertura si usa «Ultime inserite».

La correzione del 4 novembre 2026 risolve la vista iniziale della 0.8.1, che usava soltanto giorno e ID: le partite dello stesso giorno potevano quindi apparire fuori ordine rispetto all'inserimento. `played_at` contiene il giorno, senza ora effettiva della partita; `created_at` contiene l'orario della registrazione. Il client non ricostruisce l'ora giocata a partire dall'ora di registrazione.

Il database ordina prima per la data scelta, dalla più recente, poi per ID decrescente in caso di parità. I record senza `created_at` vengono dopo quelli datati e mostrano «Data di inserimento non disponibile». Il client non ricostruisce né modifica le date mancanti. Le partite importate seguono il timestamp salvato nel database, che può coincidere per un intero import.

Il web legge tutte le pagine REST prima di applicare i filtri e visualizza venti partite per pagina: lo storico supera quindi il limite di mille righe per risposta. Le richieste precedenti vengono scartate dopo un cambio di ordine o l'uscita dalla pagina. Un errore mostra «Riprova» e non presenta una risposta parziale come storico completo. L'uso di memoria e il tempo di caricamento crescono con il totale delle partite.

Android conserva il caricamento progressivo di cinquanta righe. Il cursore usa timestamp di inserimento e UUID nella nuova vista, mantenendo la precisione del server e gestendo anche la coda dei timestamp nulli. I filtri del periodo continuano a usare la data giocata.

Non servono migrazioni: `created_at` fa già parte dello schema e dei contratti dei due client. Questa modifica non costituisce uno storico delle modifiche o delle cancellazioni. La funzione è inclusa nell'aggiornamento Android 0.8.1/code 36.

## Ordine dei calcoli ELO

Gli ELO vengono calcolati per data giocata crescente (`played_at`), con ID crescente a parità di data. Questo ordine era già in uso prima del selettore e vale sia per il calcolo globale sia per i percorsi di dettaglio. La RPC `get_elo_source_v2` lo impone nello snapshot; `simulateEloSource` in `src/utils/elo/publication.ts` rifiuta sequenze fuori ordine. Selezionare «Ultime inserite» cambia soltanto la visualizzazione dello storico.

## Verifiche

- Web: `npm test`, `npm run typecheck`, `npm run build`, `npx eslint src/pages/Plays.tsx`.
- Android: `:app:testDebugUnitTest`, `:app:lintDebug`, `:app:assembleDebug`, `:app:assembleDebugAndroidTest`.
- I test Android del repository verificano 1.051 record, timestamp uguali, precisione al microsecondo, offset orari equivalenti, date mancanti e rifiuto di pagine fuori ordine o cursori scaduti. Il test del ViewModel verifica che cambiare solo l'ordine azzeri il cursore e conservi gli altri filtri.
- Il controllo nel browser usa 1.003 partite sintetiche su HTTP locale, compresa una giocata nel 2020 e inserita nel 2026. Verifica totale, primo risultato, ricerca, paginazione e cambio di ordine.

Esito locale del 3 novembre 2026: 537 test web e 422 test JVM Android superati; typecheck, build web, lint Android e build dei due APK debug superati. Il lint completo web termina senza errori, con quindici avvisi in file non modificati; `Plays.tsx` non ne produce. Il browser verifica anche il recupero dopo un errore sulla seconda pagina e i timestamp mancanti. Il test UI Android `insertionOrderShowsBothDatesAndKeepsLegacyRowsVisible` passa su emulatore Android 15, con dati sintetici. Nessun collaudo su telefono fisico o in produzione.
