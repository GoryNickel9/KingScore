# Distribuzione Android con accesso KingScore

**Stato del 24 ottobre 2026:** `KingScore-Android` è privata; `KingScore` resta pubblica. Vercel Production dispone di un nuovo token fine-grained per la sola repo Android, con `Contents: read` e `Metadata: read`, salvato come Secret `GH_TOKEN`. Scade il **22 gennaio 2027**: rinnovarlo e ridistribuire il backend prima della scadenza. Il deployment `dpl_FccvG5BEGG1fcUKMWsqjqM1dLYcJ` restituisce metadati `200`; download anonimi o con sessione invalida ricevono `401`. [Configurazione e verifiche](evidence/android-private-distribution-2026-10-24.json). Il precedente errore dopo la privatizzazione resta registrato nella [verifica storica](evidence/android-repository-private-2026-10-24.json).

La Latest pubblicata è la **0.7.2/code 24**, firmata con lo stesso certificato della 0.7.1. Chi usa una versione precedente deve accedere al sito, scegliere **Scarica Android** nel menu profilo e installare l'APK sopra l'app esistente, senza disinstallarla. Gli updater precedenti leggono GitHub in forma anonima e non possono accedere alla repo privata; dalla 0.7.2 le versioni successive usano il nuovo canale.

Il menu profilo mostra **Scarica Android** agli utenti autenticati. Il download passa dal backend Vercel, che verifica la sessione tramite Supabase Auth e trasmette l'APK dalle Releases di `GoryNickel9/KingScore-Android`. Il codice segue il modello di PokerQuant-site; KingScore non richiede una licenza.

## Contratto HTTP

| Endpoint | Accesso | Risposta |
| --- | --- | --- |
| `GET /api/android/update` | Pubblico | Metadati della Latest stabile: tag, nome APK, byte, SHA-256 e URL del download protetto |
| `GET /api/android/download` | Bearer Supabase verificato | APK della Latest stabile in streaming |
| `GET /api/android/download?version=0.7.2` | Bearer Supabase verificato | APK della release `v0.7.2`, fissata dal controllo versione |

Il backend risponde `401` per accesso assente, invalido o anonimo, `400` per parametri non validi, `405` per metodi diversi da GET, `503` per configurazione mancante o Auth indisponibile e `502` per release o trasporto GitHub non validi. Una risposta GitHub `404` non indica che l'app è aggiornata: può dipendere da una repo privata o da un token privo di accesso.

Download ed errori hanno `Cache-Control: private, no-store`; i soli metadati pubblici validi hanno cache CDN di 120 secondi. Il token Supabase compare soltanto nell'header Authorization; non entra negli URL o nelle richieste GitHub. Il token GitHub resta sul backend e viene rimosso nelle richieste ai CDN degli asset. I redirect sono limitati ai domini GitHub previsti.

La release deve essere stabile, appartenere alla repo prevista e contenere un solo APK con SHA-256 valido, di dimensione compresa fra 1 e 100.000.000 byte. Lo stream rispetta la backpressure e verifica byte e hash; un trasferimento alterato o incompleto viene interrotto. L'app Android verifica inoltre package, versione crescente e stesso certificato prima dell'installazione.

## Configurazione Vercel

Configurare nel progetto **king-score**:

- `GH_TOKEN`: opzionale finché la repo Android resta pubblica, necessario quando diventa privata. Usare un token GitHub con permesso `Contents: read` sulla sola repo `GoryNickel9/KingScore-Android`.
- `SUPABASE_URL` e `SUPABASE_ANON_KEY`, oppure le variabili pubbliche già presenti `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.

`GH_TOKEN` non deve avere il prefisso `VITE_`, non va inserito nell'APK e non va committato. Non serve una service-role key. Senza `GH_TOKEN`, GitHub applica i limiti delle richieste anonime; la cache CDN riduce le letture dei metadati. Un limite esaurito produce un errore con Riprova, senza fallback che salti il blocco. Dopo una modifica alle variabili serve un nuovo deployment. `vercel.json` esclude `/api` dal fallback SPA; il proxy download ha durata massima configurata di 300 secondi, con timeout upstream di 180 secondi. Documentazione: [Vercel Functions](https://vercel.com/docs/functions), [GitHub release assets](https://docs.github.com/en/rest/releases/assets).

`vite` serve soltanto il frontend: per il backend usare Vercel o `vercel dev` con la configurazione locale. La webapp scarica il file come Blob e richiede RAM proporzionale alla dimensione dell'APK; il server lo trasmette senza accumularlo interamente.

## Passaggio dall'updater pubblico

L'Android 0.7.2/code 24 usa gli endpoint del sito. Il login precede il blocco aggiornamenti: una sessione assente può autenticarsi, una sessione rifiutata torna al login. La navigazione resta bloccata finché un aggiornamento obbligatorio non viene installato. Logout o rimozione della schermata annullano il trasferimento; i file parziali vengono eliminati.

Il backend è stato configurato prima di pubblicare la 0.7.2 nella repo privata. I link diretti GitHub non sono pubblicamente accessibili. La protezione del download non impedisce la condivisione di un APK già ricevuto.

La migrazione manuale delle versioni anteriori alla 0.7.2 è necessaria: il nuovo Secret Vercel non cambia il codice già installato. La firma deve restare la stessa.

## Verifica locale

`npm run typecheck`, `npm run lint`, `npm test` e `npm run build` includono backend e frontend. `api/android/distribution.test.ts` esegue richieste HTTP reali su localhost con Auth e GitHub simulati: verifica autorizzazione, metadati, pin della versione, streaming, integrità, redirect e indisponibilità. `src/services/androidDownload.test.ts` verifica header, errori e rifiuto del fallback HTML.

Questi test non certificano le variabili Vercel, il token GitHub reale o l'installazione su un dispositivo. Il controllo remoto deve verificare `401` senza sessione, manifest valido e SHA-256 dell'APK ottenuto con una sessione autorizzata.

## Verifiche del 24 ottobre 2026

Il primo deployment `dpl_CxvbeuYSMu5a5meXHuUKzhWpPduK` usava le Releases pubbliche. Dopo la privatizzazione è stato ridistribuito come `dpl_FccvG5BEGG1fcUKMWsqjqM1dLYcJ` con il token dedicato. Sono verificati la risposta `200` della Latest 0.7.2, il suo URL del proxy e lo SHA-256 dell'APK, download anonimo `401`, sessione invalida `401` e repo GitHub anonima `404`. Il token GitHub del PC non è stato copiato su Vercel.

Passano 515 test nella suite web completa prima dell'aggiunta della modalità senza token e 41 test mirati dopo quell'aggiunta; typecheck, lint dei file modificati e build Vercel passano. Il lint completo ha zero errori e 16 avvisi preesistenti. Il proxy locale ha trasferito l'APK reale della 0.7.1 sia da repo pubblica sia da repo privata, 14.593.562 byte, con verifica SHA-256; soltanto la risposta HTTP di Supabase Auth era simulata. Non è stato eseguito un download di produzione con un account reale: le registrazioni risultano chiuse e non sono state modificate. Non sono stati eseguiti test strumentali o installazioni della 0.7.2, perché l'emulatore dedicato non ha completato il boot. [Evidenze iniziali e hash dei sorgenti](evidence/android-distribution-2026-10-24.json).
