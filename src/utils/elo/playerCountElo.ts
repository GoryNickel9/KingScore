import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../types/db'
import { simulateAllPlays } from './simulation'
import type { SimulationPlay } from './simulation'
import { fetchAllPages } from '../pagination'

/**
 * Storici ELO filtrati per numero di giocatori della partita.
 *
 * Le pagine "Statistiche HU / 3 / 4 / 5+ Player" ripetono i calcoli di
 * eloCalculator.ts ma considerando SOLO le partite con il numero di giocatori
 * del bucket: l'ELO viene quindi simulato da zero sul sottoinsieme di partite,
 * indipendente dall'ELO generale mostrato in Statistiche.
 *
 * Nessuna lettura/scrittura su elo_history: la cache non ha la dimensione
 * "numero di giocatori" e scritture qui contaminerebbero le cache esistenti
 * (per-gioco e Generale) usate da Statistiche e dalla Edge Function notturna.
 */

export type PlayerCountBucket = 'hu' | '3-player' | '4-player' | '5-plus'

interface PlayerCountBucketDef {
  label: string
  description: string
  shortLabel: string
  eloLabel: string
  minPlayers: number
  maxPlayers: number | null  // null = nessun limite superiore
}

export const PLAYER_COUNT_BUCKETS: Record<PlayerCountBucket, PlayerCountBucketDef> = {
  'hu': {
    label: 'Statistiche HU',
    description: 'Solo partite a 2 giocatori (heads-up)',
    shortLabel: 'Statistiche HU',
    eloLabel: 'ELO HU',
    minPlayers: 2,
    maxPlayers: 2
  },
  '3-player': {
    label: 'Statistiche 3 Player',
    description: 'Solo partite a 3 giocatori',
    shortLabel: 'Statistiche 3P',
    eloLabel: 'ELO 3 Player',
    minPlayers: 3,
    maxPlayers: 3
  },
  '4-player': {
    label: 'Statistiche 4 Player',
    description: 'Solo partite a 4 giocatori',
    shortLabel: 'Statistiche 4P',
    eloLabel: 'ELO 4 Player',
    minPlayers: 4,
    maxPlayers: 4
  },
  '5-plus': {
    label: 'Statistiche 5+ Player',
    description: 'Solo partite con 5 o più giocatori',
    shortLabel: 'Statistiche 5+',
    eloLabel: 'ELO 5+ Player',
    minPlayers: 5,
    maxPlayers: null
  }
}

export const PLAYER_COUNT_BUCKET_ORDER: PlayerCountBucket[] = ['hu', '3-player', '4-player', '5-plus']

export function isPlayerCountBucket(value: string | undefined | null): value is PlayerCountBucket {
  return value !== undefined && value !== null && value in PLAYER_COUNT_BUCKETS
}

/** True se la partita (dato il numero di punteggi registrati) rientra nel bucket. */
export function matchesPlayerCount(scoreCount: number, bucket: PlayerCountBucket): boolean {
  const def = PLAYER_COUNT_BUCKETS[bucket]
  return scoreCount >= def.minPlayers && (def.maxPlayers === null || scoreCount <= def.maxPlayers)
}

interface HistoryEntryBase {
  playId: string
  playerId: string
  playerName: string
  rating: number
  ratingChange: number
  date: string
}

export interface GeneralELOHistoryByCountEntry extends HistoryEntryBase {
  gamesPlayed: number
}

/** Riga della classifica ELO Generale del bucket (equivalente di player_general_ratings, non persistita). */
export interface PlayerCountGeneralStanding {
  playerId: string
  playerName: string
  rating: number
  gamesPlayed: number
  wins: number
  losses: number
  draws: number
}

// Lettura paginata di tutte le partite, stesso select/ordine richiesto dal
// contratto di simulateAllPlays (played_at crescente).
async function fetchAllPlaysForSimulation(
  supabase: SupabaseClient<Database>,
  userId: string | null,
  gameId?: string
): Promise<SimulationPlay[]> {
  return fetchAllPages((from, to) => {
    let query = supabase
      .from('plays')
      .select(`
        *,
        play_scores(
          *,
          players(*)
        )
      `, { count: 'exact' })
      .order('played_at', { ascending: true })
      .order('id', { ascending: true })

    if (gameId) {
      query = query.eq('game_id', gameId)
    }
    if (userId) {
      query = query.eq('user_id', userId)
    }

    return query.range(from, to)
  }) as Promise<SimulationPlay[]>
}

export interface GeneralELODataByPlayerCount {
  history: GeneralELOHistoryByCountEntry[]
  standings: PlayerCountGeneralStanding[]
}

/**
 * Storico ELO Generale e classifica finale simulati usando solo le partite con
 * il numero di giocatori del bucket (nessuna cache: sempre ricalcolato).
 * Unica lettura+simulazione per alimentare sia il grafico sia la classifica.
 */
export async function getGeneralELODataByPlayerCount(
  supabase: SupabaseClient<Database>,
  userId: string | null = null,
  bucket: PlayerCountBucket
): Promise<GeneralELODataByPlayerCount> {
  const plays = await fetchAllPlaysForSimulation(supabase, userId)
  const filtered = plays.filter(play => matchesPlayerCount(play.play_scores?.length ?? 0, bucket))
  if (filtered.length === 0) return { history: [], standings: [] }

  const sim = simulateAllPlays(filtered)

  console.log(`[getGeneralELODataByPlayerCount] Bucket ${bucket}: ${plays.length} partite totali, ${filtered.length} nel bucket, ${sim.processedPlays} processate, ${sim.skippedPlays} saltate`)

  // Nome di riferimento per giocatore (alias || name, come nella simulazione)
  const nameByPlayer: Record<string, string> = {}
  for (const players of Object.values(sim.gamePlayers)) {
    for (const state of Object.values(players)) {
      if (!nameByPlayer[state.playerId]) {
        nameByPlayer[state.playerId] = state.playerName
      }
    }
  }

  const standings: PlayerCountGeneralStanding[] = Object.values(sim.generalPlayers)
    .map(general => ({
      playerId: general.playerId,
      playerName: nameByPlayer[general.playerId] ?? 'Unknown',
      rating: general.rating,
      gamesPlayed: general.gamesPlayed,
      wins: general.wins,
      losses: general.losses,
      draws: general.draws
    }))
    .sort((a, b) => b.rating - a.rating)

  return {
    history: sim.generalHistory.map(point => ({
      playId: point.playId,
      playerId: point.playerId,
      playerName: point.playerName,
      rating: point.rating,
      ratingChange: point.ratingChange,
      gamesPlayed: point.gamesPlayed,
      date: point.date
    })),
    standings
  }
}

/**
 * Storico ELO di un singolo gioco simulato usando solo le partite di quel
 * gioco con il numero di giocatori del bucket (nessuna cache).
 */
export async function getELOHistoryForGameByPlayerCount(
  supabase: SupabaseClient<Database>,
  gameId: string,
  userId: string | null = null,
  bucket: PlayerCountBucket
): Promise<HistoryEntryBase[]> {
  const plays = await fetchAllPlaysForSimulation(supabase, userId, gameId)
  const filtered = plays.filter(play => matchesPlayerCount(play.play_scores?.length ?? 0, bucket))
  if (filtered.length === 0) return []

  const sim = simulateAllPlays(filtered)

  return sim.gameHistory
    .filter(point => point.gameId === gameId)
    .map(point => ({
      playId: point.playId,
      playerId: point.playerId,
      playerName: point.playerName,
      rating: point.rating,
      ratingChange: point.ratingChange,
      date: point.date
    }))
}
