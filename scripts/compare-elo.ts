/**
 * Golden test di parità ELO — docs/ottimizzazione-calcolo-elo-generale.md §7
 *
 * Confronta, sugli stessi dati reali del database, l'algoritmo storico
 * (snapshot fedele di eloCalculator.ts PRIMA del refactor: riscansione di
 * tutti i giochi per ogni partita) con il nuovo core puro
 * (src/utils/elo/simulation.ts: somme progressive).
 *
 * Esecuzione:  npm run compare:elo
 * Esce con codice 1 in caso di qualsiasi divergenza, 2 in caso di errore
 * di accesso ai dati.
 */
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { calculateELOForGame, simulateAllPlays } from '../src/utils/elo/simulation'
import type { SimulationPlay } from '../src/utils/elo/simulation'
import { getGameRankingRules } from '../src/utils/elo/gameRules'
import { fetchAllPages } from '../src/utils/pagination'

config({ path: '.env.local' })

// ─── Implementazione VECCHIA (snapshot pre-refactor: NON MODIFICARE) ─────────

interface OldPlayerInput {
  playerId: string
  playerName: string
  currentRating: number
  gamesPlayed: number
  winner: boolean
  position?: number
  score?: number | null
}

interface OldGameRating {
  playerId: string
  playerName: string
  currentRating: number
  gamesPlayed: number
}

interface OldHistoryEntry {
  date: string
  playId: string
  playerId: string
  playerName: string
  rating: number
  ratingChange: number
}

interface OldGeneralEntry extends OldHistoryEntry {
  gamesPlayed: number
}

/** Copia fedele del loop di getELOHistoryForGame pre-refactor. */
function oldGameHistory(plays: SimulationPlay[]): OldHistoryEntry[] {
  const playerRatings: Record<string, OldGameRating> = {}
  const eloHistory: OldHistoryEntry[] = []

  for (const play of plays) {
    if (!play.play_scores || play.play_scores.length < 2) continue

    const playersData: OldPlayerInput[] = play.play_scores.map((score) => {
      if (!playerRatings[score.player_id]) {
        playerRatings[score.player_id] = {
          playerId: score.player_id,
          playerName: score.players?.alias || score.players?.name || 'Unknown',
          currentRating: 1000,
          gamesPlayed: 0
        }
      }

      return {
        playerId: score.player_id,
        playerName: score.players?.alias || score.players?.name || 'Unknown',
        currentRating: playerRatings[score.player_id].currentRating,
        gamesPlayed: playerRatings[score.player_id].gamesPlayed,
        winner: score.winner || false,
        position: score.position || undefined,
        score: score.score
      }
    })

    const sortedPlayers = [...playersData].sort((a, b) => {
      if (a.winner && !b.winner) return -1
      if (!a.winner && b.winner) return 1
      if (a.score !== null && b.score !== null) {
        return (b.score ?? 0) - (a.score ?? 0)
      }
      return 0
    })

    let currentPosition = 1
    const winnersCount = sortedPlayers.filter(p => p.winner).length
    sortedPlayers.forEach((player, index) => {
      if (player.winner) {
        player.position = 1
      } else if (index === winnersCount) {
        currentPosition = winnersCount + 1
        player.position = currentPosition
      } else if (!player.winner) {
        currentPosition++
        player.position = currentPosition
      }
    })

    const eloResults = calculateELOForGame(playersData, { pairwiseActualScore: false })

    eloResults.forEach((result) => {
      if (playerRatings[result.playerId]) {
        playerRatings[result.playerId].currentRating = result.newRating
        playerRatings[result.playerId].gamesPlayed++
      }

      const playerData = playersData.find(p => p.playerId === result.playerId)
      eloHistory.push({
        date: play.played_at,
        playId: play.id,
        playerId: result.playerId,
        playerName: playerData?.playerName || 'Unknown',
        rating: result.newRating,
        ratingChange: result.ratingChange
      })
    })
  }

  return eloHistory
}

/** Copia fedele del loop di getGeneralELOHistory pre-refactor (doppia riscansione). */
function oldGeneralHistory(plays: SimulationPlay[]): {
  history: OldGeneralEntry[]
  playerGameRatings: Record<string, Record<string, OldGameRating>>
} {
  const playerGameRatings: Record<string, Record<string, OldGameRating>> = {}
  const generalELOHistory: OldGeneralEntry[] = []

  for (const play of plays) {
    if (!play.play_scores || play.play_scores.length < 2) continue

    const gameId = play.game_id
    if (!playerGameRatings[gameId]) {
      playerGameRatings[gameId] = {}
    }

    const playersData: OldPlayerInput[] = play.play_scores.map((score) => {
      const playerId = score.player_id
      const playerName = score.players?.alias || score.players?.name || 'Unknown'

      if (!playerGameRatings[gameId][playerId]) {
        playerGameRatings[gameId][playerId] = {
          playerId,
          playerName,
          currentRating: 1000,
          gamesPlayed: 0
        }
      }

      return {
        playerId,
        playerName,
        currentRating: playerGameRatings[gameId][playerId].currentRating,
        gamesPlayed: playerGameRatings[gameId][playerId].gamesPlayed,
        winner: score.winner || false,
        position: score.position || undefined,
        score: score.score
      }
    })

    const sortedPlayers = [...playersData].sort((a, b) => {
      if (a.winner && !b.winner) return -1
      if (!a.winner && b.winner) return 1
      if (a.score !== null && b.score !== null) {
        return (b.score ?? 0) - (a.score ?? 0)
      }
      return 0
    })

    let currentPosition = 1
    const winnersCount = sortedPlayers.filter(p => p.winner).length
    sortedPlayers.forEach((player, index) => {
      if (player.winner) {
        player.position = 1
      } else if (index === winnersCount) {
        currentPosition = winnersCount + 1
        player.position = currentPosition
      } else if (!player.winner) {
        currentPosition++
        player.position = currentPosition
      }
    })

    const eloResults = calculateELOForGame(playersData, { pairwiseActualScore: false })

    const playersInPlay: string[] = play.play_scores.map((score) => score.player_id)
    const previousGeneralRatings: Record<string, number> = {}

    for (const playerId of playersInPlay) {
      let totalWeightedRating = 0
      let totalWeight = 0

      for (const gId in playerGameRatings) {
        if (playerGameRatings[gId][playerId]) {
          const gameRating = playerGameRatings[gId][playerId]
          const weight: number = gameRating.gamesPlayed
          totalWeightedRating += gameRating.currentRating * weight
          totalWeight += weight
        }
      }

      previousGeneralRatings[playerId] = totalWeight > 0 ? Math.round(totalWeightedRating / totalWeight) : 1000
    }

    eloResults.forEach((result) => {
      if (playerGameRatings[gameId][result.playerId]) {
        playerGameRatings[gameId][result.playerId].currentRating = result.newRating
        playerGameRatings[gameId][result.playerId].gamesPlayed++
      }
    })

    for (const playerId of playersInPlay) {
      let totalWeightedRating = 0
      let totalWeight = 0
      let totalGamesPlayed = 0

      for (const gId in playerGameRatings) {
        if (playerGameRatings[gId][playerId]) {
          const gameRating = playerGameRatings[gId][playerId]
          const weight: number = gameRating.gamesPlayed
          totalWeightedRating += gameRating.currentRating * weight
          totalWeight += weight
          totalGamesPlayed += gameRating.gamesPlayed
        }
      }

      const generalRating = totalWeight > 0 ? Math.round(totalWeightedRating / totalWeight) : 1000
      const ratingChange = generalRating - previousGeneralRatings[playerId]

      let playerName = 'Unknown'
      for (const gId in playerGameRatings) {
        if (playerGameRatings[gId][playerId]) {
          playerName = playerGameRatings[gId][playerId].playerName
          break
        }
      }

      generalELOHistory.push({
        date: play.played_at,
        playId: play.id,
        playerId,
        playerName,
        rating: generalRating,
        ratingChange,
        gamesPlayed: totalGamesPlayed
      })
    }
  }

  return { history: generalELOHistory, playerGameRatings }
}

// ─── Confronto ────────────────────────────────────────────────────────────────

function diffEntry(old: OldHistoryEntry, neu: OldHistoryEntry): string {
  const fields: (keyof OldHistoryEntry)[] = ['date', 'playId', 'playerId', 'playerName', 'rating', 'ratingChange']
  return fields.filter(f => old[f] !== neu[f]).join(', ')
}

async function main(): Promise<void> {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) {
    console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY mancanti in .env.local')
    process.exit(2)
  }

  const supabase = createClient(url, key)
  const data = await fetchAllPages((from, to) => supabase
    .from('plays')
    .select('*, games(lower_score_wins,shared_score_positions), play_scores(*, players(*))', { count: 'exact' })
    .order('played_at', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to))

  // La parità legacy riguarda solo giochi senza pareggi o punteggi mancanti:
  // gli altri storici cambiano intenzionalmente con le nuove regole.
  const allPlays = data as unknown as SimulationPlay[]
  const changedGames = new Set(allPlays.filter(play => {
    const scores = play.play_scores ?? []
    const values = scores.filter(s => !s.winner).map(s => s.score)
    return getGameRankingRules(play.game_id, play.games).lowerScoreWins || play.is_cooperative ||
      scores.filter(s => s.winner).length > 1 || scores.some(s => s.score == null) || new Set(values).size !== values.length
  }).map(play => play.game_id))
  const plays = allPlays.filter(play => !changedGames.has(play.game_id))
  console.log(`Partite lette: ${allPlays.length}; confronto legacy senza correzioni: ${plays.length}; escluse: ${allPlays.length - plays.length}`)
  if (plays.length === 0) {
    console.log('Nessuno storico invariato disponibile per il confronto legacy; usare i test delle nuove regole.')
    return
  }

  let mismatches = 0
  const reportDiff = (context: string, detail: string) => {
    mismatches++
    if (mismatches <= 10) console.error(`❌ [${context}] ${detail}`)
  }

  // ── Vecchio algoritmo (riscansioni) ──
  const tOldGeneral0 = performance.now()
  const oldGeneral = oldGeneralHistory(plays)
  const oldGeneralMs = performance.now() - tOldGeneral0

  const playsByGame = new Map<string, SimulationPlay[]>()
  for (const play of plays) {
    if (!play.game_id) continue
    const list = playsByGame.get(play.game_id) ?? []
    list.push(play)
    playsByGame.set(play.game_id, list)
  }

  let oldGameMs = 0
  const oldGameByGame = new Map<string, OldHistoryEntry[]>()
  for (const [gameId, gamePlays] of playsByGame) {
    const t = performance.now()
    oldGameByGame.set(gameId, oldGameHistory(gamePlays))
    oldGameMs += performance.now() - t
  }

  // ── Nuovo core (single pass, somme progressive) ──
  const tNew0 = performance.now()
  const sim = simulateAllPlays(plays)
  const newMs = performance.now() - tNew0

  // ── 1. Storico per gioco ──
  const newGameByGame = new Map<string, typeof sim.gameHistory>()
  for (const point of sim.gameHistory) {
    const list = newGameByGame.get(point.gameId) ?? []
    list.push(point)
    newGameByGame.set(point.gameId, list)
  }

  for (const [gameId, oldEntries] of oldGameByGame) {
    const newEntries = newGameByGame.get(gameId) ?? []
    if (oldEntries.length !== newEntries.length) {
      reportDiff(`gioco ${gameId}`, `lunghezza storico diversa: old=${oldEntries.length} new=${newEntries.length}`)
      continue
    }
    for (let i = 0; i < oldEntries.length; i++) {
      const fields = diffEntry(oldEntries[i], newEntries[i] as unknown as OldHistoryEntry)
      if (fields) {
        reportDiff(`gioco ${gameId}`, `entry ${i} diverge su [${fields}]: old=${JSON.stringify(oldEntries[i])} new=${JSON.stringify(newEntries[i])}`)
      }
    }
  }

  // ── 2. Storico generale ──
  const oldGeneralHistoryArr = oldGeneral.history
  if (oldGeneralHistoryArr.length !== sim.generalHistory.length) {
    reportDiff('generale', `lunghezza storico diversa: old=${oldGeneralHistoryArr.length} new=${sim.generalHistory.length}`)
  } else {
    for (let i = 0; i < oldGeneralHistoryArr.length; i++) {
      const o = oldGeneralHistoryArr[i]
      const n = sim.generalHistory[i]
      const fields = diffEntry(o, n as unknown as OldHistoryEntry)
      if (fields || o.gamesPlayed !== n.gamesPlayed) {
        reportDiff('generale', `entry ${i} diverge: old=${JSON.stringify(o)} new=${JSON.stringify(n)}`)
      }
    }
  }

  // ── 3. Rating finali per (gioco, giocatore) ──
  for (const [gameId, oldPlayers] of Object.entries(oldGeneral.playerGameRatings)) {
    const newPlayers = sim.gamePlayers[gameId] ?? {}
    for (const [playerId, oldState] of Object.entries(oldPlayers)) {
      const newState = newPlayers[playerId]
      if (!newState) {
        reportDiff(`gioco ${gameId}`, `giocatore ${playerId} assente nel nuovo core`)
        continue
      }
      if (oldState.currentRating !== newState.rating || oldState.gamesPlayed !== newState.gamesPlayed) {
        reportDiff(`gioco ${gameId}`, `rating finale ${playerId}: old=${oldState.currentRating}/${oldState.gamesPlayed} new=${newState.rating}/${newState.gamesPlayed}`)
      }
    }
  }

  // ── 4. ELO Generale finale per giocatore (ciò che finisce in player_general_ratings) ──
  // Ricompone la media ponderata finale come il vecchio calculateGeneralELO
  const oldFinalByPlayer: Record<string, { weighted: number; weight: number }> = {}
  for (const playersOfGame of Object.values(oldGeneral.playerGameRatings)) {
    for (const [pid, state] of Object.entries(playersOfGame)) {
      if (!oldFinalByPlayer[pid]) oldFinalByPlayer[pid] = { weighted: 0, weight: 0 }
      oldFinalByPlayer[pid].weighted += state.currentRating * state.gamesPlayed
      oldFinalByPlayer[pid].weight += state.gamesPlayed
    }
  }
  for (const [playerId, final] of Object.entries(oldFinalByPlayer)) {
    const oldRating = final.weight > 0 ? Math.round(final.weighted / final.weight) : 1000
    // W/S dal conteggio per partita (come il vecchio updateELOAfterGame)
    let wins = 0
    let losses = 0
    for (const play of plays) {
      const mine = play.play_scores?.find(s => s.player_id === playerId)
      if (mine && mine.winner) wins++
      else if (mine) losses++
    }
    const newState = sim.generalPlayers[playerId]
    if (!newState) {
      reportDiff('generale-finale', `giocatore ${playerId} assente nel nuovo core`)
      continue
    }
    if (oldRating !== newState.rating || final.weight !== newState.gamesPlayed || wins !== newState.wins || losses !== newState.losses) {
      reportDiff('generale-finale', `giocatore ${playerId}: old(rating=${oldRating}, games=${final.weight}, W=${wins}, S=${losses}) new(rating=${newState.rating}, games=${newState.gamesPlayed}, W=${newState.wins}, S=${newState.losses})`)
    }
  }

  // ── Report ──
  console.log('')
  console.log('── Tempi di calcolo (solo simulazione, zero I/O) ──')
  console.log(`  vecchio: storico generale ${oldGeneralMs.toFixed(1)} ms + storici per gioco ${oldGameMs.toFixed(1)} ms`)
  console.log(`  nuovo:   tutto in un passaggio ${newMs.toFixed(1)} ms`)
  console.log(`  partite processate: ${sim.processedPlays}, saltate: ${sim.skippedPlays}, giochi: ${playsByGame.size}`)
  console.log('')

  if (mismatches > 0) {
    console.error(`❌ PARITÀ VIOLATA: ${mismatches} divergenze (mostrate max 10)`)
    process.exit(1)
  }

  console.log('✅ PARITÀ VERIFICATA: storici per gioco, storico generale e rating finali identici al vecchio algoritmo')
}

main().catch((error) => {
  console.error('Errore imprevisto:', error)
  process.exit(2)
})
