# BGStats — Analisi Completa del Codebase
> Generato il 10 Marzo 2026 — Analisi condotta su architettura, qualità del codice, sicurezza e opportunità di miglioramento.

---

## Indice
1. [� Problemi di Sicurezza Alti](#-problemi-di-sicurezza-alti)
2. [🟡 Problemi di Sicurezza Medi](#-problemi-di-sicurezza-medi)
3. [🔵 Problemi di Sicurezza Bassi](#-problemi-di-sicurezza-bassi)
4. [♻️ Refactoring — Duplicazione del Codice](#️-refactoring--duplicazione-del-codice)
5. [🐛 Bug & Comportamenti Inattesi](#-bug--comportamenti-inattesi)
6. [⚡ Performance](#-performance)
7. [♿ Accessibilità](#-accessibilità)
8. [🏗️ Architettura & Type Safety](#️-architettura--type-safety)
9. [✨ Feature Consigliate](#-feature-consigliate)
10. [📊 Tabella Riepilogativa](#-tabella-riepilogativa)

---

## � Problemi di Sicurezza Alti

### H-2 — URL Esterno Non Validato Salvato e Renderizzato (SSRF + XSS)
**File:** [`src/pages/Images.tsx`](../src/pages/Images.tsx)

```typescript
// L'URL viene salvato direttamente dall'input utente senza validazione
await supabase.from('games').update({ image_url: url }).eq('id', game.id)

// E renderizzato come src di un img
<img src={url} ... />
```

`type="url"` HTML5 non blocca: URI `javascript:`, URI `data:`, indirizzi di rete privata (SSRF), contenuto non immagine.

**Fix:**
```typescript
const handleSave = async (game: DbGame): Promise<void> => {
  const url = urlInputs[game.id]?.trim()
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') throw new Error()
  } catch {
    toast.error('Usa un URL HTTPS valido')
    return
  }
  // ... salva
}
```

---

## 🟡 Problemi di Sicurezza Medi

### M-1 — Validazione MIME Type Solo Lato Client (Aggirabile)
**File:** [`src/utils/imageUpload.ts`](../src/utils/imageUpload.ts)

```typescript
// file.type è fornito dal browser — può essere falsificato
if (!allowedTypes.includes(file.type)) { ... }

// Estrazione estensione non sicura
const fileExt = file.name.split('.').pop() // undefined se nessun punto nel nome
```

**Fix:**
```typescript
const fileExt = file.name.includes('.') 
  ? file.name.split('.').pop()!.toLowerCase() 
  : 'bin'
const safeExts = ['jpg', 'jpeg', 'png', 'webp', 'gif']
if (!safeExts.includes(fileExt)) throw new Error('Estensione non supportata')
```

---

### M-2 — Password Minima Troppo Corta (6 Caratteri) + `alert()` Inconsistente
**File:** [`src/pages/Register.tsx`](../src/pages/Register.tsx)

```typescript
// 6 caratteri è insufficiente (NIST consiglia minimo 8, ideale 12+)
if (password.length < 6) {
  alert('La password deve avere almeno 6 caratteri') // alert() invece di toast
  return
}
```

**Fix:**
```typescript
if (password.length < 12) {
  toast.error('La password deve avere almeno 12 caratteri')
  return
}
```

---

### M-3 — Messaggi di Errore Supabase Esposti Verbatim agli Utenti
**File:** [`src/contexts/AuthContext.tsx`](../src/contexts/AuthContext.tsx)

```typescript
// Messaggio raw Supabase mostrato all'utente
toast.error((error as Error).message)
```

**Fix — mappa i messaggi comuni:**
```typescript
const AUTH_ERROR_MAP: Record<string, string> = {
  'Invalid login credentials': 'Email o password errati',
  'Email not confirmed': 'Conferma la tua email prima di accedere',
  'User already registered': 'Email già in uso',
}
const msg = AUTH_ERROR_MAP[(error as Error).message] ?? 'Si è verificato un errore. Riprova.'
toast.error(msg)
```

---

### M-4 — Header di Sicurezza HTTP Mancanti in Produzione
**File:** [`vercel.json`](../vercel.json)

Nessun header di sicurezza HTTP è configurato. Aggiungere a `vercel.json`:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
        { "key": "Content-Security-Policy", "value": "default-src 'self'; img-src 'self' https: data:; connect-src 'self' https://*.supabase.co https://boardgamegeek.com; script-src 'self'; style-src 'self' 'unsafe-inline';" }
      ]
    }
  ],
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

---

### M-5 — Nessuna Validazione dei Dati Prima dell'Insert nell'Import
**File:** [`src/pages/Import.tsx`](../src/pages/Import.tsx)

I dati parsati da file di testo vengono inseriti in Supabase senza validazione di lunghezza o range: nomi senza limite (colonna `TEXT`), `duration_minutes` non bounded, `bga_table_id` non sanitizzato, date potenzialmente fuori range.

**Fix — aggiungere prima di ogni insert:**
```typescript
const MAX_NAME_LEN = 200
const MAX_DURATION = 1440 // 24 ore max

name = name.slice(0, MAX_NAME_LEN)
durationMinutes = Math.max(0, Math.min(durationMinutes, MAX_DURATION))
```

---

### M-6 — Nessun Rate Limiting su Login e Operazioni di Import
**File:** [`src/pages/Login.tsx`](../src/pages/Login.tsx), [`src/pages/Import.tsx`](../src/pages/Import.tsx)

L'import può inviare centinaia di chiamate sequenziali a Supabase e all'API BGG senza throttling né backoff. Usare `p-limit` per limitare la concorrenza durante l'import.

---

## 🔵 Problemi di Sicurezza Bassi

### L-1 — Pattern N+1 nell'Aggiornamento ELO
**File:** [`src/utils/eloCalculator.ts`](../src/utils/eloCalculator.ts)

Per ogni giocatore in ogni partita, la funzione ELO esegue una `SELECT` separata per verificare se esiste un rating, poi un `UPDATE` o `INSERT`. Per un import di 291 partite con 3 giocatori ciascuna = ~1.746 round-trip solo per gli aggiornamenti ELO.

**Fix:** Usare `upsert()` con un array di record e conflict target `(player_id, game_id)`.

---

### L-2 — Index Composito Mancante su `elo_history`
**File:** [`supabase/migrations/add_elo_history.sql`](../supabase/migrations/add_elo_history.sql)

```sql
-- Aggiungere per query di range per (game_id, player_id, is_general)
CREATE INDEX IF NOT EXISTS idx_elo_history_game_player
  ON elo_history(game_id, player_id, is_general);
```

---

## ♻️ Refactoring — Duplicazione del Codice

### R-1 — Spinner Inline Copiato in 13+ File (Critico)
**File:** tutti i page file + [`src/components/ProtectedRoute.tsx`](../src/components/ProtectedRoute.tsx)

Lo stesso SVG spinner è incollato letteralmente in Dashboard, Plays, Games, Players, Stats, ELO, GameDetail, PlayerDetail, PlayDetail, EditPlay, Images, ProtectedRoute. Esiste già [`src/components/Spinner.tsx`](../src/components/Spinner.tsx), ma **non viene importato in nessun file**.

Inoltre, `Spinner.tsx` usa `text-blue-500` mentre ogni pagina usa `text-emerald-500`.

**Fix:** Aggiornare `Spinner.tsx` per accettare `color` e `className`, poi sostituire tutti i duplicati:
```tsx
// Spinner.tsx aggiornato
interface SpinnerProps {
  color?: string
  className?: string
}

export function Spinner({ color = 'text-emerald-500', className = 'min-h-screen' }: SpinnerProps) {
  return (
    <div role="status" aria-label="Caricamento..." className={`flex justify-center items-center ${className}`}>
      <svg className={`animate-spin h-8 w-8 ${color}`} ...>...</svg>
    </div>
  )
}
```

---

### R-2 — Interfacce DB Ridefinite in Ogni Pagina
**File:** Dashboard, Plays, Games, AddPlay, EditPlay, GameDetail, PlayerDetail, PlayDetail, Stats, ELO

`DbGame`, `DbPlayer`, `DbPlayScore`, `DbPlay` sono definite localmente in ogni pagina con struttura identica. Appartengono tutte a [`src/types/index.ts`](../src/types/index.ts).

---

### R-3 — Helper Avatar Duplicati
**File:** [`src/pages/Players.tsx`](../src/pages/Players.tsx), [`src/pages/PlayerDetail.tsx`](../src/pages/PlayerDetail.tsx)

`getAvatarColor(name)` e `getInitials(name)` sono definite identicamente in entrambi i file. Estrarle in `src/utils/avatarHelpers.ts`.

---

### R-4 — Pattern Stat Card JSX Copiato
**File:** [`src/pages/Dashboard.tsx`](../src/pages/Dashboard.tsx), [`src/pages/GameDetail.tsx`](../src/pages/GameDetail.tsx), [`src/pages/PlayerDetail.tsx`](../src/pages/PlayerDetail.tsx)

Il pattern griglia tre-card (icona + numero grande + etichetta) è copiato verbatim. Un componente `<StatCard />` eliminerebbe ~30 righe per pagina.

```tsx
interface StatCardProps {
  icon: React.ReactNode
  label: string
  value: string | number
  colorClass: string
}

function StatCard({ icon, label, value, colorClass }: StatCardProps) { ... }
```

---

### R-5 — Formattazione Date Ripetuta
**File:** Dashboard, Plays, PlayDetail, GameDetail, PlayerDetail

```typescript
// Copiato 5+ volte con variazioni minime
new Date(x).toLocaleDateString('it-IT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
```

Estrarre in `src/utils/formatDate.ts`.

---

### R-6 — Funzioni Upload/Delete/GetUrl Duplicate in `imageUpload.ts`
**File:** [`src/utils/imageUpload.ts`](../src/utils/imageUpload.ts)

`uploadGameImage` e `uploadPlayerImage` (~45 righe ciascuna) sono quasi identiche. Le uniche differenze sono bucket, dimensione massima e path. Stessa cosa per `deleteGameImage`/`deletePlayerImage` e `getGameImageUrl`/`getPlayerImageUrl`.

**Fix — helper generico:**
```typescript
async function uploadImage(
  file: File,
  userId: string,
  bucket: 'game-images' | 'player-images',
  pathPrefix: string,
  maxSizeMB: number
): Promise<UploadResult> { ... }
```

---

### R-7 — Logica Assegnazione Posizioni ELO Triplicata
**File:** [`src/utils/eloCalculator.ts`](../src/utils/eloCalculator.ts)

Il blocco che ordina i giocatori e assegna `finalPosition` appare 3 volte nelle funzioni `calculateELOForGame`, `recalculateAllELOForGame`, e `getELOHistoryForGame`. Estrarre in:

```typescript
function assignPositions(players: PlayerInput[]): PlayerWithPosition[] { ... }
```

---

## 🐛 Bug & Comportamenti Inattesi

### B-1 — Crash `user!.id` su Pagina Pubblica
**File:** [`src/pages/GameDetail.tsx`](../src/pages/GameDetail.tsx)

```typescript
// Crash se l'utente non è autenticato — la pagina è pubblica
.eq('user_id', user!.id)
```

Un utente non autenticato che visita `/games/:id` provoca un errore runtime. Aggiungere un guard: `if (!user) return`.

---

### B-2 — Errore di Login Non Mostrato all'Utente
**File:** [`src/pages/Login.tsx`](../src/pages/Login.tsx)

Il risultato `error` di `signIn` viene controllato ma **non mostrato all'utente** — nessun toast, nessun messaggio inline. L'utente rimane sulla pagina di login senza feedback.

---

### B-3 — Filtro Giocatore in Plays.tsx Non Renderizzato
**File:** [`src/pages/Plays.tsx`](../src/pages/Plays.tsx)

Il campo `player` esiste nell'interfaccia `Filters`, nello state, e nel pulsante "Rimuovi filtri" — ma **nessun controllo UI lo rende selezionabile**. Il filtro è cablato ma invisibile.

---

### B-4 — Link "Aggiungi Partita" Visibile agli Utenti Non Autenticati
**File:** [`src/pages/Plays.tsx`](../src/pages/Plays.tsx)

Il link `/plays/new` è mostrato anche a utenti non loggati. Cliccandolo vengono reindirizzati a `/login` senza spiegazione. Renderlo visibile solo se `user` è definito.

---

### B-5 — Nessun Reindirizzamento da `/login` per Utenti già Autenticati
**File:** [`src/pages/Login.tsx`](../src/pages/Login.tsx), [`src/pages/Register.tsx`](../src/pages/Register.tsx)

Un utente autenticato può navigare a `/login` e vedere il form. Aggiungere un early return con `<Navigate to="/" />` se `user` è definito.

---

### B-6 — UX Delete Inconsistente
**File:** [`src/pages/Games.tsx`](../src/pages/Games.tsx) vs [`src/pages/Players.tsx`](../src/pages/Players.tsx)

`Games.tsx` usa `window.confirm()` per la conferma eliminazione. `Players.tsx` usa una modal personalizzata. Uniformare con la modal custom.

---

### B-7 — `console.log` Debug Rimasti in Produzione
**File:** [`src/pages/Games.tsx`](../src/pages/Games.tsx)

Numerosi `console.log` nel handler di eliminazione. Rimuoverli.

---

### B-8 — `calculateActualScore` Divisione per Zero
**File:** [`src/utils/eloCalculator.ts`](../src/utils/eloCalculator.ts)

Quando `totalPlayers === 1`, la formula divide per `(totalPlayers - 1) = 0`. Il guard in `calculateELOForGame` previene questo nel flusso normale, ma la funzione esportata standalone non è protetta.

---

## ⚡ Performance

### P-1 — Nessun Lazy Loading delle Route
**File:** [`src/App.tsx`](../src/App.tsx)

Tutti e 15 i page component sono importati eagerly. Ogni utente scarica il JS di tutte le pagine al primo accesso. `recharts` (~400KB non compresso) e `fast-xml-parser` (~108KB) — usati solo in 2 pagine tra le 15 — sono inclusi nel bundle principale.

**Fix:**
```typescript
// Prima
import Dashboard from './pages/Dashboard'

// Dopo
const Dashboard = React.lazy(() => import('./pages/Dashboard'))

// In App.tsx, wrappare le route in <Suspense>
<Suspense fallback={<Spinner />}>
  <Routes>...</Routes>
</Suspense>
```

Aggiungere a `vite.config.ts`:
```typescript
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'recharts': ['recharts'],
        'xml-parser': ['fast-xml-parser'],
      }
    }
  }
}
```

---

### P-2 — Aggregazioni Costose In-Memory nel Dashboard
**File:** [`src/pages/Dashboard.tsx`](../src/pages/Dashboard.tsx)

Il dashboard carica **tutte** le partite solo per trovare i top 3 giochi per conteggio:
```typescript
const { data: playsData } = await supabase.from('plays').select('game_id, games(*)')
// poi riduce in JS per trovare i top 3
```

Sostituire con una query Postgres aggregata (o una Supabase RPC) che restituisce direttamente i top N.

---

### P-3 — Stats.tsx Carica Tutte le Partite con `.limit(10000)`
**File:** [`src/pages/Stats.tsx`](../src/pages/Stats.tsx)

```typescript
.limit(10000) // workaround per il limite default di 1000 righe
```

Tutte le partite con join completi (`games`, `play_scores`, `players`) caricate in memoria per calcoli JS. Per librerie grandi questo rallenterà drasticamente. Migrare verso query aggregate dedicate o Supabase RPCs/Views.

---

### P-4 — Fetch Waterfall nelle Pagine di Dettaglio
**File:** [`src/pages/GameDetail.tsx`](../src/pages/GameDetail.tsx), [`src/pages/PlayerDetail.tsx`](../src/pages/PlayerDetail.tsx)

3 chiamate Supabase sequenziali (`await` uno dopo l'altro) su ogni caricamento pagina. Parallelizzare con `Promise.all()`.

---

### P-5 — Array e Funzioni Ricreati ad Ogni Render nel Navbar
**File:** [`src/components/Navbar.tsx`](../src/components/Navbar.tsx)

`publicNavItems` e `profileNavItems` sono array letterali dichiarati nel corpo del componente. Dovrebbero essere costanti a livello di modulo. `isActive` è una funzione freccia ricreata ad ogni render — usare `useCallback` o portarla fuori dal componente.

---

### P-6 — Context Value Senza `useMemo` in AuthContext
**File:** [`src/contexts/AuthContext.tsx`](../src/contexts/AuthContext.tsx)

```typescript
// Nuovo oggetto ad ogni render di AuthProvider → tutti i consumer si re-renderizzano
return { user, loading, signUp, signIn, signOut }
```

**Fix:**
```typescript
const value = useMemo(
  () => ({ user, loading, signUp, signIn, signOut }),
  [user, loading]
)
return <AuthContext.Provider value={value}>
```

---

## ♿ Accessibilità

| Componente | Problema |
|---|---|
| [`Spinner.tsx`](../src/components/Spinner.tsx) | Nessun `role="status"`, `aria-label`, o `aria-live="polite"` |
| [`ErrorBoundary.tsx`](../src/components/ErrorBoundary.tsx) | Nessun `role="alert"` o `aria-live="assertive"` |
| [`Navbar.tsx`](../src/components/Navbar.tsx) — pulsante profilo | Nessun `aria-expanded`, `aria-haspopup="menu"`, `aria-controls` |
| [`Navbar.tsx`](../src/components/Navbar.tsx) — dropdown | Nessun `role="menu"` sulle voci, nessun `role="menuitem"` |
| [`Navbar.tsx`](../src/components/Navbar.tsx) — nav landmark | Nessun `aria-label` sull'elemento `<nav>` |
| [`Navbar.tsx`](../src/components/Navbar.tsx) — tastiera | Nessun handler `Escape` per chiudere il dropdown |
| Mobile nav | Nessun link Login per utenti non autenticati (asimmetria con desktop) |

---

## 🏗️ Architettura & Type Safety

### A-1 — Nessun Custom Hook: Logica Fetch Sparsa in Ogni Pagina
**File:** [`src/hooks/`](../src/hooks/) (directory vuota)

La directory `hooks/` esiste ma contiene solo `.gitkeep`. Tutti i `useEffect` + `useState` per il fetch dati vivono inline in ogni pagina. Questo rende la logica non riutilizzabile e non testabile.

**Fix:** Creare hook come `usePlays()`, `useGames()`, `usePlayerDetail(id)` che incapsulano fetch, loading, error state. Considerare **TanStack Query** per caching e invalidazione automatica.

---

### A-2 — Tipo Errato su Campi di Join Supabase
**File:** [`src/types/index.ts`](../src/types/index.ts)

```typescript
// PlayScore.players è singolare (join su una riga), ma il nome è plurale
players?: Player  // dovrebbe essere player?

// Play.games è singolare
games?: Game      // dovrebbe essere game?
```

Nomi fuorvianti che causano confusione quando si legge il codice.

---

### A-3 — Tipi Utility Non Usati in `types/index.ts`
**File:** [`src/types/index.ts`](../src/types/index.ts)

`Nullable<T>` e `Optional<T>` sono definiti ma non importati da nessuna parte nel codebase. Dead code da rimuovere.

---

### A-4 — Tipi `any` Pervasivi in `eloCalculator.ts` e `diagnosePlays.ts`

```typescript
// eloCalculator.ts
score: any  // dovrebbe essere PlayScore & { players: Player }

// diagnosePlays.ts
play: any   // PlayInfo è già disponibile
scores: any[]
```

Le funzioni di ritorno usano `Record<string, unknown>[]` invece delle interfacce tipizzate definite nel file stesso.

---

### A-5 — `eloCalculator.ts` Troppo Lungo (~800 Righe) e Multi-Responsabilità
**File:** [`src/utils/eloCalculator.ts`](../src/utils/eloCalculator.ts)

Il file mescola: matematica pura ELO, letture DB, scritture DB, gestione cache, calcolo storico. Suddividere in:
- `eloMath.ts` — funzioni di calcolo pure (nessuna dipendenza Supabase)
- `eloDatabase.ts` — operazioni CRUD
- `eloHistory.ts` — logica di ricalcolo storico

---

### A-6 — Interfacce ELO Private al File, Non in `types/index.ts`

`PlayerInput`, `PlayerWithPosition`, `EloResult`, `GeneralELOResult`, `ELOHistoryEntry`, etc. sono dichiarate localmente e non esportate. I file consumer ricevono `Record<string, unknown>[]` senza type safety.

---

### A-7 — `supabase.ts` Fallisce Silenziosamente
**File:** [`src/lib/supabase.ts`](../src/lib/supabase.ts)

```typescript
// Il cast `as string` inganna TypeScript — se la variabile è undefined,
// createClient riceve undefined silenziosamente
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
```

**Fix:**
```typescript
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Variabili d\'ambiente Supabase mancanti')
}
```

---

### A-8 — Doppie Notifiche di Errore in AuthContext
**File:** [`src/contexts/AuthContext.tsx`](../src/contexts/AuthContext.tsx)

Le funzioni `signUp`/`signIn`/`signOut` chiamano `toast.error()` nel catch block E restituiscono `{ error }`. Se il chiamante gestisce l'errore e mostra un suo messaggio, l'utente vede due notifiche di errore.

---

### A-9 — `browserDiagnoseFunction()` è Dead Code
**File:** [`src/utils/diagnosePlays.ts`](../src/utils/diagnosePlays.ts)

Questa funzione restituisce una stringa di JavaScript da incollare in una console browser. Non ha caller, non ha test, non fa parte di nessun workflow reale. Rimuoverla o trasformarla in una utility importabile.

---

## ✨ Feature Consigliate

| Priorità | Feature | Descrizione |
|---|---|---|
| 🔴 Alta | **Filtro giocatore in Plays** | Già cablato in types/state, manca solo la UI (`<select>` players) |
| 🔴 Alta | **Lazy loading delle route** | `React.lazy()` + `Suspense` — cambiamento one-liner per pagina, impatto su bundle enorme |
| 🔴 Alta | **Toast su errori fetch** | Tutti gli errori silenziosi (catch → console.error) devono mostrare feedback all'utente |
| 🔴 Alta | **Custom data hooks / TanStack Query** | Evitare re-fetch su back-navigation, centralizzare la logica, migliorare la DX |
| 🟠 Media | **Paginazione su Plays e Games** | Cursor-based pagination nativa Supabase per dataset grandi |
| 🟠 Media | **Confronto testa-a-testa tra giocatori** | "Quando gioco con il Giocatore X il mio win rate è Y%" — schermata dedicata |
| 🟠 Media | **Valutazione personale dei giochi (1-10)** | Colonna `rating` su `games`, mostrata su GameDetail |
| 🟠 Media | **Supporto giochi cooperativi** | Flag `team_won: boolean` a livello partita, anziché forzare un singolo vincitore |
| 🟠 Media | **Gestione pareggi / più vincitori** | Il DB lo supporta ma l'UI permette un solo vincitore |
| 🟠 Media | **BGG search nel form di aggiunta gioco** | La logica `fetchGameImageFromBGG` in Import.tsx può essere riutilizzata in add/edit |
| 🟠 Media | **Export dati (CSV / JSON)** | Gli utenti devono poter esportare i propri dati |
| 🟡 Bassa | **Ricerca/filtro nella pagina Players** | Semplice `useState` + `.filter()` — velocissimo da implementare |
| 🟡 Bassa | **Ricerca nella pagina ELO** | Leaderboard filtrabile per nome giocatore |
| 🟡 Bassa | **"Forgot password" flow** | Supabase lo supporta nativamente; manca il link nella pagina Login |
| 🟡 Bassa | **Reindirizzamento da /login per utenti autenticati** | Qualità UX — `<Navigate to="/" />` se `user` è definito |
| 🟡 Bassa | **Riepilogo annuale "Wrapped"** | "Il tuo anno in giochi" nel modulo Stats |
| 🟡 Bassa | **Achievement / badge** | "Prima vittoria a Wingspan", "10 sconfitte consecutive", etc. |
| 🟡 Bassa | **Autocomplete luoghi partita** | Il campo location è free-text — salvare i luoghi usati e autocompletare |
| 🟡 Bassa | **PWA / supporto offline** | Service worker per browsing offline in sola lettura dei dati già caricati |
| 🟡 Bassa | **Statistiche di gruppo** | Analisi quando giocano tutti i giocatori insieme (sessioni) |

---

## 📊 Tabella Riepilogativa

### Sicurezza

| # | File | Severità | Problema |
|---|---|---|---|
| H-2 | `Images.tsx` | 🟠 Alto | URL esterno non validato (SSRF/XSS) |
| M-1 | `imageUpload.ts` | 🟡 Medio | MIME type solo lato client |
| M-2 | `Register.tsx` | 🟡 Medio | Password minima 6 char + alert() |
| M-3 | `AuthContext.tsx` | 🟡 Medio | Messaggi errore Supabase raw |
| M-4 | `vercel.json` | 🟡 Medio | Header HTTP sicurezza mancanti |
| M-5 | `Import.tsx` | 🟡 Medio | Nessuna validazione prima dell'insert |
| M-6 | `Import.tsx` | 🟡 Medio | Nessun rate limiting |
| L-1 | `eloCalculator.ts` | 🔵 Basso | Pattern N+1 nell'aggiornamento ELO |
| L-2 | `add_elo_history.sql` | 🔵 Basso | Index composito mancante su elo_history |

### Qualità del Codice

| # | File(s) | Tipo | Problema |
|---|---|---|---|
| R-1 | 13+ file | Duplicazione | Spinner SVG copiato, Spinner.tsx ignorato |
| R-2 | Tutte le pagine | Duplicazione | Interfacce DB ridefinite localmente |
| R-3 | Players, PlayerDetail | Duplicazione | getAvatarColor / getInitials duplicati |
| R-4 | Dashboard, GameDetail, PlayerDetail | Duplicazione | Pattern StatCard non componentizzato |
| R-5 | 5+ file | Duplicazione | Formattazione date ripetuta |
| R-6 | `imageUpload.ts` | Duplicazione | Upload/Delete/GetUrl duplicati per tipo |
| R-7 | `eloCalculator.ts` | Duplicazione | Logica posizioni ELO triplicata |
| B-1 | `GameDetail.tsx` | Bug | Crash `user!.id` su pagina pubblica |
| B-2 | `Login.tsx` | Bug | Errore login non mostrato all'utente |
| B-3 | `Plays.tsx` | Bug | Filtro player non renderizzato |
| B-4 | `Plays.tsx` | UX | Link "Aggiungi Partita" visibile a tutti |
| B-5 | Login, Register | UX | Nessun redirect per utenti già loggati |
| B-6 | Games, Players | UX | Delete confirmation inconsistente |
| B-7 | `Games.tsx` | Qualità | console.log in produzione |
| B-8 | `eloCalculator.ts` | Bug | Divisione per zero con 1 giocatore |
| P-1 | `App.tsx` | Performance | Nessun lazy loading — bundle monolitico |
| P-2 | `Dashboard.tsx` | Performance | Aggregazione in-memory di tutte le partite |
| P-3 | `Stats.tsx` | Performance | limit(10000) + calcoli in-memory |
| P-4 | GameDetail, PlayerDetail | Performance | Fetch waterfall (3 chiamate sequenziali) |
| P-5 | `Navbar.tsx` | Performance | Array/funzioni ricreati ad ogni render |
| P-6 | `AuthContext.tsx` | Performance | Context value senza useMemo |
| A-1 | `src/hooks/` | Architettura | Directory vuota — nessun custom hook |
| A-2 | `types/index.ts` | Type Safety | Nomi campi join fuorvianti (plurale vs singolare) |
| A-3 | `types/index.ts` | Dead Code | Nullable<T> / Optional<T> inutilizzati |
| A-4 | `eloCalculator.ts` | Type Safety | Tipi `any` pervasivi |
| A-5 | `eloCalculator.ts` | Architettura | File 800 righe, multi-responsabilità |
| A-6 | `eloCalculator.ts` | Type Safety | Interfacce ELO non esportate |
| A-7 | `supabase.ts` | Bug | Fallimento silenzioso su env vars mancanti |
| A-8 | `AuthContext.tsx` | UX | Doppia notifica errore |
| A-9 | `diagnosePlays.ts` | Dead Code | browserDiagnoseFunction() inutilizzata |

---

*Report generato analizzando: 15 pagine, 5 componenti, 1 context, 3 utilities, 16 migrazioni SQL, 1 policy SQL, configurazione Vite/Vercel/TypeScript.*
