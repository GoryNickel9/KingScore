import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/db'
import type { DbGame } from '../types/rows'

/**
 * Accesso ai dati dei giochi. Il client è sempre iniettato (pattern dei
 * servizi, vedi bgaImport.ts): le pagine passano il client da lib/supabase,
 * i moduli restano testabili in isolamento.
 *
 * I giochi sono una libreria condivisa (decisione TD-006): la tabella non ha
 * user_id e le policy RLS permettono la lettura a tutti gli autenticati.
 */

/** Dropdown di selezione gioco (AddPlay/EditPlay) e libreria: tutti i giochi, per nome. */
export async function listGames(supabase: SupabaseClient<Database>): Promise<DbGame[]> {
  const { data } = await supabase
    .from('games')
    .select('*')
    .order('name')
  return data ?? []
}

/** Lista "giochi senza immagine" per la pagina Images. */
export async function listGamesWithoutImages(supabase: SupabaseClient<Database>): Promise<DbGame[]> {
  const { data } = await supabase
    .from('games')
    .select('*')
    .order('name', { ascending: true })
  return data ?? []
}

export interface CreateGameInput {
  name: string
  bga_id?: string | null
  min_players?: number | null
  max_players?: number | null
  image_url?: string | null
  lower_score_wins?: boolean
  shared_score_positions?: boolean
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
