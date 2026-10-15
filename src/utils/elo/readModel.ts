import { ELO_ALGORITHM } from './algorithm.ts'
import type { GameHistoryPoint, SimulationResult } from './simulation'

type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T
export type EloReadResult = DeepReadonly<Omit<SimulationResult, 'gameHistory'> & {
  gameHistory: Array<Omit<GameHistoryPoint, 'gameId'> & { gameId: string | null }>
}>

type ReadIdentity = { readonly scopeId: string; readonly sourceRevision: string }
export type EloRead = ReadIdentity & (
  | { readonly status: 'missing'; readonly algorithm: null; readonly publishedRevision: null; readonly publicationId: null; readonly result: null }
  | { readonly status: 'stale'; readonly algorithm: typeof ELO_ALGORITHM; readonly publishedRevision: string; readonly publicationId: string; readonly result: null }
  | { readonly status: 'current'; readonly algorithm: typeof ELO_ALGORITHM; readonly publishedRevision: string; readonly publicationId: string; readonly result: EloReadResult }
)

export class EloReadError extends Error {
  constructor() { super('Invalid ELO read response'); this.name = 'EloReadError' }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MAX_REVISION = '9223372036854775807'
function invalid(): never { throw new EloReadError() }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid()
  return value as Record<string, unknown>
}
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  const row = record(value)
  const actual = Object.keys(row)
  if (actual.length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(row, key))) invalid()
  return row
}
function uuid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !UUID.test(value)) invalid()
}
function revision(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)
    || value.length > MAX_REVISION.length || (value.length === MAX_REVISION.length && value > MAX_REVISION)) invalid()
}
function compareRevision(a: string, b: string): number { return a.length - b.length || a.localeCompare(b) }
function integer(value: unknown, nonnegative = false): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || (nonnegative && value < 0)) invalid()
}
function date(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) invalid()
  const day = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value) invalid()
}
function array(value: unknown): unknown[] { if (!Array.isArray(value)) return invalid(); return value }
function freeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value as DeepReadonly<T>
}

type History = { game: string; date: string; rating: number; name: string; count: number }
type State = { rating: number; gamesPlayed: number; wins: number; losses: number; draws: number; lastPlayedAt: string; playerName?: string }
function state(value: unknown, playerId: string, game: boolean): State {
  const row = exact(value, ['playerId', ...(game ? ['playerName'] : []), 'rating', 'gamesPlayed', 'wins', 'losses', 'draws', 'lastPlayedAt'])
  if (row.playerId !== playerId || (game && typeof row.playerName !== 'string')) invalid()
  integer(row.rating)
  for (const key of ['gamesPlayed', 'wins', 'losses', 'draws']) integer(row[key], true)
  date(row.lastPlayedAt)
  const result = row as unknown as State
  if (result.gamesPlayed < 1 || result.wins + result.losses + result.draws !== result.gamesPlayed) invalid()
  return result
}

function result(value: unknown): EloReadResult {
  const root = exact(value, ['gamePlayers', 'generalPlayers', 'gameHistory', 'generalHistory', 'processedPlays', 'skippedPlays'])
  integer(root.processedPlays, true)
  integer(root.skippedPlays, true)
  const games = record(root.gamePlayers)
  const generals = record(root.generalPlayers)
  const states = new Map<string, State>()
  const totals = new Map<string, { gamesPlayed: number; wins: number; losses: number; draws: number; lastPlayedAt: string }>()
  for (const [game, playersValue] of Object.entries(games)) {
    if (game !== 'null') uuid(game)
    const players = record(playersValue)
    if (!Object.keys(players).length) invalid()
    for (const [playerId, value] of Object.entries(players)) {
      uuid(playerId)
      const current = state(value, playerId, true)
      states.set(`${game}:${playerId}`, current)
      const total = totals.get(playerId) ?? { gamesPlayed: 0, wins: 0, losses: 0, draws: 0, lastPlayedAt: current.lastPlayedAt }
      for (const key of ['gamesPlayed', 'wins', 'losses', 'draws'] as const) { total[key] += current[key]; integer(total[key], true) }
      if (current.lastPlayedAt > total.lastPlayedAt) total.lastPlayedAt = current.lastPlayedAt
      totals.set(playerId, total)
    }
  }
  if (Object.keys(generals).length !== totals.size) invalid()
  for (const [playerId, value] of Object.entries(generals)) {
    uuid(playerId)
    const current = state(value, playerId, false)
    const total = totals.get(playerId)
    if (!total || Object.entries(total).some(([key, value]) => current[key as keyof State] !== value)) invalid()
  }

  const pairs = new Map<string, { game: string; date: string }>()
  const plays = new Map<string, { game: string; date: string; count: number }>()
  const historyStates = new Map<string, History>()
  let previous = ''
  for (const value of array(root.gameHistory)) {
    const row = exact(value, ['gameId', 'playId', 'playerId', 'playerName', 'rating', 'ratingChange', 'date'])
    if (row.gameId !== null) uuid(row.gameId)
    uuid(row.playId); uuid(row.playerId); date(row.date)
    if (typeof row.playerName !== 'string') invalid()
    integer(row.rating); integer(row.ratingChange)
    const order = `${row.date}:${row.playId}`
    if (order < previous) invalid()
    previous = order
    const game = row.gameId === null ? 'null' : row.gameId
    const pair = `${row.playId}:${row.playerId}`
    if (pairs.has(pair)) invalid()
    pairs.set(pair, { game, date: row.date })
    const play = plays.get(row.playId) ?? { game, date: row.date, count: 0 }
    if (play.game !== game || play.date !== row.date) invalid()
    play.count++
    plays.set(row.playId, play)
    const key = `${game}:${row.playerId}`
    const prior = historyStates.get(key)
    if ((prior?.rating ?? 1000) + row.ratingChange !== row.rating) invalid()
    historyStates.set(key, { game, date: row.date, rating: row.rating, name: prior?.name ?? row.playerName, count: (prior?.count ?? 0) + 1 })
  }
  if (plays.size !== root.processedPlays || [...plays.values()].some(play => play.count < 2) || states.size !== historyStates.size) invalid()
  for (const [key, current] of states) {
    const history = historyStates.get(key)
    if (!history || current.rating !== history.rating || current.gamesPlayed !== history.count
      || current.lastPlayedAt !== history.date || current.playerName !== history.name) invalid()
  }

  const seen = new Set<string>()
  const generalHistory = new Map<string, { rating: number; count: number; date: string }>()
  previous = ''
  for (const value of array(root.generalHistory)) {
    const row = exact(value, ['playId', 'playerId', 'playerName', 'rating', 'ratingChange', 'gamesPlayed', 'date'])
    uuid(row.playId); uuid(row.playerId); date(row.date)
    if (typeof row.playerName !== 'string') invalid()
    integer(row.rating); integer(row.ratingChange); integer(row.gamesPlayed, true)
    const order = `${row.date}:${row.playId}`
    if (order < previous) invalid()
    previous = order
    const pair = `${row.playId}:${row.playerId}`
    const matched = pairs.get(pair)
    if (!matched || seen.has(pair) || row.date !== matched.date || states.get(`${matched.game}:${row.playerId}`)?.playerName !== row.playerName) invalid()
    seen.add(pair)
    const prior = generalHistory.get(row.playerId)
    if (row.gamesPlayed !== (prior?.count ?? 0) + 1 || (prior?.rating ?? 1000) + row.ratingChange !== row.rating) invalid()
    generalHistory.set(row.playerId, { rating: row.rating, count: row.gamesPlayed, date: row.date })
  }
  if (seen.size !== pairs.size || generalHistory.size !== totals.size) invalid()
  for (const [playerId, value] of Object.entries(generals)) {
    const current = value as State
    const history = generalHistory.get(playerId)
    if (!history || current.rating !== history.rating || current.gamesPlayed !== history.count || current.lastPlayedAt !== history.date) invalid()
  }
  return root as unknown as EloReadResult
}

/** Decode a complete read snapshot without recalculating ELO or retaining wire references. */
export function decodeEloRead(value: unknown, expectedScope: string): EloRead {
  try {
    if (expectedScope !== 'global') uuid(expectedScope)
    const root = exact(structuredClone(value), ['scopeId', 'algorithm', 'status', 'sourceRevision', 'publishedRevision', 'publicationId', 'result'])
    if (root.scopeId !== expectedScope) invalid()
    revision(root.sourceRevision)
    if (root.status === 'missing') {
      if (root.algorithm !== null || root.publishedRevision !== null || root.publicationId !== null || root.result !== null) invalid()
    } else {
      if (root.algorithm !== ELO_ALGORITHM) invalid()
      revision(root.publishedRevision); uuid(root.publicationId)
      const comparison = compareRevision(root.publishedRevision, root.sourceRevision)
      if (root.status === 'stale') {
        if (comparison >= 0 || root.result !== null) invalid()
      } else if (root.status === 'current') {
        if (comparison !== 0) invalid()
        root.result = result(root.result)
      } else invalid()
    }
    return freeze(root) as EloRead
  } catch { throw new EloReadError() }
}
