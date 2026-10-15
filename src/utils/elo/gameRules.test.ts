import { describe, expect, it } from 'vitest'
import { assignPositions } from './positions'
import { getPlayerOutcome } from './outcomes'
import { simulateAllPlays, calculateELOForGame } from './simulation'
import { getGameRankingRules, PILI_PILI_GAME_ID } from './gameRules'
import type { SimulationPlay } from './simulation'

describe('regole configurabili', () => {
  const scores = [1, 4, 4, 6].map((score, i) => ({ playerId: String(i), score, winner: i === 0 }))

  it('un nuovo gioco può vincere con il punteggio più basso senza ID speciale', () => {
    const result = assignPositions(scores, { gameId: 'nuovo', game: { lower_score_wins: true, shared_score_positions: true } })
    expect(result.map(p => [p.playerId, p.position])).toEqual([['0', 1], ['1', 2], ['2', 2], ['3', 4]])
  })

  it('le proprietà persistenti prevalgono sul fallback di Pili Pili', () => {
    expect(getGameRankingRules(PILI_PILI_GAME_ID, { lower_score_wins: false, shared_score_positions: false }))
      .toEqual({ lowerScoreWins: false, sharedScorePositions: false })
  })

  it('con punteggi incompleti conserva la classifica e i pareggi espliciti importati', () => {
    const scores = [
      { playerId: 'last', score: null, position: 4, winner: false },
      { playerId: 'tied', score: null, position: 2, winner: false },
      { playerId: 'winner', score: null, position: 1, winner: true },
      { playerId: 'tied2', score: null, position: 2, winner: false },
    ]
    expect(assignPositions(scores).map(p => [p.playerId, p.position]))
      .toEqual([['winner', 1], ['tied', 2], ['tied2', 2], ['last', 4]])
  })

  it('lo spareggio conserva l’ordine delle posizioni importate a pari punteggio', () => {
    const result = assignPositions(scores.map((p, i) => ({ ...p, position: [1, 4, 3, 2][i] })), {
      game: { lower_score_wins: false, shared_score_positions: false },
    })
    expect(result.map(p => [p.playerId, p.position])).toEqual([['0', 1], ['3', 2], ['2', 3], ['1', 4]])
  })

  it('il solver legge le regole persistenti: perdenti pari hanno lo stesso risultato ELO', () => {
    const play: SimulationPlay = { id: 'a', game_id: 'nuovo', played_at: '2026-10-15',
      games: { lower_score_wins: false, shared_score_positions: true },
      play_scores: [10, 5, 5, 1].map((score, i) => ({
        player_id: String(i), score, winner: i === 0, position: i + 1,
      })) }
    const result = simulateAllPlays([play])
    expect(result.gameHistory.map(p => p.rating)).toEqual([1024, 1000, 1000, 976])
    expect(result.gamePlayers.nuovo['1']).toMatchObject({ wins: 0, draws: 0, losses: 1 })
    expect(result.gamePlayers.nuovo['2']).toMatchObject({ wins: 0, draws: 0, losses: 1 })
    expect(simulateAllPlays([{ ...play, games: { lower_score_wins: false, shared_score_positions: false } }])
      .gameHistory.map(p => p.rating)).toEqual([1024, 1008, 992, 976])
  })
})

describe('esito V/P/S', () => {
  it('solo il primo posto condiviso è P; i perdenti pari restano S', () => {
    const scores = [{ winner: true }, { winner: true }, { winner: false }, { winner: false }]
    expect(scores.map(p => getPlayerOutcome(p, scores))).toEqual(['draw', 'draw', 'loss', 'loss'])
    expect(getPlayerOutcome({ winner: true }, [{ winner: true }, { winner: false }])).toBe('win')
  })

  it('il pareggio totale è P per tutti, anche senza punti differenti', () => {
    const scores = [{ winner: true }, { winner: true }, { winner: true }]
    expect(scores.map(p => getPlayerOutcome(p, scores))).toEqual(['draw', 'draw', 'draw'])
  })

  it.each([true, false])('i compagni di un cooperativo non sono avversari pari: team_won=%s', won => {
    const scores = [{ winner: won }, { winner: won }]
    const play = { is_cooperative: true, team_won: won }
    expect(scores.map(p => getPlayerOutcome(p, scores, play))).toEqual([won ? 'win' : 'loss', won ? 'win' : 'loss'])
    const results = calculateELOForGame(scores.map((p, i) => ({ ...p, playerId: String(i), position: won ? 1 : 2,
      currentRating: 1000, gamesPlayed: 0 })), { cooperativeResult: won })
    expect(results.map(r => r.actualScore)).toEqual([won ? '1.000' : '0.000', won ? '1.000' : '0.000'])
  })

  it('regressione screenshot: una vittoria condivisa incrementa P e non V', () => {
    const play: SimulationPlay = { id: 'a', game_id: PILI_PILI_GAME_ID, played_at: '2026-10-15',
      play_scores: [3, 3, 6].map((score, i) => ({ player_id: String(i), score, winner: i < 2, position: i + 1 })) }
    const result = simulateAllPlays([play])
    expect(result.gamePlayers[PILI_PILI_GAME_ID]['0']).toMatchObject({ gamesPlayed: 1, wins: 0, draws: 1, losses: 0 })
    expect(result.generalPlayers['0']).toMatchObject({ gamesPlayed: 1, wins: 0, draws: 1, losses: 0 })
    for (const player of Object.values(result.gamePlayers[PILI_PILI_GAME_ID])) {
      expect(player.wins + player.draws + player.losses).toBe(player.gamesPlayed)
    }
  })
})
