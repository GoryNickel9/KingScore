import { describe, expect, it } from 'vitest'
import { decodeEloRead, EloReadError } from './readModel'
import { ELO_ALGORITHM } from './algorithm'
import { buildEloPublication } from './publication'
import type { EloSourceSnapshot } from './publication'

const uuid = (n: number) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`
const owner = uuid(10)
const game = uuid(20)
const a = uuid(30)
const b = uuid(31)
const score = (player_id: string, winner: boolean, name = player_id) => ({ player_id, winner, position: null, score: null, players: { name, alias: null } })
function snapshot(count = 2): EloSourceSnapshot {
  return {
    scopeId: owner, sourceRevision: '9007199254740993',
    plays: Array.from({ length: count }, (_, n) => ({
      id: uuid(100 + n), game_id: game, played_at: '2026-10-15',
      play_scores: [score(a, n % 2 === 0), score(b, n % 2 === 1)],
    })),
  }
}
function current(input = snapshot(), scopeId = owner) {
  const publication = buildEloPublication(input, uuid(40))
  return { scopeId, algorithm: publication.algorithm, status: 'current', sourceRevision: input.sourceRevision,
    publishedRevision: input.sourceRevision, publicationId: publication.publicationId, result: publication.result }
}
function absent(status: 'missing' | 'stale') {
  return { scopeId: owner, status, sourceRevision: '9007199254740993', algorithm: status === 'missing' ? null : ELO_ALGORITHM,
    publishedRevision: status === 'missing' ? null : '9007199254740992', publicationId: status === 'missing' ? null : uuid(40), result: null }
}
function rejects(change: (wire: ReturnType<typeof current>) => void) {
  const wire = current()
  change(wire)
  expect(() => decodeEloRead(wire, owner)).toThrow(EloReadError)
}

describe('decodeEloRead complete publication snapshots', () => {
  it('decodes the exact worker result without numerical or ordering changes', () => {
    const wire = current()
    const read = decodeEloRead(wire, owner)
    expect(read).toEqual(wire)
    expect(read.status).toBe('current')
    if (read.status !== 'current') throw new Error('Expected current')
    expect(read.result.gamePlayers[game][a].rating).toBe(997)
    expect(read.result.gamePlayers[game][b].rating).toBe(1003)
    expect(read.result.gameHistory.map(point => point.playerId)).toEqual([a, b, b, a])
    expect(read.result.generalHistory.map(point => point.playerId)).toEqual([a, b, a, b])
    expect(read.sourceRevision).toBe('9007199254740993')
  })

  it('clones every wire reference and freezes root, arrays, maps and leaf states', () => {
    const wire = current()
    const read = decodeEloRead(wire, owner)
    if (read.status !== 'current') throw new Error('Expected current')
    expect(read.result).not.toBe(wire.result)
    expect(read.result.gamePlayers[game][a]).not.toBe(wire.result.gamePlayers[game][a])
    expect(read.result.gameHistory[0]).not.toBe(wire.result.gameHistory[0])
    expect(Object.isFrozen(read)).toBe(true)
    expect(Object.isFrozen(read.result)).toBe(true)
    expect(Object.isFrozen(read.result.gamePlayers)).toBe(true)
    expect(Object.isFrozen(read.result.gamePlayers[game])).toBe(true)
    expect(Object.isFrozen(read.result.gamePlayers[game][a])).toBe(true)
    expect(Object.isFrozen(read.result.gameHistory)).toBe(true)
    expect(Object.isFrozen(read.result.gameHistory[0])).toBe(true)
    expect(Reflect.set(read.result.gamePlayers[game][a], 'rating', 0)).toBe(false)
    wire.result.gamePlayers[game][a].rating = 0
    wire.result.gameHistory.splice(0)
    expect(read.result.gamePlayers[game][a].rating).toBe(997)
    expect(read.result.gameHistory).toHaveLength(4)
    expect(Object.isFrozen(wire)).toBe(false)
  })

  it('distinguishes an empty current publication from missing and stale results', () => {
    const empty = decodeEloRead(current(snapshot(0)), owner)
    expect(empty.status).toBe('current')
    expect(empty.result).toMatchObject({ gamePlayers: {}, generalPlayers: {}, gameHistory: [], generalHistory: [], processedPlays: 0, skippedPlays: 0 })
    expect(decodeEloRead(absent('missing'), owner)).toEqual(absent('missing'))
    expect(decodeEloRead(absent('stale'), owner)).toEqual(absent('stale'))
  })

  it('accepts only an explicitly requested global scope or the exact canonical owner', () => {
    expect(decodeEloRead(current(snapshot(), 'global'), 'global').scopeId).toBe('global')
    expect(() => decodeEloRead(current(), 'global')).toThrow(EloReadError)
    expect(() => decodeEloRead(current(snapshot(), 'global'), owner)).toThrow(EloReadError)
    expect(() => decodeEloRead(current(), uuid(11))).toThrow(EloReadError)
    expect(() => decodeEloRead(current(), 'GLOBAL')).toThrow(EloReadError)
  })

  it('keeps null game buckets and complete cross-game general history', () => {
    const input = snapshot(3)
    input.plays[0].game_id = null
    input.plays[1].game_id = uuid(21)
    const wire = current(input)
    const read = decodeEloRead(wire, owner)
    expect(read).toEqual(wire)
    if (read.status !== 'current') throw new Error('Expected current')
    expect(read.result.gameHistory[0].gameId).toBeNull()
    expect(read.result.gamePlayers.null[a].gamesPlayed).toBe(1)
    expect(read.result.generalPlayers[a].gamesPlayed).toBe(3)
  })

  it('retains the first game-player name while later game history may contain a renamed player', () => {
    const input = snapshot()
    input.plays[0].play_scores![0].players!.name = 'First name'
    input.plays[1].play_scores![0].players!.name = 'Changed name'
    const wire = current(input)
    expect(wire.result.gamePlayers[game][a].playerName).toBe('First name')
    expect(wire.result.gameHistory.find(point => point.playId === input.plays[1].id && point.playerId === a)?.playerName).toBe('Changed name')
    expect(decodeEloRead(wire, owner)).toEqual(wire)
  })

  it('accepts complete histories above the usual 1000-row response limit without truncation', () => {
    const wire = current(snapshot(1001))
    const read = decodeEloRead(wire, owner)
    expect(read).toEqual(wire)
    if (read.status !== 'current') throw new Error('Expected current')
    expect(read.result.processedPlays).toBe(1001)
    expect(read.result.gameHistory).toHaveLength(2002)
    expect(read.result.generalHistory).toHaveLength(2002)
    expect(read.result.generalPlayers[a].gamesPlayed).toBe(1001)
  })
})

describe('decodeEloRead boundary rejection', () => {
  it('rejects missing/extra envelope or result fields and non-JSON objects with a safe error', () => {
    rejects(wire => { Reflect.deleteProperty(wire, 'sourceRevision') })
    rejects(wire => { Reflect.set(wire, 'unexpected', 'secret') })
    rejects(wire => { Reflect.deleteProperty(wire.result, 'generalHistory') })
    rejects(wire => { Reflect.set(wire.result, 'extra', 1) })
    expect(() => decodeEloRead(new Map(), owner)).toThrow('Invalid ELO read response')
    expect(() => decodeEloRead({ secret: 'credential' }, owner)).toThrow('Invalid ELO read response')
    expect(() => decodeEloRead(() => 1, owner)).toThrow(EloReadError)
  })

  it.each(['01', '-1', '1.0', '1e3', '9223372036854775808', '9999999999999999999999'])('rejects invalid revisions %s', revision => {
    rejects(wire => { wire.sourceRevision = revision })
    rejects(wire => { wire.publishedRevision = revision })
  })

  it('rejects numeric revisions, a future publication, stale-current mismatch and unknown algorithms', () => {
    rejects(wire => { Reflect.set(wire, 'sourceRevision', 9007199254740993) })
    rejects(wire => { wire.publishedRevision = '9007199254740994' })
    rejects(wire => { wire.publishedRevision = '9007199254740992' })
    rejects(wire => { Reflect.set(wire, 'algorithm', 'future-elo-v2') })
    rejects(wire => { wire.status = 'unknown' })
    rejects(wire => { wire.publicationId = 'not-a-uuid' })
  })

  it('never exposes a stale payload and requires missing publication metadata to be null', () => {
    expect(() => decodeEloRead({ ...absent('stale'), result: current().result }, owner)).toThrow(EloReadError)
    expect(() => decodeEloRead({ ...absent('stale'), publishedRevision: '9007199254740993' }, owner)).toThrow(EloReadError)
    expect(() => decodeEloRead({ ...absent('stale'), publishedRevision: '9007199254740994' }, owner)).toThrow(EloReadError)
    for (const key of ['algorithm', 'publicationId', 'publishedRevision', 'result']) {
      expect(() => decodeEloRead({ ...absent('missing'), [key]: current()[key as keyof ReturnType<typeof current>] }, owner)).toThrow(EloReadError)
    }
  })

  it('rejects malformed IDs, dates, partial states and extra row metadata', () => {
    rejects(wire => { wire.result.gameHistory[0].playerId = 'constructor' })
    rejects(wire => { wire.result.generalHistory[0].date = '2026-02-30' })
    rejects(wire => { wire.result.gamePlayers[game][a].lastPlayedAt = '2026-10-15T00:00:00Z' })
    rejects(wire => { Reflect.deleteProperty(wire.result.gamePlayers[game][a], 'wins') })
    rejects(wire => { Reflect.set(wire.result.generalHistory[0], 'extra', true) })
    rejects(wire => { Object.defineProperty(wire.result.gamePlayers, '__proto__', { value: {}, enumerable: true }) })
  })

  it.each([NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe/non-integer numeric output %s', value => {
    rejects(wire => { wire.result.gameHistory[0].rating = value })
    rejects(wire => { wire.result.gameHistory[0].ratingChange = value })
    rejects(wire => { wire.result.generalPlayers[a].gamesPlayed = value })
  })

  it('rejects negative counts and inconsistent W/L/D or source play counts', () => {
    rejects(wire => { wire.result.skippedPlays = -1 })
    rejects(wire => { wire.result.processedPlays++ })
    rejects(wire => { wire.result.gamePlayers[game][a].wins++ })
    rejects(wire => { wire.result.generalPlayers[a].draws++ })
  })

  it('rejects duplicate/missing history pairs and inconsistent game, player or date membership', () => {
    rejects(wire => { wire.result.gameHistory.push(structuredClone(wire.result.gameHistory[0])) })
    rejects(wire => { wire.result.generalHistory.push(structuredClone(wire.result.generalHistory[0])) })
    rejects(wire => { wire.result.generalHistory.pop() })
    rejects(wire => { wire.result.gameHistory.pop() })
    rejects(wire => { wire.result.gameHistory[1].gameId = uuid(21) })
    rejects(wire => { wire.result.generalHistory[1].playerId = uuid(32) })
    rejects(wire => { wire.result.generalHistory[1].date = '2026-10-14' })
  })

  it('rejects incorrect final states, general aggregates and history progression', () => {
    rejects(wire => { wire.result.gamePlayers[game][a].rating++ })
    rejects(wire => { wire.result.gamePlayers[game][a].lastPlayedAt = '2026-10-14' })
    rejects(wire => { wire.result.gamePlayers[game][a].playerName = 'not first name' })
    rejects(wire => { wire.result.generalPlayers[a].rating++ })
    rejects(wire => { wire.result.generalHistory[2].gamesPlayed = 1 })
    rejects(wire => { wire.result.generalHistory[2].ratingChange++ })
    rejects(wire => { wire.result.gameHistory[2].ratingChange++ })
    rejects(wire => { wire.result.generalHistory[2].playerName = 'wrong game name' })
    rejects(wire => { delete wire.result.generalPlayers[a] })
  })

  it('rejects single-player processed matches, unexpected empty buckets and reordered play histories', () => {
    const single = current(snapshot(1))
    single.result.gameHistory.pop()
    single.result.generalHistory.pop()
    delete single.result.gamePlayers[game][b]
    delete single.result.generalPlayers[b]
    expect(() => decodeEloRead(single, owner)).toThrow(EloReadError)
    rejects(wire => { wire.result.gamePlayers[uuid(21)] = {} })
    rejects(wire => { wire.result.gameHistory.reverse() })
    rejects(wire => { wire.result.generalHistory.reverse() })
  })
})
