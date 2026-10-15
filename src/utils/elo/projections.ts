import type { EloRead, EloReadResult } from './readModel'

type GamePlayer = EloReadResult['gamePlayers'][string][string]
type GeneralPlayer = EloReadResult['generalPlayers'][string] & { readonly playerName: string }
export type EloProjection<T> = Omit<EloRead, 'result'> & { readonly data: readonly T[] | null }

function project<T>(read: EloRead, select: (result: EloReadResult) => readonly T[]): EloProjection<T> {
  const { result, ...identity } = read
  return Object.freeze({ ...identity, data: result === null ? null : Object.freeze(select(result)) })
}

const byRating = (a: { rating: number; playerId: string }, b: { rating: number; playerId: string }) =>
  b.rating - a.rating || (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0)

/** Project the validated scope unchanged; public callers decode with 'global'. */
export function generalStandings(read: EloRead): EloProjection<GeneralPlayer> {
  return project(read, result => {
    const names = new Map(result.generalHistory.map(point => [point.playerId, point.playerName]))
    return Object.values(result.generalPlayers).map(player => Object.freeze({
      ...player, playerName: names.get(player.playerId)!,
    })).sort(byRating)
  })
}

function gameId(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
    throw new Error('Invalid ELO game filter')
  }
}

export function gameStandings(read: EloRead, id: string): EloProjection<GamePlayer> {
  gameId(id)
  return project(read, result => Object.values(result.gamePlayers[id] ?? {}).sort(byRating))
}

export function generalHistory(read: EloRead, playerId?: string): EloProjection<EloReadResult['generalHistory'][number]> {
  return project(read, result => result.generalHistory.filter(point => playerId === undefined || point.playerId === playerId))
}

export function gameHistory(read: EloRead, id: string, playerId?: string): EloProjection<EloReadResult['gameHistory'][number]> {
  gameId(id)
  return project(read, result => result.gameHistory.filter(point => point.gameId === id && (playerId === undefined || point.playerId === playerId)))
}
