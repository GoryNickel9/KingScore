import { describe, expect, it } from 'vitest'
import { getEloPositions } from './eloRanking'
import { isVisibleInRankings } from './rankingVisibility'

describe('posizioni nella classifica ELO', () => {
  it.each([
    { ratings: [], positions: [] },
    { ratings: [1048], positions: [1] },
    { ratings: [1048, 1018, 1012], positions: [1, 2, 3] },
    { ratings: [1048, 1018, 1012, 958, 958], positions: [1, 2, 3, 4, 4] },
    { ratings: [1048, 1048, 1012, 958], positions: [1, 1, 3, 4] },
    { ratings: [1048, 1018, 1018, 1018, 958, 958, 900], positions: [1, 2, 2, 2, 5, 5, 7] },
    { ratings: [958, 958, 958], positions: [1, 1, 1] },
  ])('assegna $positions ai rating $ratings', ({ ratings, positions }) => {
    const rows = ratings.map(rating => ({ rating }))
    const original = structuredClone(rows)
    expect(getEloPositions(rows)).toEqual(positions)
    expect(rows).toEqual(original)
  })

  it('assegna le posizioni dopo il filtro dei giocatori nascosti', () => {
    const rows = [
      { name: 'Player 1', rating: 1100 },
      { name: 'Luca', rating: 1048 },
      { name: 'Il Fattone', rating: 958 },
      { name: 'Silvia', rating: 958 },
    ].filter(row => isVisibleInRankings(row.name))
    expect(getEloPositions(rows)).toEqual([1, 2, 2])
  })
})
