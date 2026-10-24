# KingScore

Gli utenti autenticati trovano **Scarica Android** nel menu profilo. Download e aggiornamenti passano dal backend del sito: [configurazione, API e migrazione Android](docs/android-distribution.md).

Web app completa per tracciare le partite a giochi da tavolo, con autenticazione multi-utente.

L'integrazione dei salvataggi atomici è descritta in [ATOMIC_PLAY_WEB.md](docs/ATOMIC_PLAY_WEB.md) ed è attiva in produzione con `VITE_ATOMIC_PLAY_WRITES=true`. L'[aggiornamento immediato dell'ELO Generale](docs/elo-generale-dopo-salvataggio.md) avvia il worker dopo il salvataggio e aggiorna automaticamente le schermate in attesa.

Il menu principale contiene «PartyScore» subito dopo «Wrapped», sia su desktop sia su mobile. Il collegamento apre [PartyScore](https://partyscore.baldeddu.cc/) nella stessa scheda; da quel sito la voce «KingScore» permette di tornare qui.

Gli amministratori trovano «Controllo partite» nel menu profilo (`/admin/play-checks`). La pagina legge tutte le partite con paginazione, mostra quanti record richiedono correzioni per durata, vincitori e punteggi, permette di filtrare le anomalie e collega ogni partita al modulo di modifica. «Ricontrolla» aggiorna i risultati. Anche l’accesso diretto alla pagina richiede il ruolo admin in `app_metadata`.

Il controllo richiede una durata intera positiva, almeno un vincitore nei competitivi e un esito esplicito del gruppo nei cooperativi (anche una sconfitta è un esito valido). Ogni partecipante registrato deve avere un punteggio numerico finito: zero, valori negativi e decimali sono validi. Le partite senza partecipanti vengono segnalate per i punteggi. Il controllo non modifica dati e non può individuare partecipanti mai registrati, perché manca un totale indipendente dei partecipanti attesi.

Sotto i 640 px la navigazione si apre con il pulsante ☰ e si chiude quando si seleziona una pagina. Da 640 a 1023 px resta visibile la griglia; da 1024 px le voci principali sono nella testata. La navigazione principale contiene solo Dashboard, Partite, Statistiche, Rating ELO, Wrapped e PartyScore. Giochi, Giocatori, Controllo partite, Admin, Impostazioni e Logout sono disponibili esclusivamente nel menu profilo degli amministratori; per gli altri utenti il menu profilo contiene Impostazioni e Logout.

## 🎲 Caratteristiche

- **Autenticazione multi-utente**: Ogni utente ha il proprio storico privato
- **Inserimento manuale**: Aggiungi partite manualmente. Nei moduli di creazione e modifica servono una durata intera maggiore di zero e almeno un vincitore. Nei cooperativi indica se il gruppo ha vinto o perso; la sconfitta del gruppo non richiede vincitori individuali.
- **Dettagli partita**: Il luogo non compare nei moduli, nello storico o nei dettagli. I valori già salvati restano nel database e vengono conservati durante la modifica di una partita.
- **Importazione BGA**: Importa partite da Board Game Arena
- **Ricerca giochi BGA**: Cerca giochi su Board Game Arena
- **Statistiche avanzate**: H-Index, streak, win rate, heatmap
- **Gestione giocatori**: Crea e gestisci i tuoi giocatori
- **Classifiche**: Player 1 è nascosto da classifiche e grafici comparativi. Partite, risultati, numero di partecipanti e calcoli ELO restano invariati; il giocatore resta consultabile nello storico e nella sua scheda. Il filtro usa il nome registrato, anche se è presente un alias.
- **Libreria giochi**: Organizza i tuoi giochi preferiti
- **Regole per gioco**: Configura se vince il punteggio più basso e se i punteggi uguali condividono la posizione, sia creando sia modificando un gioco.
- **Pareggi**: I primi posti condivisi contano come P, i piazzamenti condivisi fra sconfitti come S. L'ELO tratta correttamente i confronti pari a qualsiasi posizione.

## 🚀 Quick Start

### 1. Installa le dipendenze

```bash
npm install
```

### 2. Configura Supabase

Crea un progetto su [https://supabase.com](https://supabase.com) e copia le credenziali nel file `.env.local`:

```env
VITE_SUPABASE_URL=https://tuo-progetto.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

### 3. Crea le tabelle del database

Vai su **SQL Editor** nel tuo progetto Supabase e esegui lo SQL dal file `prompt.md` (righe 19-81).

### 4. Avvia il server di sviluppo

```bash
npm run dev
```

L'applicazione sarà disponibile su http://localhost:5173/

### 5. Registrati e accedi

1. Apri il browser su http://localhost:5173/
2. Clicca su "Registrati"
3. Compila il form con nome, email e password
4. Accedi con le tue credenziali

## 📥 Importazione da BGA

Per importare le partite da Board Game Arena, devi deployare le Edge Functions.

### Prerequisiti

```bash
npm install -g supabase
supabase login
```

### Link al progetto

```bash
cd my-game-log
supabase link --project-ref rixivmeipbizoxyvrvaf
```

### Deploy delle Edge Functions

```bash
supabase functions deploy bga-import
supabase functions deploy bga-search
```

### Importa le partite

1. Accedi all'applicazione
2. Apri la pagina `/import` (richiede un account amministratore)
3. Inserisci le tue credenziali BGA
4. Clicca su "Avvia Import"

Per maggiori dettagli, consulta [`EDGE_FUNCTIONS_DEPLOY.md`](EDGE_FUNCTIONS_DEPLOY.md).

## 📚 Documentazione

- [`docs/elo-partita-immediato.md`](docs/elo-partita-immediato.md): ELO nel dettaglio senza attesa del job globale, verifiche di revisione e misure.
- [`docs/game-ranking-rules.md`](docs/game-ranking-rules.md): Configurazione dei giochi, V/P/S, formula ELO e pubblicazione di produzione.
- [`docs/pili-pili-ranking.md`](docs/pili-pili-ranking.md): Regole di classifica e pareggi ELO di Pili Pili; confronto storico in sola lettura.
- [`SETUP.md`](SETUP.md): Guida completa per la configurazione
- [`DEBUG.md`](DEBUG.md): Guida per il debug
- [`EDGE_FUNCTIONS_DEPLOY.md`](EDGE_FUNCTIONS_DEPLOY.md): Guida per il deploy delle Edge Functions
- [`FASE1_IMPLEMENTATION.md`](FASE1_IMPLEMENTATION.md): Documentazione Fase 1
- [`FASE2_IMPLEMENTATION.md`](FASE2_IMPLEMENTATION.md): Documentazione Fase 2
- [`FASE3_4_IMPLEMENTATION.md`](FASE3_4_IMPLEMENTATION.md): Documentazione Fase 3 e 4

## 🛠️ Stack Tecnologico

- **Frontend**: React + Vite + TailwindCSS
- **Database + Auth**: Supabase (PostgreSQL + Supabase Auth)
- **Routing**: React Router v6
- **Grafici**: Recharts
- **Icone**: Lucide React
- **Notifiche**: react-hot-toast
- **Activity Calendar**: react-activity-calendar

## 📁 Struttura del Progetto

```
kingscore/
├── src/
│   ├── components/       # Componenti riutilizzabili
│   ├── contexts/        # Context di React
│   ├── hooks/           # Custom hooks
│   ├── lib/            # Utilità e configurazioni
│   ├── pages/           # Pagine dell'applicazione
│   ├── utils/           # Funzioni utility
│   ├── App.jsx          # Componente principale
│   ├── main.jsx         # Entry point
│   └── index.css        # Stili globali
├── supabase/
│   └── functions/       # Edge Functions per BGA
├── public/             # File statici
├── .env.local         # Variabili d'ambiente (non versionato)
└── package.json        # Dipendenze
```

## 🔒 Sicurezza

- **Row Level Security (RLS)**: Ogni utente vede solo i propri dati
- **Credenziali non salvate**: Le credenziali BGA non vengono memorizzate
- **Edge Functions**: Le chiamate a BGA passano attraverso server Supabase per evitare CORS

## 📊 Statistiche Disponibili

- **H-Index**: Massimo H tale che hai giocato ≥ H partite a H giochi diversi
- **Streak**: Giorni consecutivi con almeno una partita
- **Win Rate**: Percentuale di vittorie per gioco
- **Partite per giorno**: Distribuzione delle partite per giorno della settimana
- **Giocatori più frequenti**: Giocatori con cui giochi più spesso
- **Heatmap**: Calendario attività stile GitHub
- **Top giochi per ore**: Giochi con più ore di gioco totali
- **Gioco del mese**: Gioco più giocato nel mese con trend

## 🎮 Come Usare

### Aggiungere una partita

1. Clicca su "Aggiungi Partita"
2. Cerca o aggiungi un gioco
3. Compila i dettagli della partita
4. Aggiungi i giocatori e i punteggi
5. Clicca su "Salva"

### Visualizzare le statistiche

1. Clicca su "Statistiche" nella navbar
2. Esplora le diverse statistiche disponibili
3. Interagisci con i grafici per vedere i dettagli

### Gestire i giocatori

1. Clicca su "Giocatori" nella navbar
2. Aggiungi, rinomina o elimina giocatori
3. Visualizza le statistiche di ogni giocatore

### Pubblicare un commento

Nel dettaglio di una partita, accedi e scrivi nel campo «Lascia un commento».
Su PC, Invio pubblica e Shift+Invio va a capo. Su telefono e tablet, Invio va
a capo; per pubblicare usa il pulsante «Pubblica». Durante la composizione del
testo con un IME, Invio conferma il testo senza pubblicarlo. Il pulsante resta
disponibile anche su PC. In caso di errore, la bozza viene conservata.

### Importare da BGA

1. Clicca su "Import" nella navbar
2. Inserisci le tue credenziali BGA
3. Clicca su "Avvia Import"
4. Attendi il completamento dell'importazione

## 🐛 Troubleshooting

### Pagina bianca

1. Verifica che le credenziali Supabase siano corrette
2. Riavvia il server di sviluppo
3. Controlla la console del browser per errori
4. Consulta [`DEBUG.md`](DEBUG.md) per maggiori dettagli

### Errore di connessione Supabase

1. Verifica che l'URL Supabase sia corretto
2. Verifica che la chiave anon sia corretta
3. Verifica che il progetto Supabase sia attivo

### Importazione BGA fallita

1. Verifica che le Edge Functions siano state deployate
2. Verifica le tue credenziali BGA
3. Controlla i log nella pagina Import
4. Consulta [`EDGE_FUNCTIONS_DEPLOY.md`](EDGE_FUNCTIONS_DEPLOY.md) per maggiori dettagli

## 📄 Licenza

Questo progetto è creato per uso personale.

## 🤝 Contributi

Questo è un progetto personale, ma i suggerimenti sono benvenuti!

---

**KingScore — uso personale e amici** 🎲
