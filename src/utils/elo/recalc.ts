import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../types/db.ts'
// Import con estensione .ts: richiesto da Deno (Edge Function), gestito da
// Vite/tsc grazie ad allowImportingTsExtensions
import { simulateAllPlays } from './simulation.ts'
import type { SimulationPlay } from './simulation.ts'
import { withRetry } from '../retry.ts'
import { fetchAllPages } from '../pagination.ts'
import { assignPositions } from './positions.ts'

/**
 * Pipeline di ricalcolo completo ELO condivisa dal frontend (pulsante
 * "Ricalcola Tutti gli ELO") e dall'Edge Function notturna
 * (supabase/functions/nightly-elo-recalc).
 *
 * Unica lettura bulk → simulazione interamente in memoria (core puro) →
 * poche scritture massive. Circa 6-10 richieste di rete totali, contro le
 * migliaia di richieste sequenziali del percorso per-partita precedente
 * (vedi docs/ottimizzazione-calcolo-elo-generale.md, OP1-OP2).
 *
 * Nota per Deno: l'unico import a runtime è il core puro simulation.ts
 * (zero dipendenze); tutte le operazioni sul database passano dal client
 * ricevuto in input, quindi la stessa pipeline gira nel browser (token
 * utente, RLS attivo) e server-side (service role).
 */

const BATCH_SIZE = 500
const DELETE_ID_CHUNK = 50

export interface RecalcSummary {
  playsTotal: number
  playsProcessed: number
  playsSkipped: number
  games: number
  players: number
  historyEntries: number
  durationMs: number
}

interface PlayerRatingRow {
  player_id: string
  game_id: string
  rating: number
  games_played: number
  wins: number
  losses: number
  draws: number
  last_played_at: string
}

interface GeneralRatingRow {
  player_id: string
  user_id: string
  rating: number
  games_played: number
  wins: number
  losses: number
  draws: number
  last_played_at: string
}

interface EloHistoryRow {
  play_id: string
  game_id: string | null
  player_id: string
  player_name: string
  rating: number
  rating_change: number
  date: string
  is_general: boolean
  games_played: number | null
  user_id: string
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

// Le scritture batch vanno in retry con backoff sui fallimenti transitori
// (5xx, timeout). Il rischio di righe duplicate in caso di timeout ambiguo è
// accettato: l'intera pipeline è idempotente e ogni esecuzione riparte da
// una delete, quindi l'esecuzione successiva ripulisce eventuali duplicati.
const WRITE_RETRIES = 2

async function insertInBatches(supabase: SupabaseClient, table: string, rows: Record<string, unknown>[]): Promise<void> {
  for (const batch of chunk(rows, BATCH_SIZE)) {
    await withRetry(async () => {
      const { error } = await supabase.from(table).insert(batch)
      if (error) throw new Error(`[performFullRecalc] Insert su ${table} fallito: ${error.message}`)
    }, { retries: WRITE_RETRIES })
  }
}

async function upsertInBatches(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string
): Promise<void> {
  for (const batch of chunk(rows, BATCH_SIZE)) {
    await withRetry(async () => {
      const { error } = await supabase.from(table).upsert(batch, { onConflict })
      if (error) throw new Error(`[performFullRecalc] Upsert su ${table} fallito: ${error.message}`)
    }, { retries: WRITE_RETRIES })
  }
}

/**
 * Ricalcola da zero tutti i rating ELO dell'utente (per gioco e Generali)
 * e rigenera l'intera cache elo_history.
 *
 * Idempotente: parte sempre dai dati raw (plays/play_scores) e ricostruisce
 * tutto; rieseguire produce lo stesso risultato.
 */
export async function performFullRecalc(supabase: SupabaseClient<Database>, userId: string): Promise<RecalcSummary> {
  const startedAt = Date.now()

  // ── 1. Lettura bulk di tutte le partite dell'utente ──────────────────────
  // Paginata: PostgREST tronca a db-max-rows (1000 righe) qualunque limit,
  // e un ricalcolo su partite troncate produrrebbe rating silenziosamente
  // sbagliati.
  const plays = await fetchAllPages((from, to) =>
    supabase
      .from('plays')
      .select('*, games(lower_score_wins, shared_score_positions), play_scores(*, players(*))', { count: 'exact' })
      .eq('user_id', userId)
      .order('played_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  )

  const sim = simulateAllPlays(plays as unknown as SimulationPlay[])
  const changedPositions = plays.flatMap(play => assignPositions(play.play_scores ?? [], {
    gameId: play.game_id, game: play.games,
    cooperative: play.is_cooperative ?? false, teamWon: play.team_won,
  }).filter(score => score.position !== play.play_scores?.find(s => s.id === score.id)?.position)
    .map(score => ({ id: score.id, position: score.position })))
  for (const batch of chunk(changedPositions, BATCH_SIZE)) {
    const { error } = await supabase.rpc('update_play_positions', { p_positions: batch })
    if (error) throw new Error(`[performFullRecalc] Aggiornamento posizioni fallito: ${error.message}`)
  }
  // Una partita senza game_id contribuisce all'ELO Generale (come nel vecchio
  // algoritmo) ma non deve generare righe per gioco: game_id non è un UUID
  const isValidGameId = (id: string): boolean => Boolean(id) && id !== 'null'
  const gameIds = Object.keys(sim.gamePlayers).filter(isValidGameId)

  // ── 2. player_ratings: azzera i giochi coinvolti e reinserisci ─────────────
  // La delete preventiva (come il vecchio ricalcolo per gioco) ripulisce anche
  // le righe residue di giocatori rimossi dalle partite di un gioco.
  for (const idChunk of chunk(gameIds, DELETE_ID_CHUNK)) {
    await withRetry(async () => {
      const { error: deleteError } = await supabase
        .from('player_ratings')
        .delete()
        .in('game_id', idChunk)
      if (deleteError) throw new Error(`[performFullRecalc] Delete player_ratings fallita: ${deleteError.message}`)
    }, { retries: WRITE_RETRIES })
  }

  const ratingRows: PlayerRatingRow[] = []
  for (const [gameId, players] of Object.entries(sim.gamePlayers)) {
    if (!isValidGameId(gameId)) continue
    for (const state of Object.values(players)) {
      ratingRows.push({
        player_id: state.playerId,
        game_id: gameId,
        rating: state.rating,
        games_played: state.gamesPlayed,
        wins: state.wins,
        losses: state.losses,
        draws: state.draws,
        last_played_at: state.lastPlayedAt
      })
    }
  }
  await insertInBatches(supabase, 'player_ratings', ratingRows as unknown as Record<string, unknown>[])

  // ── 3. player_general_ratings: upsert massivo ──────────────────────────────
  const generalRows: GeneralRatingRow[] = Object.values(sim.generalPlayers).map(general => ({
    player_id: general.playerId,
    user_id: userId,
    rating: general.rating,
    games_played: general.gamesPlayed,
    wins: general.wins,
    losses: general.losses,
    draws: general.draws,
    last_played_at: general.lastPlayedAt
  }))
  await upsertInBatches(
    supabase,
    'player_general_ratings',
    generalRows as unknown as Record<string, unknown>[],
    'player_id,user_id'
  )

  // ── 4. elo_history: rigenera l'intera cache dell'utente ────────────────────
  await withRetry(async () => {
    const { error: historyDeleteError } = await supabase
      .from('elo_history')
      .delete()
      .eq('user_id', userId)
    if (historyDeleteError) {
      throw new Error(`[performFullRecalc] Delete elo_history fallita: ${historyDeleteError.message}`)
    }
  }, { retries: WRITE_RETRIES })

  const historyRows: EloHistoryRow[] = [
    ...sim.gameHistory
      .filter(point => isValidGameId(point.gameId))
      .map(point => ({
      play_id: point.playId,
      game_id: point.gameId,
      player_id: point.playerId,
      player_name: point.playerName,
      rating: point.rating,
      rating_change: point.ratingChange,
      date: point.date,
      is_general: false,
      games_played: null,
      user_id: userId
    })),
    ...sim.generalHistory.map(point => ({
      play_id: point.playId,
      game_id: null,
      player_id: point.playerId,
      player_name: point.playerName,
      rating: point.rating,
      rating_change: point.ratingChange,
      date: point.date,
      is_general: true,
      games_played: point.gamesPlayed,
      user_id: userId
    }))
  ]
  await insertInBatches(supabase, 'elo_history', historyRows as unknown as Record<string, unknown>[])

  return {
    playsTotal: plays.length,
    playsProcessed: sim.processedPlays,
    playsSkipped: sim.skippedPlays,
    games: gameIds.length,
    players: Object.keys(sim.generalPlayers).length,
    historyEntries: historyRows.length,
    durationMs: Date.now() - startedAt
  }
}
