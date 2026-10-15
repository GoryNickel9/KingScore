import { describe, expect, it } from 'vitest'
import { buildEloPublication } from './publication'
import { decodeEloRead } from './readModel'
import { gameHistory, gameStandings, generalHistory, generalStandings } from './projections'

const id = (n: number) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`
const game = id(1), otherGame = id(2), a = id(3), b = id(4)
const play = (n: number, game_id: string | null = game) => ({
  id: id(n + 10), game_id, played_at: '2026-10-15',
  play_scores: [b, a].map(player_id => ({ player_id, score: null, winner: true, position: null,
    players: { name: player_id === a ? 'Anna' : 'Bruno', alias: null } })),
})
function current(plays = [play(1), play(2, otherGame)]) {
  const publication = buildEloPublication({ scopeId: 'global', sourceRevision: '9007199254740993', plays }, id(99))
  return decodeEloRead({ ...publication, status: 'current', publishedRevision: publication.sourceRevision }, 'global')
}

describe('ELO generation projections', () => {
  it('shares exact global identity across every view without merging owner ratings', () => {
    const read = current()
    for (const view of [generalStandings(read), gameStandings(read, game), generalHistory(read), gameHistory(read, game)]) {
      expect(view).toMatchObject({ scopeId: 'global', status: 'current', publicationId: id(99), sourceRevision: '9007199254740993', publishedRevision: '9007199254740993' })
      expect(view).not.toHaveProperty('result')
    }
  })
  it('orders tied ratings by player ID without changing the published participant order', () => {
    const read = current([play(1)])
    expect(gameStandings(read, game).data?.map(row => row.playerId)).toEqual([a, b])
    expect(generalStandings(read).data?.map(row => row.playerId)).toEqual([a, b])
    expect(gameHistory(read, game).data?.map(row => row.playerId)).toEqual([b, a])
  })
  it('keeps all game and general histories in published order when filtering a player', () => {
    const read = current()
    expect(generalHistory(read, a).data?.map(row => row.playId)).toEqual([id(11), id(12)])
    expect(gameHistory(read, otherGame, b).data?.map(row => row.playId)).toEqual([id(12)])
    expect(generalHistory(read, id(90)).data).toEqual([])
  })
  it('uses names from the same publication without a separate live catalog join', () => {
    expect(generalStandings(current()).data?.find(row => row.playerId === a)?.playerName).toBe('Anna')
  })
  it.each(['missing', 'stale'] as const)('does not present %s as empty or trigger a calculation', status => {
    const read = decodeEloRead({ scopeId: 'global', status, sourceRevision: '3',
      algorithm: status === 'missing' ? null : 'kingscore-elo-rules-v2',
      publishedRevision: status === 'missing' ? null : '2', publicationId: status === 'missing' ? null : id(99), result: null }, 'global')
    for (const view of [generalStandings(read), gameStandings(read, game), generalHistory(read), gameHistory(read, game)]) {
      expect(view.status).toBe(status)
      expect(view.data).toBeNull()
    }
  })
  it('distinguishes a valid empty publication and an absent game from missing results', () => {
    expect(generalStandings(current([]))).toMatchObject({ status: 'current', data: [] })
    expect(gameStandings(current(), id(90))).toMatchObject({ status: 'current', data: [] })
  })
  it('retains null-game contributions in the general view without inventing a selectable game', () => {
    const read = current([play(1, null)])
    expect(generalStandings(read).data).toHaveLength(2)
    expect(gameStandings(read, game).data).toEqual([])
    expect(() => gameStandings(read, 'null')).toThrow('Invalid ELO game filter')
  })
  it('returns frozen arrays and rows and leaves the decoded publication unchanged', () => {
    const read = current()
    const before = structuredClone(read)
    const view = generalStandings(read)
    expect(Object.isFrozen(view)).toBe(true)
    expect(Object.isFrozen(view.data)).toBe(true)
    expect(Object.isFrozen(view.data![0])).toBe(true)
    expect(read).toEqual(before)
  })
  it('keeps the complete published history beyond the legacy default page size', () => {
    expect(generalHistory(current(Array.from({ length: 1001 }, (_, n) => play(n)))).data).toHaveLength(2002)
  })
})
