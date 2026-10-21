import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../types/db'
import { decodeEloRead } from './readModel'
import type { EloRead } from './readModel'
import { generalHistory } from './projections'

export const atomicEloReadsEnabled = import.meta.env.VITE_ATOMIC_PLAY_WRITES === 'true'

interface EloRpcClient {
  rpc(name: 'get_elo_publication_v1'): PromiseLike<{ data: unknown; error: unknown }>
}

/** One public snapshot for all four views; never falls back to mutable caches. */
export async function readGlobalElo(client: SupabaseClient<Database> | EloRpcClient): Promise<EloRead> {
  const { data, error } = await (client as EloRpcClient).rpc('get_elo_publication_v1')
  if (error) throw new Error('Classifica ELO non disponibile. Riprova più tardi.')
  return decodeEloRead(data, 'global')
}

/** Wrapped selects a year from the complete global history, without restarting ratings. */
export async function readGlobalEloYear(client: SupabaseClient<Database> | EloRpcClient, year: number) {
  if (!Number.isInteger(year) || year < 1 || year > 9999) throw new Error('Anno ELO non valido.')
  const read = await readGlobalElo(client)
  const prefix = `${String(year).padStart(4, '0')}-`
  const history = generalHistory(read).data
  return { read, history: history === null ? null : history.filter(point => point.date.startsWith(prefix)) }
}

export function eloReadStatus(read: EloRead | null, failed = false): string {
  if (failed) return 'Impossibile caricare la classifica ELO. Ricarica la pagina per riprovare.'
  if (!read) return 'Caricamento della classifica ELO globale…'
  if (read.status === 'missing') return 'La classifica ELO globale non è ancora disponibile. Ricarica la pagina per verificare gli aggiornamenti.'
  if (read.status === 'stale') return 'Aggiornamento ELO in attesa. I risultati precedenti restano nascosti finché la classifica non sarà aggiornata. Ricarica la pagina per verificare gli aggiornamenti.'
  return ''
}
