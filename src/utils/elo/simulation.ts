/**
 * Core puro di simulazione ELO — nessuna dipendenza esterna (né Supabase né
 * DOM; regole, posizioni ed esiti sono moduli puri).
 *
 * Fonte unica di verità dell'algoritmo ELO, riusata da:
 *  - frontend: src/utils/eloCalculator.ts (cache elo_history + percorsi di persistenza)
 *  - Edge Function notturna: supabase/functions/nightly-elo-recalc/
 *
 * Le regole persistenti scelgono l'ordine dei punteggi e gli spareggi.
 * In tutti i giochi competitivi un avversario pari vale mezzo punto ELO;
 * in V/P/S conta come pareggio soltanto il primo posto condiviso.
 *
 * Contratto: `simulateAllPlays` riceve le partite già ordinate
 * cronologicamente per `played_at` crescente (lo garantiscono le query
 * dei chiamanti) e non esegue alcuna operazione di I/O.
 */
import { assignPositions } from './positions.ts'
import type { GameRuleConfig } from './gameRules.ts'
import { getPlayerOutcome } from './outcomes.ts'

// ─── Formule ELO (spostate da eloCalculator.ts, invariate) ───────────────────

export interface PlayerInput {
  playerId: string
  currentRating: number
  gamesPlayed: number
  winner: boolean
  position?: number
  score?: number | null
  draw?: boolean
}

interface PlayerWithPosition extends PlayerInput {
  finalPosition: number
}

export interface EloResult {
  playerId: string
  oldRating: number
  newRating: number
  ratingChange: number
  expectedScore: string
  actualScore: string
  kFactor: number
}

/**
 * Calcola il risultato atteso per un giocatore contro altri giocatori (metodo classico)
 */
export function calculateExpectedScore(playerRating: number, opponentRatings: number[]): number {
  if (opponentRatings.length === 0) return 0.5

  const avgOpponentRating = opponentRatings.reduce((sum, r) => sum + r, 0) / opponentRatings.length
  const expectedScore = 1 / (1 + Math.pow(10, (avgOpponentRating - playerRating) / 400))

  return expectedScore
}

/**
 * Calcola il risultato atteso per un giocatore usando il metodo pairwise
 */
export function calculateExpectedScorePairwise(playerRating: number, opponentRatings: number[]): number {
  if (opponentRatings.length === 0) return 0.5

  const expectedScores = opponentRatings.map(opponentRating => {
    return 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400))
  })

  const avgExpectedScore = expectedScores.reduce((sum, score) => sum + score, 0) / expectedScores.length

  return avgExpectedScore
}

/**
 * Calcola il risultato reale basato sulla posizione finale nella partita
 */
export function calculateActualScore(playerPosition: number, totalPlayers: number, isWinner: boolean): number {
  if (isWinner) return 1

  if (playerPosition === totalPlayers) return 0

  const score = (totalPlayers - playerPosition) / (totalPlayers - 1)
  return Math.max(0, Math.min(1, score))
}

/**
 * Calcola il nuovo rating ELO per un giocatore
 */
export function calculateNewRating(currentRating: number, expectedScore: number, actualScore: number, kFactor: number = 32): number {
  const ratingChange = kFactor * (actualScore - expectedScore)
  const newRating = Math.round(currentRating + ratingChange)

  return newRating
}

/**
 * Calcola il fattore K basato sul numero di partite giocate
 */
export function calculateKFactor(gamesPlayed: number): number {
  if (gamesPlayed < 10) return 48
  if (gamesPlayed < 30) return 32
  return 24
}

/**
 * Calcola i nuovi rating ELO per tutti i giocatori in una partita
 *
 * Note:
 * - Per 2 giocatori: usa il metodo ELO classico
 * - Per 3+ giocatori: usa il metodo pairwise (all-pairs)
 */
export function calculateELOForGame(
  players: PlayerInput[],
  options: { pairwiseActualScore?: boolean; cooperativeResult?: boolean | null } = {}
): EloResult[] {
  if (players.length < 2) {
    throw new Error('Servono almeno 2 giocatori per calcolare il rating ELO')
  }

  const playersWithPositions: PlayerWithPosition[] = players.map((player, index) => ({
    ...player,
    finalPosition: player.position !== undefined ? player.position : index + 1
  }))

  const sortedPlayers = [...playersWithPositions].sort((a, b) => a.position! - b.position!)

  let currentPosition = 1
  sortedPlayers.forEach((player, index) => {
    if (index > 0 && sortedPlayers[index - 1].position !== player.position) {
      currentPosition = index + 1
    }
    player.finalPosition = currentPosition
  })

  const usePairwise = players.length >= 3

  const results: EloResult[] = sortedPlayers.map(player => {
    const opponentRatings = playersWithPositions
      .filter(p => p.playerId !== player.playerId)
      .map(p => p.currentRating)

    const expectedScore = usePairwise
      ? calculateExpectedScorePairwise(player.currentRating, opponentRatings)
      : calculateExpectedScore(player.currentRating, opponentRatings)

    // S_i = (avversari superati + 0.5 × avversari pari) / (N - 1).
    // Vale anche per i vincitori ex aequo. La modalità legacy serve al confronto storico.
    const actualScore = options.cooperativeResult != null ? (options.cooperativeResult ? 1 : 0)
      : options.pairwiseActualScore !== false
      ? playersWithPositions.reduce((sum, opponent) => {
        if (opponent.playerId === player.playerId) return sum
        return sum + (player.finalPosition < opponent.finalPosition ? 1
          : player.finalPosition === opponent.finalPosition ? 0.5 : 0)
      }, 0) / (players.length - 1)
      : calculateActualScore(player.finalPosition, players.length, player.winner)
    const kFactor = calculateKFactor(player.gamesPlayed)
    const newRating = calculateNewRating(player.currentRating, expectedScore, actualScore, kFactor)

    return {
      playerId: player.playerId,
      oldRating: player.currentRating,
      newRating,
      ratingChange: newRating - player.currentRating,
      expectedScore: expectedScore.toFixed(3),
      actualScore: actualScore.toFixed(3),
      kFactor
    }
  })

  return results
}

// ─── Simulazione completa dello storico ──────────────────────────────────────

export interface SimulationPlayScore {
  id?: string
  player_id: string
  winner: boolean | null
  position: number | null
  score: number | null
  draw?: boolean | null
  players?: { name: string | null; alias: string | null } | null
}

export interface SimulationPlay {
  id: string
  game_id: string
  played_at: string
  play_scores: SimulationPlayScore[] | null
  games?: Partial<GameRuleConfig> | null
  is_cooperative?: boolean | null
  team_won?: boolean | null
}

/** Stato finale di un giocatore in un gioco, con statistiche W/P/S. */
export interface GamePlayerState {
  playerId: string
  playerName: string
  rating: number
  gamesPlayed: number
  wins: number
  losses: number
  draws: number
  lastPlayedAt: string
}

/** Stato finale aggregato (ELO Generale) di un giocatore. */
export interface GeneralPlayerState {
  playerId: string
  rating: number
  gamesPlayed: number
  wins: number
  losses: number
  draws: number
  lastPlayedAt: string
}

/** Punto dello storico ELO di uno specifico gioco (is_general = false). */
export interface GameHistoryPoint {
  gameId: string
  playId: string
  playerId: string
  playerName: string
  rating: number
  ratingChange: number
  date: string
}

/** Punto dello storico ELO Generale (is_general = true). */
export interface GeneralHistoryPoint {
  playId: string
  playerId: string
  playerName: string
  rating: number
  ratingChange: number
  gamesPlayed: number
  date: string
}

export interface SimulationResult {
  /** game_id → player_id → stato finale del rating per quel gioco */
  gamePlayers: Record<string, Record<string, GamePlayerState>>
  /** Stato ELO Generale finale per ogni giocatore */
  generalPlayers: Record<string, GeneralPlayerState>
  /** Storico completo ELO per gioco, in ordine cronologico */
  gameHistory: GameHistoryPoint[]
  /** Storico completo ELO Generale, in ordine cronologico */
  generalHistory: GeneralHistoryPoint[]
  processedPlays: number
  skippedPlays: number
}

/**
 * Simula l'intero storico partite in un unico passaggio in memoria.
 *
 * Produce in un colpo solo tutto ciò che serve a frontend e job notturno:
 * rating finali per (gioco, giocatore), ELO Generali finali e storici
 * completi per la cache elo_history.
 *
 * L'ELO Generale (media ponderata: peso = partite giocate nel gioco) è
 * mantenuto con somme progressive per giocatore — aggiornate a ogni
 * variazione di rating — invece di riscansionare tutti i giochi a ogni
 * partita. I prodotti rating×partite sono interi esatti in float64,
 * quindi il risultato è identico al ricalcolo da zero (OP3).
 */
export function simulateAllPlays(plays: SimulationPlay[]): SimulationResult {
  const gamePlayers: Record<string, Record<string, GamePlayerState>> = {}
  const gameHistory: GameHistoryPoint[] = []
  const generalHistory: GeneralHistoryPoint[] = []

  // Somme progressive per la media ponderata dell'ELO Generale
  const weightedSums: Record<string, number> = {}
  const totalWeights: Record<string, number> = {}

  let processedPlays = 0
  let skippedPlays = 0

  for (const play of plays) {
    if (!play.play_scores || play.play_scores.length < 2) {
      skippedPlays++
      continue
    }

    processedPlays++
    const gameId = play.game_id
    if (!gamePlayers[gameId]) {
      gamePlayers[gameId] = {}
    }

    // Prepara i dati dei giocatori, inizializzando il rating a 1000 al primo incontro
    const playersData = play.play_scores.map((score) => {
      const playerId = score.player_id
      const playerName = score.players?.alias || score.players?.name || 'Unknown'

      if (!gamePlayers[gameId][playerId]) {
        gamePlayers[gameId][playerId] = {
          playerId,
          playerName,
          rating: 1000,
          gamesPlayed: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          lastPlayedAt: play.played_at
        }
      }

      return {
        playerId,
        playerName,
        currentRating: gamePlayers[gameId][playerId].rating,
        gamesPlayed: gamePlayers[gameId][playerId].gamesPlayed,
        winner: score.winner || false,
        position: score.position || undefined,
        score: score.score,
        draw: score.draw === true
      }
    })

    const positionedPlayers = assignPositions(playersData, {
      gameId, game: play.games,
      cooperative: play.is_cooperative ?? false, teamWon: play.team_won,
    })

    const eloResults = calculateELOForGame(positionedPlayers, {
      cooperativeResult: play.is_cooperative ? play.team_won : undefined,
    })
    const resultByPlayer = new Map(eloResults.map(result => [result.playerId, result]))

    // ── Aggiornamento rating per gioco + storico di gioco (ordine eloResults) ──
    for (const result of eloResults) {
      const state = gamePlayers[gameId][result.playerId]
      state.rating = result.newRating
      state.gamesPlayed++
      state.lastPlayedAt = play.played_at

      const playerData = playersData.find(p => p.playerId === result.playerId)
      const outcome = getPlayerOutcome(playerData, playersData, play)
      if (outcome === 'win') {
        state.wins++
      } else if (outcome === 'draw') {
        state.draws++
      } else {
        state.losses++
      }

      gameHistory.push({
        gameId,
        playId: play.id,
        playerId: result.playerId,
        playerName: playerData?.playerName || 'Unknown',
        rating: result.newRating,
        ratingChange: result.ratingChange,
        date: play.played_at
      })
    }

    // ── ELO Generale con somme progressive (ordine play_scores, come lo storico) ──
    for (const score of play.play_scores) {
      const playerId = score.player_id
      const result = resultByPlayer.get(playerId)
      if (!result) continue

      const state = gamePlayers[gameId][playerId]

      // "Prima": media ponderata con i rating pre-aggiornamento
      const weightBefore = totalWeights[playerId] ?? 0
      const sumBefore = weightedSums[playerId] ?? 0
      const before = weightBefore > 0 ? Math.round(sumBefore / weightBefore) : 1000

      // Aggiorna gli accumulatori: la voce di questo gioco passa da
      // (oldRating × g) a (newRating × (g+1))
      weightedSums[playerId] =
        sumBefore + result.newRating * (state.gamesPlayed) - result.oldRating * (state.gamesPlayed - 1)
      totalWeights[playerId] = weightBefore + 1

      // "Dopo": media ponderale aggiornata
      const after = Math.round(weightedSums[playerId] / totalWeights[playerId])

      generalHistory.push({
        playId: play.id,
        playerId,
        playerName: state.playerName,
        rating: after,
        ratingChange: after - before,
        gamesPlayed: totalWeights[playerId],
        date: play.played_at
      })
    }
  }

  // ── ELO Generale finale per giocatore: aggregato dagli stati per gioco ──
  const generalPlayers: Record<string, GeneralPlayerState> = {}
  for (const players of Object.values(gamePlayers)) {
    for (const state of Object.values(players)) {
      if (!generalPlayers[state.playerId]) {
        generalPlayers[state.playerId] = {
          playerId: state.playerId,
          rating: 0,
          gamesPlayed: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          lastPlayedAt: state.lastPlayedAt
        }
      }
      const general = generalPlayers[state.playerId]
      general.gamesPlayed += state.gamesPlayed
      general.wins += state.wins
      general.losses += state.losses
      general.draws += state.draws
      if (state.lastPlayedAt > general.lastPlayedAt) {
        general.lastPlayedAt = state.lastPlayedAt
      }
    }
  }
  for (const [playerId, general] of Object.entries(generalPlayers)) {
    // Identico a calculateGeneralELO: media ponderata sui rating per gioco
    general.rating = general.gamesPlayed > 0
      ? Math.round((weightedSums[playerId] ?? 0) / general.gamesPlayed)
      : 1000
  }

  return {
    gamePlayers,
    generalPlayers,
    gameHistory,
    generalHistory,
    processedPlays,
    skippedPlays
  }
}
