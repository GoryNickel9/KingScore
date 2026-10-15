import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/db'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Fail-fast: senza queste variabili ogni chiamata fallirebbe dopo con errori
// criptici di rete; meglio fermarsi subito con un messaggio actionable.
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '[Supabase] Variabili d\'ambiente mancanti (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). ' +
    'Crea un file .env.local con le credenziali del progetto Supabase.'
  )
}

// Client tipizzato sullo schema reale: i risultati delle query (inclusi i
// join annidati) sono tipizzati; le asserzioni `as` sulle select non servono più.
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)
