import { simulateAllPlays } from './simulation.ts'
import type { SimulationPlay, SimulationResult } from './simulation.ts'
import { ELO_ALGORITHM } from './algorithm.ts'
export { ELO_ALGORITHM } from './algorithm.ts'

export interface EloSourceSnapshot {
  /** Public standings use 'global'; UUID scopes are isolated diagnostic histories. */
  scopeId: string
  sourceRevision: string
  plays: Array<Omit<SimulationPlay, 'game_id'> & { game_id: string | null }>
}

export interface EloPublication {
  publicationId: string
  scopeId: string
  sourceRevision: string
  algorithm: typeof ELO_ALGORITHM
  result: SimulationResult
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const REVISION = /^(0|[1-9][0-9]*)$/
const MAX_REVISION = '9223372036854775807'

function fail(field: string): never {
  throw new Error(`Invalid ELO publication: ${field}`)
}

function uuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !UUID.test(value)) fail(field)
}

function date(value: unknown): number {
  if (typeof value !== 'string') return fail('played_at')
  // Require a real calendar day; Date.parse alone normalizes e.g. February 30.
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!parts || parts[1] === '0000') return fail('played_at')
  const calendarDay = `${parts[1]}-${parts[2]}-${parts[3]}`
  const day = new Date(`${calendarDay}T00:00:00Z`)
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== calendarDay) fail('played_at')
  return day.getTime()
}

function count(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) fail(field)
}

function validateResult(result: SimulationResult, plays: EloSourceSnapshot['plays']): void {
  const processed = plays.filter(play => play.play_scores && play.play_scores.length >= 2)
  if (result.processedPlays !== processed.length || result.skippedPlays !== plays.length - processed.length) fail('play counts')
  const historyLength = processed.reduce((sum, play) => sum + play.play_scores!.length, 0)
  if (result.gameHistory.length !== historyLength || result.generalHistory.length !== historyLength) fail('history counts')
  for (const players of [...Object.values(result.gamePlayers), result.generalPlayers]) {
    for (const state of Object.values(players)) {
      if (!Number.isFinite(state.rating)) fail('rating')
      for (const field of ['gamesPlayed', 'wins', 'losses', 'draws'] as const) count(state[field], field)
      if (state.wins + state.losses + state.draws !== state.gamesPlayed) fail('player counts')
    }
  }
  for (const point of [...result.gameHistory, ...result.generalHistory]) {
    if (!Number.isFinite(point.rating) || !Number.isFinite(point.ratingChange)) fail('history rating')
    if ('gamesPlayed' in point) count(point.gamesPlayed, 'history gamesPlayed')
  }
}

/** Pure worker adapter. It validates a complete ordered snapshot, never sorts it. */
export function buildEloPublication(snapshot: EloSourceSnapshot, publicationId: string): EloPublication {
  uuid(publicationId, 'publicationId')
  if (!snapshot || typeof snapshot !== 'object') fail('snapshot')
  if (snapshot.scopeId !== 'global') uuid(snapshot.scopeId, 'scopeId')
  const revision = snapshot.sourceRevision
  if (typeof revision !== 'string' || !REVISION.test(revision)
    || revision.length > MAX_REVISION.length
    || (revision.length === MAX_REVISION.length && revision > MAX_REVISION)) fail('sourceRevision')
  if (!Array.isArray(snapshot.plays)) fail('plays')

  const ids = new Set<string>()
  let previous: { instant: number; id: string } | undefined
  for (const play of snapshot.plays) {
    if (!play || typeof play !== 'object') fail('play')
    uuid(play.id, 'play.id')
    const id = play.id.toLowerCase()
    if (ids.has(id)) fail('duplicate play')
    ids.add(id)
    if (play.game_id !== null) uuid(play.game_id, 'game_id')
    const instant = date(play.played_at)
    if (previous && (instant < previous.instant || (instant === previous.instant && id <= previous.id))) fail('play order')
    previous = { instant, id }
    if (play.play_scores === null) continue
    if (!Array.isArray(play.play_scores)) fail('play_scores')
    const players = new Set<string>()
    for (const score of play.play_scores) {
      if (!score || typeof score !== 'object') fail('play score')
      uuid(score.player_id, 'player_id')
      const playerId = score.player_id.toLowerCase()
      if (players.has(playerId)) fail('duplicate player')
      players.add(playerId)
      if (score.score !== null && (typeof score.score !== 'number' || !Number.isFinite(score.score))) fail('score')
      if (score.winner !== null && typeof score.winner !== 'boolean') fail('winner')
      if (score.draw !== undefined && score.draw !== null && typeof score.draw !== 'boolean') fail('draw')
      if (score.position !== null && (!Number.isInteger(score.position) || score.position < -2147483648 || score.position > 2147483647)) fail('position')
      if (score.players !== undefined && score.players !== null) {
        if (typeof score.players !== 'object') fail('players')
        for (const field of ['name', 'alias'] as const) {
          if (score.players[field] !== null && typeof score.players[field] !== 'string') fail(`players.${field}`)
        }
      }
    }
  }

  // The legacy core already uses null as the object key "null" and retains it
  // in gameHistory.gameId at runtime; this cast preserves that existing behavior.
  const result = simulateAllPlays(snapshot.plays as SimulationPlay[])
  validateResult(result, snapshot.plays)
  return { publicationId, scopeId: snapshot.scopeId, sourceRevision: revision, algorithm: ELO_ALGORITHM, result }
}
