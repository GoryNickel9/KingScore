# Guida all'Upload delle Immagini dei Giochi

Questa guida spiega come utilizzare la funzionalità di upload delle immagini dei giochi con Supabase Storage.

## Panoramica

Il sistema supporta due metodi per aggiungere immagini ai giochi:

1. **Upload diretto**: Carica un'immagine dal tuo dispositivo su Supabase Storage
2. **URL esterno**: Inserisci l'URL di un'immagine esistente (es. da BoardGameGeek)

## Configurazione Iniziale

### 1. Esegui la Migrazione SQL

Prima di utilizzare la funzionalità di upload, devi eseguire la migrazione SQL per creare il bucket di storage:

```bash
# Se usi Supabase CLI
supabase db push

# Oppure esegui manualmente il file SQL nel dashboard di Supabase
# File: supabase/migrations/create_game_images_storage.sql
```

### 2. Configura le Politiche di Accesso (Importante!)

⚠️ **ATTENZIONE**: Le politiche di accesso per il bucket devono essere configurate manualmente dal dashboard di Supabase. Non possono essere create automaticamente via SQL per motivi di permessi.

Segui le istruzioni dettagliate nel file [`docs/SUPABASE_STORAGE_SETUP.md`](SUPABASE_STORAGE_SETUP.md) per configurare le policy di accesso.

### 3. Verifica il Bucket di Storage

1. Vai al dashboard di Supabase
2. Seleziona "Storage" nel menu laterale
3. Verifica che esista un bucket chiamato `game-images`
4. Assicurati che il bucket sia pubblico (public: true)
5. Verifica che tutte le policy di accesso siano state configurate correttamente

## Utilizzo

### Aggiungere un Nuovo Gioco con Immagine

1. Vai alla pagina "Aggiungi Nuova Partita"
2. Cerca un gioco esistente o clicca su "Aggiungi gioco manualmente"
3. Nel form di aggiunta gioco, troverai la sezione "Immagine"

#### Opzione 1: Upload Diretto

1. Clicca sull'area "Carica un'immagine"
2. Seleziona un file dal tuo dispositivo
3. L'immagine verrà automaticamente compressa e caricata
4. Vedrai un'anteprima dell'immagine
5. Clicca su "Salva Gioco"

**Limitazioni:**
- Formati supportati: JPG, PNG, WebP, GIF
- Dimensione massima: 5MB
- L'immagine viene automaticamente compressa a max 800px di larghezza

#### Opzione 2: URL Esterno

1. Inserisci l'URL dell'immagine nel campo di testo
2. L'immagine verrà visualizzata nell'anteprima
3. Clicca su "Salva Gioco"

## Struttura del Database

### Tabella `games`

La tabella `games` contiene il campo `image_url` che può essere:

- `null`: Nessuna immagine
- URL di Supabase Storage: `https://[project-ref].supabase.co/storage/v1/object/public/game-images/[user-id]/[filename]`
- URL esterno: Qualsiasi URL valido

### Bucket di Storage `game-images`

- **Nome**: `game-images`
- **Pubblico**: Sì
- **Limite dimensione file**: 5MB
- **Formati supportati**: JPEG, JPG, PNG, WebP, GIF
- **Struttura**: `[user-id]/[filename]`

## Politiche di Accesso

⚠️ **IMPORTANTE**: Le politiche di accesso devono essere configurate manualmente dal dashboard di Supabase.

Le politiche di accesso che devono essere configurate nel bucket di storage:

1. **Upload**: Gli utenti autenticati possono caricare immagini nella loro cartella (`[user-id]/`)
2. **Lettura**: Accesso pubblico a tutte le immagini
3. **Aggiornamento**: Gli utenti possono aggiornare solo le proprie immagini
4. **Eliminazione**: Gli utenti possono eliminare solo le proprie immagini

Per configurare queste policy, segui le istruzioni dettagliate nel file [`docs/SUPABASE_STORAGE_SETUP.md`](SUPABASE_STORAGE_SETUP.md).

## Funzioni Utility

Il file [`src/utils/imageUpload.js`](../src/utils/imageUpload.js) contiene le funzioni per gestire l'upload delle immagini:

### `uploadGameImage(file, userId, gameId)`

Carica un'immagine su Supabase Storage.

**Parametri:**
- `file` (File): Il file dell'immagine da caricare
- `userId` (string): L'ID dell'utente autenticato
- `gameId` (string, opzionale): L'ID del gioco

**Ritorna:**
- `Promise<{publicUrl: string, path: string}>`: L'URL pubblico e il path dell'immagine caricata

### `deleteGameImage(filePath)`

Elimina un'immagine da Supabase Storage.

**Parametri:**
- `filePath` (string): Il percorso del file da eliminare

### `compressImage(file, maxWidth, quality)`

Comprime un'immagine prima dell'upload.

**Parametri:**
- `file` (File): Il file dell'immagine
- `maxWidth` (number, default: 800): Larghezza massima in pixel
- `quality` (number, default: 0.8): Qualità dell'immagine (0-1)

**Ritorna:**
- `Promise<Blob>`: L'immagine compressa

## Troubleshooting

### Errore: "Il file è troppo grande"

- La dimensione massima è 5MB
- Comprimi l'immagine prima di caricarla
- Il sistema comprime automaticamente le immagini a max 800px di larghezza

### Errore: "Tipo di file non supportato"

- Assicurati che il file sia in formato JPG, PNG, WebP o GIF
- Controlla l'estensione del file

### Errore: "Errore durante l'upload dell'immagine"

- Verifica che il bucket `game-images` esista
- Controlla le politiche di accesso nel bucket
- Verifica che l'utente sia autenticato

### L'immagine non viene visualizzata

- Verifica che l'URL sia corretto
- Controlla che il bucket sia pubblico
- Verifica che il file esista nel bucket

## Miglioramenti Futuri

- Possibilità di modificare l'immagine di un gioco esistente
- Supporto per più immagini per gioco
- Galleria di immagini per ogni partita
- Ottimizzazione automatica delle immagini in diversi formati

## Note Tecniche

- Le immagini vengono caricate in una cartella dedicata per ogni utente (`[user-id]/`)
- Ogni immagine ha un nome file unico generato automaticamente
- Le immagini sono accessibili pubblicamente tramite URL
- Il sistema utilizza la compressione lato client per ridurre la dimensione dei file
