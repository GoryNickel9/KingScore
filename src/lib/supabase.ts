import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

// Verifica che le variabili d'ambiente siano configurate
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('[Supabase] Variabili d\'ambiente mancanti!')
  console.error('[Supabase] VITE_SUPABASE_URL:', supabaseUrl ? 'Configurato' : 'NON CONFIGURATO')
  console.error('[Supabase] VITE_SUPABASE_ANON_KEY:', supabaseAnonKey ? 'Configurato' : 'NON CONFIGURATO')
  console.error('[Supabase] Assicurati di aver creato il file .env.local con le credenziali di Supabase')
} else if (import.meta.env.DEV) {
  console.log('[Supabase] Connessione inizializzata correttamente')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
