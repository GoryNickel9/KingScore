import { describe, expect, it } from 'vitest'
import { buildEloPublication, ELO_ALGORITHM } from './publication'
import type { EloSourceSnapshot } from './publication'
import { calculateKFactor, simulateAllPlays } from './simulation'
import type { SimulationPlay, SimulationPlayScore } from './simulation'

const uuid = (n: number) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`
const owner = uuid(1000)
const game = uuid(2000)
const publicationId = uuid(3000)
const a = uuid(4000)
const b = uuid(4001)
const c = uuid(4002)
const score = (player_id: string, winner = false, points: number | null = null): SimulationPlayScore => ({
  player_id, winner, score: points, position: null,
})
const play = (n: number, scores = [score(a, true), score(b)]): EloSourceSnapshot['plays'][number] => ({
  id: uuid(n), game_id: game, played_at: '2026-01-01', play_scores: scores,
})
const snapshot = (plays = [play(1)]): EloSourceSnapshot => ({ scopeId: owner, sourceRevision: '7', plays })
const build = (value = snapshot()) => buildEloPublication(value, publicationId)
const legacy = (value: EloSourceSnapshot) => simulateAllPlays(value.plays as SimulationPlay[])

describe('buildEloPublication legacy computation envelope', () => {
  it('keeps the historical owner, exact bigint revision and algorithm identity', () => {
    const input = { ...snapshot(), sourceRevision: '9007199254740993' }
    expect(build(input)).toMatchObject({ publicationId, scopeId: owner, sourceRevision: '9007199254740993', algorithm: ELO_ALGORITHM })
    expect(build({ ...input, sourceRevision: '9223372036854775807' }).sourceRevision).toBe('9223372036854775807')
  })

  it('starts the second match at the previous ratings: alternating wins give 997/1003', () => {
    const result = build(snapshot([play(1), play(2, [score(a), score(b, true)])])).result
    expect(result.gameHistory.map(point => point.rating)).toEqual([1024, 976, 1003, 997])
    expect(result.gamePlayers[game][a].rating).toBe(997)
    expect(result.gamePlayers[game][b].rating).toBe(1003)
  })

  it.each([[9, 48], [10, 32], [29, 32], [30, 24]])('retains K-factor at %i prior games', (priorGames, k) => {
    const plays = Array.from({ length: priorGames + 1 }, (_, i) => play(i + 1, [score(a, i % 2 === 0), score(b, i % 2 === 1)]))
    const previous = build(snapshot(plays.slice(0, -1))).result.gamePlayers[game]
    const current = build(snapshot(plays)).result.gamePlayers[game]
    const expectedA = 1 / (1 + 10 ** ((previous[b].rating - previous[a].rating) / 400))
    expect(calculateKFactor(priorGames)).toBe(k)
    expect(current[a].rating).toBe(Math.round(previous[a].rating + k * ((priorGames % 2 === 0 ? 1 : 0) - expectedA)))
  })

  it('preserves null-score ordering, equal-score legacy rankings, multiwinner and draw semantics', () => {
    const histories = [
      [score(a), score(b), score(c, false, 5)],
      [score(a, false, 5), score(b, false, 5), score(c, false, 5)],
      [score(a, true), score(b, true), score(c)],
      [{ ...score(a), draw: true }, { ...score(b), draw: true }],
    ]
    const results = histories.map(scores => build(snapshot([play(1, scores)])).result)
    expect(results[0].gameHistory.map(point => [point.playerId, point.rating])).toEqual([[a, 1024], [b, 1000], [c, 976]])
    expect(results[1].gameHistory.map(point => point.rating)).toEqual([1024, 1000, 976])
    expect(results[2].gameHistory.map(point => point.rating)).toEqual([1024, 1024, 976])
    expect(results[3].gameHistory.map(point => point.rating)).toEqual([1024, 976])
    expect(results[3].generalPlayers[a].draws).toBe(1)
    histories.forEach((scores, i) => expect(results[i]).toEqual(legacy(snapshot([play(1, scores)]))))
  })

  it('does not reinterpret cooperative metadata or persisted positions', () => {
    const cooperative = { ...play(1, [score(a, true), score(b, true)]), is_cooperative: true, team_won: true }
    cooperative.play_scores!.forEach(row => { row.position = 2 })
    const input = snapshot([cooperative])
    const result = build(input).result
    expect(result.gameHistory.map(point => point.rating)).toEqual([1024, 1024])
    expect(result).toEqual(legacy(input))
  })

  it('retains zero and negative legacy integer positions without changing or normalizing them', () => {
    const input = snapshot([play(1, [{ ...score(a), position: 0 }, { ...score(b, true), position: -1 }])])
    const before = structuredClone(input)
    expect(build(input).result).toEqual(legacy(input))
    expect(input).toEqual(before)
    expect(input.plays[0].play_scores!.map(row => row.position)).toEqual([0, -1])
  })

  it('retains empty history and skips zero/one participants without creating ratings', () => {
    expect(build(snapshot([])).result).toEqual(legacy(snapshot([])))
    const input = snapshot([play(1, []), play(2, [score(a)]), { ...play(3), play_scores: null }])
    expect(build(input).result).toEqual({ gamePlayers: {}, generalPlayers: {}, gameHistory: [], generalHistory: [], processedPlays: 0, skippedPlays: 3 })
  })

  it('keeps a missing game in the legacy null bucket, including general ELO', () => {
    const input = snapshot([{ ...play(1), game_id: null }, play(2, [score(a), score(b, true)])])
    const result = build(input).result
    expect(Object.keys(result.gamePlayers)).toEqual(['null', game])
    expect(result.gameHistory[0].gameId).toBeNull()
    expect(result.generalPlayers[a]).toMatchObject({ rating: 1000, gamesPlayed: 2, wins: 1, losses: 1 })
    expect(result).toEqual(legacy(input))
  })

  it('aggregates independent game ratings using the existing weighted general formula', () => {
    const input = snapshot([play(1), play(2), { ...play(3, [score(a), score(b, true)]), game_id: uuid(2001) }])
    const result = build(input).result
    expect(result.generalPlayers[a].rating).toBe(Math.round((result.gamePlayers[game][a].rating * 2 + 976) / 3))
    expect(result).toEqual(legacy(input))
  })

  it('matches the untouched core for deterministic seeded histories and leaves every input intact', () => {
    let seed = 17
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
    for (let history = 0; history < 25; history++) {
      const plays = Array.from({ length: 40 }, (_, i) => {
        const players = [a, b, c].slice(0, 2 + random() % 2)
        if (random() % 2) players.reverse()
        return {
          ...play(i + 1, players.map(id => ({ ...score(id, random() % 5 === 0, random() % 3 ? random() % 100 : null), draw: random() % 4 === 0 }))),
          game_id: random() % 4 === 0 ? null : uuid(2000 + random() % 2),
        }
      })
      const input = snapshot(plays)
      const before = structuredClone(input)
      input.plays.forEach(row => { row.play_scores?.forEach(Object.freeze); Object.freeze(row.play_scores); Object.freeze(row) })
      Object.freeze(input.plays)
      Object.freeze(input)
      expect(build(input).result).toEqual(legacy(input))
      expect(build(input)).toEqual(build(input))
      expect(input).toEqual(before)
    }
  })
})

describe('buildEloPublication boundary validation', () => {
  const invalid = (change: (input: EloSourceSnapshot) => void) => {
    const input = snapshot()
    change(input)
    expect(() => build(input)).toThrow('Invalid ELO publication')
  }

  it.each(['', '-1', '01', '1.0', '1e3', '9223372036854775808', '99999999999999999999999'])('rejects invalid bigint revision %s', revision => {
    invalid(input => { input.sourceRevision = revision })
  })

  it('rejects UUIDs before they can become object keys', () => {
    expect(() => buildEloPublication(snapshot(), 'not-a-uuid')).toThrow('publicationId')
    invalid(input => { input.scopeId = '__proto__' })
    invalid(input => { input.plays[0].game_id = 'constructor' })
    invalid(input => { input.plays[0].id = 'play' })
    invalid(input => { input.plays[0].play_scores![0].player_id = '__proto__' })
  })

  it('rejects duplicate plays and players', () => {
    invalid(input => { input.plays.push(structuredClone(input.plays[0])) })
    invalid(input => { input.plays[0].play_scores!.push(score(a)) })
  })

  it.each([NaN, Infinity, -Infinity, '5', undefined])('rejects malformed score %s without silently dropping it', value => {
    invalid(input => { input.plays[0].play_scores![0].score = value as number })
  })

  it('rejects malformed booleans, positions and player display metadata', () => {
    invalid(input => { input.plays[0].play_scores![0].winner = 1 as unknown as boolean })
    invalid(input => { input.plays[0].play_scores![0].draw = 'false' as unknown as boolean })
    invalid(input => { input.plays[0].play_scores![0].position = Infinity })
    invalid(input => { input.plays[0].play_scores![0].position = 2147483648 })
    invalid(input => { input.plays[0].play_scores![0].position = -2147483649 })
    invalid(input => { input.plays[0].play_scores![0].position = 0.5 })
    invalid(input => { input.plays[0].play_scores![0].players = { name: 1 as unknown as string, alias: null } })
  })

  it.each(['not-a-date', '0000-01-01', '2026-02-30', '2026-13-01', '2026-01-01T10:00:00', '2026-01-01T10:00:00Z'])('rejects invalid or non-date source value %s', value => {
    invalid(input => { input.plays[0].played_at = value })
  })

  it('rejects unordered histories and equal-date descending IDs instead of sorting source data', () => {
    expect(() => build(snapshot([play(2), play(1)]))).toThrow('play order')
    expect(() => build(snapshot([{ ...play(1), played_at: '2026-01-02' }, play(2)]))).toThrow('play order')
  })

  it('accepts finite negative/fractional scores and nullable legacy flags', () => {
    const input = snapshot([play(1, [{ ...score(a, false, -0.25), winner: null, draw: null }, score(b, false, 0.125)])])
    expect(build(input).result).toEqual(legacy(input))
  })
})
