import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../types/db'
import { simulateEloSource } from './publication'
import { gameHistory } from './projections'
import { readGlobalElo } from './readClient'
import type { EloRead, EloReadResult } from './readModel'
import type { SimulationPlay, SimulationPlayScore } from './simulation'

type GameSourcePlay = Omit<SimulationPlay, 'play_scores'> & {
  play_scores: Array<SimulationPlayScore & { elo_ordinal: number }>
  score_count: Array<{ count: number }>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PAGE_SIZE = 1000

export interface GameDetailElo {
  read: EloRead
  history: EloReadResult['gameHistory']
  calculated: boolean
}

async function gameSource(client: SupabaseClient<Database>, gameId: string): Promise<GameSourcePlay[]> {
  const plays: GameSourcePlay[] = []
  let expectedCount: number | undefined
  for (;;) {
    const { data, count, error } = await client.from('plays').select(`
      id, game_id, played_at, is_cooperative, team_won,
      games(lower_score_wins, shared_score_positions),
      play_scores(player_id, score, winner, position, elo_ordinal, players(name, alias)),
      score_count:play_scores(count)
    `, { count: 'exact' })
      .eq('game_id', gameId)
      .order('played_at', { ascending: true }).order('id', { ascending: true })
      .order('elo_ordinal', { referencedTable: 'play_scores', ascending: true })
      .range(plays.length, plays.length + PAGE_SIZE - 1)
      .overrideTypes<GameSourcePlay[], { merge: false }>()
    if (error) throw new Error('Impossibile leggere lo storico ELO del gioco.')
    if (!Array.isArray(data) || count === null || !Number.isSafeInteger(count) || count < 0
      || (expectedCount !== undefined && count !== expectedCount)
      || plays.length + data.length > count || (!data.length && plays.length < count)) {
      throw new Error('Storico ELO del gioco incompleto o cambiato durante la lettura.')
    }
    expectedCount = count
    plays.push(...data)
    // Follow the exact count even when the server returns less than PAGE_SIZE.
    if (plays.length === count) break
  }
  for (const play of plays) {
    if (play.game_id !== gameId || !Array.isArray(play.play_scores)
      || !Array.isArray(play.score_count) || play.score_count.length !== 1
      || play.score_count[0].count !== play.play_scores.length
      || !play.games || typeof play.games.lower_score_wins !== 'boolean'
      || typeof play.games.shared_score_positions !== 'boolean') {
      throw new Error('Dati ELO del gioco incompleti.')
    }
    let previous = -1
    for (const score of play.play_scores) {
      if (!Number.isSafeInteger(score.elo_ordinal) || score.elo_ordinal <= previous) {
        throw new Error('Ordine dei partecipanti ELO non valido.')
      }
      previous = score.elo_ordinal
    }
  }
  return plays
}

/** Read-only game calculation while global publication is pending; never exposes subset general ELO. */
export async function readGameDetailElo(
  client: SupabaseClient<Database>, gameId: string, initial: EloRead
): Promise<GameDetailElo> {
  if (!UUID.test(gameId) || initial.scopeId !== 'global') throw new Error('Gioco ELO non valido.')
  let read = initial
  for (let attempt = 0; attempt < 2; attempt++) {
    if (read.status === 'current') {
      return { read, history: gameHistory(read, gameId).data ?? [], calculated: false }
    }
    const plays = await gameSource(client, gameId)
    const after = await readGlobalElo(client)
    if (after.status === 'current') {
      return { read: after, history: gameHistory(after, gameId).data ?? [], calculated: false }
    }
    if (after.sourceRevision === read.sourceRevision) {
      const result = simulateEloSource({ scopeId: gameId, sourceRevision: after.sourceRevision, plays })
      return { read: after, history: result.gameHistory, calculated: true }
    }
    // Never combine pages from different revisions. Retry one complete fresh read.
    read = after
  }
  throw new Error('I dati ELO stanno cambiando. Ricarica la pagina per riprovare.')
}
