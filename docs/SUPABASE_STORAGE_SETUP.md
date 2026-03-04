# Configurazione Manuale di Supabase Storage

Se non puoi eseguire la migrazione SQL automaticamente, puoi configurare il bucket di storage manualmente dal dashboard di Supabase.

## Passo 1: Accedi al Dashboard di Supabase

1. Vai su https://supabase.com/dashboard
2. Seleziona il tuo progetto
3. Clicca su "Storage" nel menu laterale sinistro

## Passo 2: Crea un Nuovo Bucket

1. Clicca sul pulsante "New bucket"
2. Compila i seguenti campi:
   - **Name**: `game-images`
   - **Public bucket**: Seleziona "Make bucket public"
   - **File size limit**: `5242880` (5MB in byte)
   - **Allowed MIME types**: 
     - `image/jpeg`
     - `image/jpg`
     - `image/png`
     - `image/webp`
     - `image/gif`
3. Clicca su "Create bucket"

## Passo 3: Configura le Politiche di Accesso (Policies)

### Politica per l'Upload (INSERT)

1. Clicca sul bucket `game-images`
2. Vai alla tab "Policies"
3. Clicca su "New policy" > "For full customization"
4. Seleziona "INSERT" come operation
5. Compila i seguenti campi:
   - **Policy name**: `Authenticated users can upload game images`
   - **Using expression (check)**:
     ```sql
     bucket_id = 'game-images' AND
     auth.uid()::text = (storage.foldername(name))[1]
     ```
6. Clicca su "Review" e poi "Save policy"

### Politica per l'Aggiornamento (UPDATE)

1. Clicca su "New policy" > "For full customization"
2. Seleziona "UPDATE" come operation
3. Compila i seguenti campi:
   - **Policy name**: `Authenticated users can update their own game images`
   - **Using expression**:
     ```sql
     bucket_id = 'game-images' AND
     auth.uid()::text = (storage.foldername(name))[1]
     ```
   - **With check expression**:
     ```sql
     bucket_id = 'game-images' AND
     auth.uid()::text = (storage.foldername(name))[1]
     ```
4. Clicca su "Review" e poi "Save policy"

### Politica per l'Eliminazione (DELETE)

1. Clicca su "New policy" > "For full customization"
2. Seleziona "DELETE" come operation
3. Compila i seguenti campi:
   - **Policy name**: `Authenticated users can delete their own game images`
   - **Using expression**:
     ```sql
     bucket_id = 'game-images' AND
     auth.uid()::text = (storage.foldername(name))[1]
     ```
4. Clicca su "Review" e poi "Save policy"

### Politica per la Lettura Pubblica (SELECT - Public)

1. Clicca su "New policy" > "Get started quickly"
2. Seleziona "SELECT" come operation
3. Seleziona "Public" come target role
4. Compila i seguenti campi:
   - **Policy name**: `Public read access to game images`
   - **Using expression**:
     ```sql
     bucket_id = 'game-images'
     ```
5. Clicca su "Review" e poi "Save policy"

### Politica per la Lettura Autenticata (SELECT - Authenticated)

1. Clicca su "New policy" > "For full customization"
2. Seleziona "SELECT" come operation
3. Seleziona "Authenticated" come target role
4. Compila i seguenti campi:
   - **Policy name**: `Authenticated users can read their own game images`
   - **Using expression**:
     ```sql
     bucket_id = 'game-images' AND
     auth.uid()::text = (storage.foldername(name))[1]
     ```
5. Clicca su "Review" e poi "Save policy"

## Passo 4: Verifica la Configurazione

1. Vai alla tab "Files" del bucket `game-images`
2. Dovresti vedere il bucket vuoto
3. Clicca su "Upload a file" per testare l'upload
4. Carica un'immagine di test
5. Verifica che l'immagine sia accessibile pubblicamente cliccando sull'URL pubblico

## Passo 5: Verifica le Politiche

1. Vai alla tab "Policies" del bucket `game-images`
2. Dovresti vedere le seguenti politiche:
   - `Authenticated users can upload game images` (INSERT)
   - `Authenticated users can update their own game images` (UPDATE)
   - `Authenticated users can delete their own game images` (DELETE)
   - `Public read access to game images` (SELECT - Public)
   - `Authenticated users can read their own game images` (SELECT - Authenticated)

## Risoluzione dei Problemi

### Errore: "Policy does not exist"

- Verifica di aver creato tutte le politiche necessarie
- Controlla che i nomi delle politiche siano corretti

### Errore: "Permission denied"

- Verifica che le politiche siano attive (toggle verde)
- Controlla che l'utente sia autenticato
- Verifica che l'espressione SQL sia corretta

### Errore: "Bucket not found"

- Verifica che il bucket `game-images` esista
- Controlla che il nome del bucket sia corretto

### L'immagine non è accessibile pubblicamente

- Verifica che il bucket sia pubblico (public: true)
- Controlla che esista la politica di lettura pubblica
- Verifica l'URL pubblico dell'immagine

## Note Importanti

- Le politiche di accesso sono essenziali per la sicurezza del bucket
- Assicurati che gli utenti possano caricare solo nella propria cartella (`[user-id]/`)
- Le immagini devono essere accessibili pubblicamente per essere visualizzate nell'app
- Non modificare le politiche a meno che tu non sia sicuro di cosa stai facendo

## Supporto

Se riscontri problemi durante la configurazione:

1. Controlla la documentazione ufficiale di Supabase: https://supabase.com/docs/guides/storage
2. Verifica le impostazioni del tuo progetto Supabase
3. Controlla i log delle attività nel dashboard di Supabase
4. Assicurati di avere i permessi necessari per configurare il bucket
