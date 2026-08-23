import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Fail-fast: senza queste variabili ogni chiamata fallirebbe dopo con errori
// criptici di rete; meglio fermarsi subito con un messaggio actionable.
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '[Supabase] Variabili d\'ambiente mancanti (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). ' +
    'Crea un file .env.local con le credenziali del progetto Supabase.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
