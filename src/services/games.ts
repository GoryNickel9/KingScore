import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/db'
import type { DbGame } from '../types/rows'

/**
 * Accesso ai dati dei giochi. Il client è sempre iniettato (pattern dei
 * servizi, vedi bgaImport.ts): le pagine passano il client da lib/supabase,
 * i moduli restano testabili in isolamento.
 */

/** Dropdown di selezione gioco (AddPlay/EditPlay): i giochi dell'utente, per nome. */
export async function listUserGames(supabase: SupabaseClient<Database>, userId: string): Promise<DbGame[]> {
  const { data } = await supabase
    .from('games')
    .select('*')
    .eq('user_id', userId)
    .order('name')
  return data ?? []
}

/** Lista "giochi senza immagine" per la pagina Images. */
export async function listGamesWithoutImages(supabase: SupabaseClient<Database>, userId: string): Promise<DbGame[]> {
  const { data } = await supabase
    .from('games')
    .select('*')
    .eq('user_id', userId)
    .order('name', { ascending: true })
  return data ?? []
}

export interface CreateGameInput {
  user_id: string
  name: string
  bga_id?: string | null
  min_players?: number | null
  max_players?: number | null
  image_url?: string | null
}

export async function createGame(supabase: SupabaseClient<Database>, input: CreateGameInput): Promise<DbGame> {
  const { data, error } = await supabase
    .from('games')
    .insert(input)
    .select()
    .single()
  if (error) throw error
  return data
}
