import { afterEach, describe, expect, it, vi } from 'vitest'
import { readGlobalElo, readGlobalEloYear, eloReadStatus } from './readClient'
import { ELO_ALGORITHM } from './algorithm'
import { generalStandings, gameStandings, generalHistory, gameHistory } from './projections'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../types/db'
import { buildEloPublication } from './publication'

const id = '00000000-0000-0000-0000-000000000001'
const empty = { gamePlayers: {}, generalPlayers: {}, gameHistory: [], generalHistory: [], processedPlays: 0, skippedPlays: 0 }
const current = { scopeId: 'global', algorithm: ELO_ALGORITHM, status: 'current', sourceRevision: '9007199254740993', publishedRevision: '9007199254740993', publicationId: id, result: empty }

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

describe('public ELO reader', () => {
  it('calls only the no-argument RPC once and shares its identity across all four projections', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: current, error: null })
    const read = await readGlobalElo({ rpc })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_elo_publication_v1')
    for (const view of [generalStandings(read), gameStandings(read, id), generalHistory(read), gameHistory(read, id)]) {
      expect(view).toMatchObject({ scopeId: 'global', publicationId: id, sourceRevision: '9007199254740993', publishedRevision: '9007199254740993', status: 'current', data: [] })
    }
    expect(eloReadStatus(read)).toContain('9007199254740993')
  })

  it('preserves stale/missing status without a read fallback or write', async () => {
    const rpc = vi.fn()
    rpc.mockResolvedValueOnce({ data: { ...current, status: 'stale', sourceRevision: '9007199254740994', result: null }, error: null })
    const stale = await readGlobalElo({ rpc })
    expect(generalStandings(stale).data).toBeNull()
    expect(eloReadStatus(stale)).toContain('nascosti')
    rpc.mockResolvedValueOnce({ data: { ...current, status: 'missing', algorithm: null, publishedRevision: null, publicationId: null, result: null }, error: null })
    const missing = await readGlobalElo({ rpc })
    expect(generalHistory(missing).data).toBeNull()
    expect(eloReadStatus(missing)).toContain('non è ancora disponibile')
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('rejects an owner-scoped response and errors without retry, cache access or credential disclosure', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { ...current, scopeId: id }, error: null })
    await expect(readGlobalElo({ rpc })).rejects.toThrow('Invalid ELO read response')
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'private token' } })
    await expect(readGlobalElo({ rpc })).rejects.toThrow('Classifica ELO non disponibile')
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(eloReadStatus(null, true)).not.toContain('token')
  })

  it('routes legacy read exports through global publications and blocks every legacy write with the flag enabled', async () => {
    vi.stubEnv('VITE_ATOMIC_PLAY_WRITES', 'true')
    vi.resetModules()
    const helpers = await import('../eloCalculator')
    const rpc = vi.fn().mockResolvedValue({ data: current, error: null })
    const from = vi.fn(() => { throw new Error('Legacy table access is forbidden') })
    const client = { rpc, from } as unknown as SupabaseClient<Database>
    expect(await helpers.getAllGeneralELO(client, id)).toEqual([])
    expect(await helpers.getAllGeneralELO(client, null)).toEqual([])
    expect(await helpers.getGeneralELO(client, id)).toBeNull()
    expect(await helpers.getELOHistoryForGame(client, id, id)).toEqual([])
    expect(await helpers.getGeneralELOHistory(client, id)).toEqual([])
    await expect(helpers.recalculateAllELO(client, id)).rejects.toThrow('gestito dal server')
    await expect(helpers.saveELOHistoryEntries(client, [])).rejects.toThrow('gestito dal server')
    await expect(helpers.invalidateELOHistory(client, id)).rejects.toThrow('gestito dal server')
    expect(from).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledTimes(5)
    for (const call of rpc.mock.calls) expect(call).toEqual(['get_elo_publication_v1'])
  })

  it('keeps global participants and ratings when compatibility callers pass different owner IDs', async () => {
    vi.stubEnv('VITE_ATOMIC_PLAY_WRITES', 'true')
    vi.resetModules()
    const helpers = await import('../eloCalculator')
    const second = '00000000-0000-0000-0000-000000000002'
    const publication = buildEloPublication({
      scopeId: id, sourceRevision: '1', plays: [{ id, game_id: id, played_at: '2026-10-15', play_scores: [
        { player_id: id, winner: true, score: null, position: 1 },
        { player_id: second, winner: false, score: null, position: 2 },
      ] }],
    }, id)
    const rpc = vi.fn().mockResolvedValue({ data: { ...current, sourceRevision: '1', publishedRevision: '1', result: publication.result }, error: null })
    const client = { rpc } as unknown as SupabaseClient<Database>
    const forFirstOwner = await helpers.getAllGeneralELO(client, id)
    const forSecondOwner = await helpers.getAllGeneralELO(client, second)
    expect(forFirstOwner).toEqual(forSecondOwner)
    expect(forFirstOwner.map(player => [player.player_id, player.rating, player.user_id])).toEqual([[id, 1024, null], [second, 976, null]])
    expect((await helpers.getELOHistoryForGame(client, id, second)).map(point => point.rating)).toEqual([1024, 976])
    expect((await helpers.getGeneralELOHistory(client, second)).map(point => point.rating)).toEqual([1024, 976])
    expect((await helpers.getGeneralELO(client, second))?.rating).toBe(976)
  })

  it('selects Wrapped years from complete global history without resetting ratings at New Year', async () => {
    const second = '00000000-0000-0000-0000-000000000002'
    const publication = buildEloPublication({ scopeId: id, sourceRevision: '1', plays: [
      { id, game_id: id, played_at: '2025-12-31', play_scores: [
        { player_id: id, winner: true, score: null, position: 1 }, { player_id: second, winner: false, score: null, position: 2 },
      ] },
      { id: second, game_id: id, played_at: '2026-01-01', play_scores: [
        { player_id: id, winner: false, score: null, position: 2 }, { player_id: second, winner: true, score: null, position: 1 },
      ] },
    ] }, id)
    const wire = { ...current, sourceRevision: '1', publishedRevision: '1', result: publication.result }
    const rpc = vi.fn().mockResolvedValue({ data: wire, error: null })
    const year = await readGlobalEloYear({ rpc }, 2026)
    expect(year.read.publicationId).toBe(id)
    expect(year.history).toHaveLength(2)
    expect(year.history?.find(point => point.playerId === id)).toMatchObject({ rating: 997, ratingChange: -27, gamesPlayed: 2 })
    expect(year.history?.every(point => point.date === '2026-01-01')).toBe(true)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_elo_publication_v1')
    rpc.mockResolvedValueOnce({ data: { ...wire, status: 'stale', sourceRevision: '2', result: null }, error: null })
    expect((await readGlobalEloYear({ rpc }, 2026)).history).toBeNull()
    await expect(readGlobalEloYear({ rpc }, NaN)).rejects.toThrow('Anno ELO non valido')
    expect(rpc).toHaveBeenCalledTimes(2)
  })
})
