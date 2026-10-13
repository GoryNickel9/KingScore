import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/db'
import { runBgaImport, type BgaImportPlay } from './bgaImport'

const atomic = vi.hoisted(() => ({
  enabled: true,
  importPlay: vi.fn(),
  Error: class extends Error {
    constructor(message: string, readonly kind: string) { super(message) }
  },
}))

vi.mock('./playWrites', () => ({
  get atomicPlayWritesEnabled() { return atomic.enabled },
  importBgaPlay: atomic.importPlay,
  PlayWriteError: atomic.Error,
}))

interface QueryCall {
  table: string
  operation: 'select' | 'insert'
  values?: unknown
  filters: [string, unknown][]
  range?: [number, number]
}

function mockClient(options: {
  existing?: Partial<Record<'plays' | 'games' | 'players', object[]>>
  preloadError?: string
  insertError?: string
  emptyInsert?: string
} = {}) {
  const rows = {
    plays: [] as object[],
    games: [{ id: 'game', name: 'Azul' }] as object[],
    players: [{ id: 'anna', name: 'Anna' }, { id: 'bruno', name: 'Bruno' }] as object[],
    ...options.existing,
  }
  const calls: QueryCall[] = []
  const from = vi.fn((table: string) => {
    const call: QueryCall = { table, operation: 'select', filters: [] }
    calls.push(call)
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((field: string, value: unknown) => { call.filters.push([field, value]); return query }),
      not: vi.fn(() => query),
      order: vi.fn(() => query),
      range: vi.fn((start: number, end: number) => {
        call.range = [start, end]
        return Promise.resolve({
          data: options.preloadError === table ? null : rows[table as keyof typeof rows].slice(start, end + 1),
          error: options.preloadError === table ? { message: 'Preload negato' } : null,
        })
      }),
      insert: vi.fn((values: unknown) => { call.operation = 'insert'; call.values = values; return query }),
      single: vi.fn(() => Promise.resolve({
        data: options.emptyInsert === table ? null : { id: `new-${table}` },
        error: options.insertError === table ? { message: `Errore ${table}` } : null,
      })),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({
        data: null,
        error: options.insertError === table ? { message: `Errore ${table}` } : null,
      }).then(resolve),
    }
    return query
  })
  return { client: { from } as unknown as SupabaseClient<Database>, calls }
}

const play: BgaImportPlay = {
  bga_table_id: 'table-1', game_name: 'Azul', played_at: '2026-10-13',
  duration_minutes: null, location: 'Board Game Arena',
  players: [{ name: 'Anna', score: null, winner: true, position: '1' }, { name: 'Bruno', score: 12.5 }],
}

const hooks = () => ({ onLog: vi.fn(), onProgress: vi.fn() })

beforeEach(() => {
  atomic.enabled = true
  atomic.importPlay.mockReset()
  atomic.importPlay.mockResolvedValue({ play_id: 'play', revision: 'v1', replayed: false, skipped: false })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ text: async () => '<items />' }))
})

afterEach(() => vi.unstubAllGlobals())

describe('runBgaImport', () => {
  it('saves the entire play in one command preserving nullable scores, positions and BGA metadata', async () => {
    const { client, calls } = mockClient()
    expect(await runBgaImport(client, 'actor', [play], [], hooks()))
      .toEqual({ imported: 1, skipped: 0, errors: 0, total: 1 })
    expect(atomic.importPlay).toHaveBeenCalledOnce()
    expect(atomic.importPlay).toHaveBeenCalledWith(client, {
      actorId: 'actor', requestId: expect.any(String),
      payload: {
        game_id: 'game', played_at: '2026-10-13', duration_minutes: null,
        source: 'offline', notes: null, is_cooperative: false, team_won: null,
        scores: [
          { id: null, player_id: 'anna', score: null, winner: true, color: null, role: null },
          { id: null, player_id: 'bruno', score: 12.5, winner: false, color: null, role: null },
        ],
      },
      metadata: { location: 'Board Game Arena', bga_table_id: 'table-1' },
      positions: [1, null],
    })
    expect(calls.some(call => call.operation === 'insert')).toBe(false)
    expect(calls.find(call => call.table === 'games')?.filters).toEqual([])
  })

  it('counts server deduplication as skipped and skips repeated table IDs in the batch', async () => {
    atomic.importPlay.mockResolvedValue({ play_id: 'existing', revision: 'v1', replayed: false, skipped: true })
    const { client } = mockClient()
    expect(await runBgaImport(client, 'actor', [play, play], [], hooks()))
      .toEqual({ imported: 0, skipped: 2, errors: 0, total: 2 })
    expect(atomic.importPlay).toHaveBeenCalledOnce()
  })

  it('does not count a failed RPC as imported and never falls back to direct writes', async () => {
    atomic.importPlay.mockRejectedValue(new atomic.Error('Dati non validi', 'validation'))
    const { client, calls } = mockClient()
    const result = await runBgaImport(client, 'actor', [play], [], hooks())
    expect(result).toEqual({ imported: 0, skipped: 0, errors: 1, total: 1 })
    expect(calls.some(call => call.operation === 'insert')).toBe(false)
  })

  it('stops the batch after an uncertain outcome without retrying', async () => {
    atomic.importPlay.mockRejectedValue(new atomic.Error('Connessione interrotta', 'unknown'))
    const { client } = mockClient()
    const progress = hooks()
    const result = await runBgaImport(client, 'actor', [play, { ...play, bga_table_id: 'table-2' }], [], progress)
    expect(result).toEqual({ imported: 0, skipped: 0, errors: 0, total: 2, uncertain: 1, unprocessed: 1 })
    expect(atomic.importPlay).toHaveBeenCalledOnce()
    expect(progress.onLog).toHaveBeenCalledWith(expect.stringContaining('esito del salvataggio incerto'), 'error')
  })

  it.each(['plays', 'games', 'players'])('aborts before writes when the %s preload fails', async table => {
    const { client, calls } = mockClient({ preloadError: table })
    expect(await runBgaImport(client, 'actor', [play], [], hooks()))
      .toEqual({ imported: 0, skipped: 0, errors: 1, total: 1 })
    expect(atomic.importPlay).not.toHaveBeenCalled()
    expect(calls.some(call => call.operation === 'insert')).toBe(false)
  })

  it('loads all preload pages including records beyond the previous 10000 limit', async () => {
    const existing = Array.from({ length: 11000 }, (_, index) => ({ bga_table_id: `known-${index}` }))
    existing.push({ bga_table_id: play.bga_table_id })
    const { client, calls } = mockClient({ existing: { plays: existing } })
    expect(await runBgaImport(client, 'actor', [play], [], hooks()))
      .toEqual({ imported: 0, skipped: 1, errors: 0, total: 1 })
    expect(calls.filter(call => call.table === 'plays')).toHaveLength(12)
    expect(atomic.importPlay).not.toHaveBeenCalled()
  })

  it.each(['insertError', 'emptyInsert'] as const)('does not silently lose participants on %s', async failure => {
    const { client, calls } = mockClient({ existing: { players: [] }, [failure]: 'players' })
    expect(await runBgaImport(client, 'actor', [play], [], hooks()))
      .toEqual({ imported: 0, skipped: 0, errors: 1, total: 1 })
    expect(atomic.importPlay).not.toHaveBeenCalled()
    expect(calls.some(call => ['plays', 'play_scores'].includes(call.table) && call.operation === 'insert')).toBe(false)
  })

  it('aborts a failed confirmed-player insertion before writing plays', async () => {
    const { client } = mockClient({ insertError: 'players' })
    const result = await runBgaImport(client, 'actor', [play], [{ raw: 'new', name: 'New player' }], hooks())
    expect(result.errors).toBe(1)
    expect(atomic.importPlay).not.toHaveBeenCalled()
  })

  it('resolves new players before calling the atomic play command', async () => {
    const { client, calls } = mockClient({ existing: { players: [{ id: 'anna', name: 'Anna' }] } })
    await runBgaImport(client, 'actor', [play], [], hooks())
    expect(calls.filter(call => call.operation === 'insert').map(call => call.table)).toEqual(['players'])
    expect(atomic.importPlay.mock.calls[0][1].payload.scores[1].player_id).toBe('new-players')
  })

  it('resolves a missing game before submitting the play without writing a games.user_id field', async () => {
    const { client, calls } = mockClient({ existing: { games: [] } })
    expect((await runBgaImport(client, 'actor', [play], [], hooks())).imported).toBe(1)
    expect(calls.find(call => call.table === 'games' && call.operation === 'insert')?.values)
      .toEqual({ name: 'Azul', bga_id: null, image_url: null })
    expect(atomic.importPlay.mock.calls[0][1].payload.game_id).toBe('new-games')
  })

  it('does not write a play if game creation fails', async () => {
    const { client, calls } = mockClient({ existing: { games: [] }, insertError: 'games' })
    expect((await runBgaImport(client, 'actor', [play], [], hooks())).errors).toBe(1)
    expect(atomic.importPlay).not.toHaveBeenCalled()
    expect(calls.some(call => ['plays', 'play_scores'].includes(call.table) && call.operation === 'insert')).toBe(false)
  })

  it.each([
    { ...play, played_at: null },
    { ...play, players: [] },
    { ...play, players: [{ name: null }] },
    { ...play, players: [{ name: 'Anna', position: '2nd' }] },
  ])('rejects incomplete participants, dates and malformed positions before saving: %j', async invalidPlay => {
    const { client, calls } = mockClient()
    expect((await runBgaImport(client, 'actor', [invalidPlay], [], hooks())).errors).toBe(1)
    expect(atomic.importPlay).not.toHaveBeenCalled()
    expect(calls.some(call => call.operation === 'insert')).toBe(false)
  })

  it('keeps legacy writes while the rollout flag is disabled', async () => {
    atomic.enabled = false
    const { client, calls } = mockClient()
    expect(await runBgaImport(client, 'actor', [play], [], hooks()))
      .toEqual({ imported: 1, skipped: 0, errors: 0, total: 1 })
    expect(atomic.importPlay).not.toHaveBeenCalled()
    expect(calls.filter(call => call.operation === 'insert').map(call => call.table)).toEqual(['plays', 'play_scores'])
    expect(calls.find(call => call.table === 'play_scores')?.values).toEqual([
      { play_id: 'new-plays', player_id: 'anna', score: null, winner: true, position: 1 },
      { play_id: 'new-plays', player_id: 'bruno', score: 12.5, winner: false, position: null },
    ])
  })

  it('does not report legacy score failures as imported', async () => {
    atomic.enabled = false
    const { client } = mockClient({ insertError: 'play_scores' })
    expect(await runBgaImport(client, 'actor', [play], [], hooks()))
      .toEqual({ imported: 0, skipped: 0, errors: 1, total: 1 })
  })
})
