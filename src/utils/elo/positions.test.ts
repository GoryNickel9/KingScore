/**
 * Test di assignPositions — la fonte unica di verità dell'assegnazione
 * posizioni, condivisa tra salvataggio partite (AddPlay/EditPlay) e
 * ricalcolo ELO (simulation.ts).
 */
import { describe, it, expect } from 'vitest'
import { assignPositions } from './positions'
import { calculateELOForGame } from './simulation'
import type { PlayerInput } from './simulation'

describe('assignPositions', () => {
  it('competitivo: vincitori a posizione 1, non vincitori ordinati per punteggio', () => {
    const result = assignPositions([
      { playerId: 'a', winner: false, score: 30 },
      { playerId: 'b', winner: true, score: 10 },
      { playerId: 'c', winner: false, score: 50 },
      { playerId: 'd', winner: false, score: null },
    ])

    expect(result.map(p => [p.playerId, p.position])).toEqual([
      ['b', 1],
      ['c', 2],
      ['a', 3],
      ['d', 4],
    ])
  })

  it('pareggio multipli vincitori: tutti a posizione 1, poi posizioni distinte', () => {
    const result = assignPositions([
      { playerId: 'a', winner: true },
      { playerId: 'b', winner: false, score: 20 },
      { playerId: 'c', winner: true },
      { playerId: 'd', winner: false, score: 10 },
    ])

    expect(result.map(p => [p.playerId, p.position])).toEqual([
      ['a', 1],
      ['c', 1],
      ['b', 3],
      ['d', 4],
    ])
  })

  it('cooperativo vinto: tutti a posizione 1', () => {
    const result = assignPositions(
      [
        { playerId: 'a', winner: true, score: 42 },
        { playerId: 'b', winner: true, score: 42 },
      ],
      { cooperative: true, teamWon: true }
    )

    expect(result.every(p => p.position === 1)).toBe(true)
    expect(result.map(p => p.playerId)).toEqual(['a', 'b'])
  })

  it('cooperativo perso: tutti a posizione 2, nessuna classifica individuale', () => {
    const result = assignPositions(
      [
        { playerId: 'a', winner: false, score: 42 },
        { playerId: 'b', winner: false, score: 42 },
      ],
      { cooperative: true, teamWon: false }
    )

    expect(result.every(p => p.position === 2)).toBe(true)
  })

  it('punteggi mancanti in fondo, senza attribuire loro una parità', () => {
    const result = assignPositions([
      { playerId: 'a', winner: false, score: null },
      { playerId: 'b', winner: false, score: null },
      { playerId: 'c', winner: false, score: 5 },
    ])

    expect(result.map(p => p.playerId)).toEqual(['c', 'a', 'b'])
    expect(result.map(p => p.position)).toEqual([1, 2, 3])
  })

  it('è pura: non muta gli oggetti ricevuti', () => {
    const input = [{ playerId: 'a', winner: true }, { playerId: 'b', winner: false, score: 3 }]
    assignPositions(input)

    expect(input[0]).toEqual({ playerId: 'a', winner: true })
    expect(input[1]).toEqual({ playerId: 'b', winner: false, score: 3 })
  })

  it('coerenza col core ELO: le posizioni prodotte alimentano calculateELOForGame', () => {
    const players = [
      { playerId: 'a', currentRating: 1000, gamesPlayed: 0, winner: false, score: 30 },
      { playerId: 'b', currentRating: 1000, gamesPlayed: 0, winner: true, score: 10 },
      { playerId: 'c', currentRating: 1000, gamesPlayed: 0, winner: false, score: 50 },
    ] satisfies (PlayerInput & { score: number | null })[]

    const positioned = assignPositions(players)
    const results = calculateELOForGame(positioned)
    const byId = Object.fromEntries(results.map(r => [r.playerId, r]))

    // b vince (posizione 1), c secondo, a terzo: cambia il punteggio reale
    expect(byId.b.actualScore).toBe('1.000')
    expect(byId.c.actualScore).toBe('0.500')
    expect(byId.a.actualScore).toBe('0.000')
  })
})
