import { describe, expect, it } from 'vitest'
import { PILI_PILI_GAME_ID, getGameRankingRules } from './gameRules'
import { assignPositions } from './positions'
import { calculateELOForGame, simulateAllPlays } from './simulation'
import type { PlayerInput, SimulationPlay } from './simulation'

const gameId = PILI_PILI_GAME_ID

function players(scores: number[], winners: number[] = [0]): PlayerInput[] {
  return scores.map((score, index) => ({
    playerId: `p${index}`,
    score,
    winner: winners.includes(index),
    currentRating: 1000,
    gamesPlayed: 0,
  }))
}

function solve(input: PlayerInput[]) {
  return calculateELOForGame(assignPositions(input, { gameId }), { pairwiseActualScore: true })
}

describe('classifica Pili Pili', () => {
  it('regressione screenshot: 1, 6, 4 diventa Silvia, Ale, Luca', () => {
    const input = players([1, 6, 4]).map((p, index) => ({ ...p, position: index + 1 }))
    const result = assignPositions(input, { gameId })
    expect(result.map(p => [p.playerId, p.position, p.score])).toEqual([
      ['p0', 1, 1], ['p2', 2, 4], ['p1', 3, 6],
    ])
    expect(input.map(p => p.position)).toEqual([1, 2, 3])
  })

  it.each([
    { scores: [2, 6, 3, 3], winners: [0], positions: [1, 2, 2, 4] },
    { scores: [3, 6, 4, 4], winners: [0], positions: [1, 2, 2, 4] },
    { scores: [3, 3, 6], winners: [0, 1], positions: [1, 1, 3] },
    { scores: [6, 6, 6], winners: [0, 1, 2], positions: [1, 1, 1] },
    { scores: [1, 4, 6, 6], winners: [0], positions: [1, 2, 3, 3] },
  ])('condivide le posizioni: $scores → $positions', ({ scores, winners, positions }) => {
    expect(assignPositions(players(scores, winners), { gameId }).map(p => p.position)).toEqual(positions)
  })

  it('conserva zero e 7 senza conversioni o limiti aggiuntivi', () => {
    expect(assignPositions(players([0, 7, 6]), { gameId }).map(p => p.score)).toEqual([0, 6, 7])
  })

  it('mette i punteggi mancanti in fondo senza considerarli pari', () => {
    const result = assignPositions([
      { playerId: 'missing', score: null, winner: null },
      { playerId: 'winner', score: 0, winner: true },
      { playerId: 'other', score: 6, winner: false },
      { playerId: 'missing2', winner: false },
    ], { gameId })
    expect(result.map(p => [p.playerId, p.position])).toEqual([
      ['winner', 1], ['other', 2], ['missing', 3], ['missing2', 4],
    ])
  })

  it('a pari punteggio non dipende dall’ordine di inserimento', () => {
    const input = players([2, 6, 3, 3])
    const expected = Object.fromEntries(assignPositions(input, { gameId }).map(p => [p.playerId, p.position]))
    for (let i = 0; i < input.length; i++) {
      for (let j = 0; j < input.length; j++) {
        const permuted = [...input]
        ;[permuted[i], permuted[j]] = [permuted[j], permuted[i]]
        expect(Object.fromEntries(assignPositions(permuted, { gameId }).map(p => [p.playerId, p.position])))
          .toEqual(expected)
      }
    }
  })

  it('gli altri giochi ordinano per punteggio decrescente, con posizioni condivise', () => {
    expect(getGameRankingRules('altro')).toEqual(getGameRankingRules(null))
    expect(assignPositions(players([2, 6, 3, 3]), { gameId: 'altro' }).map(p => [p.score, p.position]))
      .toEqual([[2, 1], [6, 2], [3, 3], [3, 3]])
    expect(assignPositions(players([2, 6, 3]), { gameId, cooperative: true, teamWon: false })
      .map(p => p.position)).toEqual([2, 2, 2])
  })
})

describe('ELO Pili Pili', () => {
  it('lo screenshot assegna risultato 1, 0.5, 0 e rating 1024, 1000, 976', () => {
    expect(solve(players([1, 6, 4])).map(p => [p.playerId, p.actualScore, p.newRating])).toEqual([
      ['p0', '1.000', 1024], ['p2', '0.500', 1000], ['p1', '0.000', 976],
    ])
  })

  it.each([
    { scores: [2, 6, 3, 3], winners: [0], actual: ['1.000', '0.500', '0.500', '0.000'] },
    { scores: [3, 3, 6], winners: [0, 1], actual: ['0.750', '0.750', '0.000'] },
    { scores: [6, 6, 6], winners: [0, 1, 2], actual: ['0.500', '0.500', '0.500'] },
    { scores: [1, 4, 6, 6], winners: [0], actual: ['1.000', '0.667', '0.167', '0.167'] },
    { scores: [4, 4], winners: [0, 1], actual: ['0.500', '0.500'] },
  ])('mezzo punto contro ciascun avversario pari: $scores', ({ scores, winners, actual }) => {
    expect(solve(players(scores, winners)).map(p => p.actualScore)).toEqual(actual)
  })

  it('il pareggio totale a rating uguali non genera punti ELO', () => {
    expect(solve(players([6, 6, 6], [0, 1, 2])).map(p => p.ratingChange)).toEqual([0, 0, 0])
  })

  it('i pari hanno lo stesso risultato, ma delta dipendente dal rating iniziale', () => {
    const input = players([2, 3, 3, 6])
    input[1].currentRating = 1200
    input[2].currentRating = 800
    const result = solve(input)
    expect(result[1].actualScore).toBe('0.500')
    expect(result[2].actualScore).toBe('0.500')
    expect(result[1].ratingChange).toBeLessThan(result[2].ratingChange)
  })

  it('senza pareggi conserva formula, K e arrotondamento storici a posizioni uguali', () => {
    const positioned = assignPositions(players([1, 4, 6]), { gameId })
    expect(calculateELOForGame(positioned, { pairwiseActualScore: true }))
      .toEqual(calculateELOForGame(positioned))
  })

  it('simulazione completa: ignora posizioni obsolete, continua i rating e aggiorna il generale', () => {
    const play: SimulationPlay = {
      id: 'first', game_id: gameId, played_at: '2026-10-12',
      play_scores: players([1, 6, 4]).map((p, index) => ({
        player_id: p.playerId, winner: p.winner, score: p.score ?? null, position: index + 1,
      })),
    }
    const input = [play, { ...play, id: 'second', played_at: '2026-10-13' }]
    const snapshot = JSON.stringify(input)
    const sim = simulateAllPlays(input)
    expect(sim.gamePlayers[gameId].p0.rating).toBe(1046)
    expect(sim.gamePlayers[gameId].p2.rating).toBe(1000)
    expect(sim.gamePlayers[gameId].p1.rating).toBe(954)
    expect(sim.generalPlayers.p0.rating).toBe(1046)
    expect(sim.generalPlayers.p1.rating).toBe(954)
    expect(sim.gamePlayers[gameId].p0.gamesPlayed).toBe(2)
    expect(JSON.stringify(input)).toBe(snapshot)
    expect(simulateAllPlays(input)).toEqual(sim)
  })
})
