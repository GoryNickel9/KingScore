import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/db'
import type { DbPlayer } from '../types/rows'
import { isVisibleInRankings } from '../utils/rankingVisibility'

/**
 * Accesso ai dati dei giocatori (pattern servizi: client iniettato).
 */

/** Giocatori selezionabili nei moduli AddPlay/EditPlay, ordinati per nome. */
export async function listUserPlayers(supabase: SupabaseClient<Database>, userId: string): Promise<DbPlayer[]> {
  const { data } = await supabase
    .from('players')
    .select('*')
    .eq('user_id', userId)
    .order('name')
  return (data ?? []).filter(player => isVisibleInRankings(player.name))
}

export interface CreatePlayerInput {
  user_id: string
  name: string
  is_me?: boolean
}

export async function createPlayer(supabase: SupabaseClient<Database>, input: CreatePlayerInput): Promise<DbPlayer> {
  const { data, error } = await supabase
    .from('players')
    .insert(input)
    .select()
    .single()
  if (error) throw error
  return data
}
