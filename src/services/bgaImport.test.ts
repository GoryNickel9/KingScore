import type { SupabaseClient } from '@supabase/supabase-js'
import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../types/db'
import { AtomicPlayWriter, type PendingPlaySave, type PlayWriterDependencies } from './atomicPlayWriter'
import { runBgaImport, type BgaAtomicImportOptions, type BgaImportPlay } from './bgaImport'

const actor = '00000000-0000-0000-0000-000000000001'
const playId = '00000000-0000-0000-0000-000000000002'
const gameId = '00000000-0000-0000-0000-000000000003'
const first = '00000000-0000-0000-0000-000000000004'
const second = '00000000-0000-0000-0000-000000000005'
const newId = '00000000-0000-0000-0000-000000000006'
const play = (): BgaImportPlay => ({ bga_table_id: '#001', game_name: 'Game', played_at: '2026-10-15',
  duration_minutes: 42, location: 'Table', players: [
    { name: 'First', score: '9007199254740993.125', position: '1', winner: true },
    { name: 'Second', score: '-0.25', position: '2', winner: false },
  ] })
interface CatalogRequest { table: string; operation: 'select' | 'insert'; filters: Array<[string, unknown]>; from: number; to: number; value?: unknown }
function fixture() {
  const games = [{ id: gameId, name: 'Game' }]
  const players = [{ id: first, name: 'First' }, { id: second, name: 'Second' }]
  const catalogCalls: CatalogRequest[] = []
  const rows = new Map<string, PendingPlaySave>()
  const rpcBodies: Array<Record<string, unknown>> = []
  const control = {
    onCatalog: (_request: CatalogRequest): void => undefined,
    catalogError: false,
    catalogReject: false,
    rpcStatus: 200,
    skipped: false,
  }
  const deps: PlayWriterDependencies = {
    session: vi.fn(async () => ({ actorId: actor, accessToken: 'synthetic-token', admin: true })),
    online: () => true,
    fetch: vi.fn(async (_url, options) => {
      rpcBodies.push(JSON.parse(options!.body as string) as Record<string, unknown>)
      return new Response(JSON.stringify(control.rpcStatus === 200 ? { play_id: playId, revision: 'v1:result',
        replayed: false, skipped: control.skipped } : { code: `PT${control.rpcStatus}` }), { status: control.rpcStatus })
    }),
    journal: { load: key => rows.get(key) ?? null, save: (key, value) => { rows.set(key, value) }, clear: key => { rows.delete(key) } },
    lock: async (_key, operation) => operation(),
  }
  const writer = new AtomicPlayWriter('http://127.0.0.1:3000', 'synthetic-key', deps)
  const options: BgaAtomicImportOptions = { writer, session: () => deps.session(), online: () => deps.online(),
    hasPendingSave: () => { const stored = rows.get(actor); return stored !== undefined && stored.receiptBody === undefined } }
  const client = {
    from(table: string) {
      const request: CatalogRequest = { table, operation: 'select', filters: [], from: 0, to: 999 }
      const query = {
        select: (_fields: string) => query,
        order: (_column: string) => query,
        eq: (column: string, value: unknown) => { request.filters.push([column, value]); return query },
        range: (from: number, to: number) => { request.from = from; request.to = to; return query },
        insert: (value: unknown) => { request.operation = 'insert'; request.value = value; return query },
        single: () => query,
        then(onResolved: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) {
          return Promise.resolve().then(() => {
            catalogCalls.push(request); control.onCatalog(request)
            if (control.catalogReject) throw new Error('private transport error')
            if (control.catalogError) return { data: null, error: { message: 'private database error' } }
            const entries = table === 'games' ? games : players
            return { data: request.operation === 'insert' ? { id: newId } : entries.slice(request.from, request.to + 1), error: null }
          }).then(onResolved, onRejected)
        },
      }
      return query
    },
  } as unknown as SupabaseClient<Database>
  const hooks = { onLog: vi.fn(), onProgress: vi.fn() }
  return { games, players, rows, deps, writer, options, hooks, catalogCalls, rpcBodies, control,
    run: (plays = [play()]) => runBgaImport(client, actor, plays, [], hooks, options) }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('atomic BGA import', () => {
  it('sends one complete immutable import with exact score strings, positions and metadata', async () => {
    const f = fixture()
    expect(await f.run()).toEqual({ imported: 1, skipped: 0, errors: 0, total: 1, stopped: null })
    expect(f.rpcBodies).toHaveLength(1)
    expect(f.rpcBodies[0]).toEqual({ p_request_id: expect.any(String), p_metadata: { location: 'Table', bga_table_id: '#001' },
      p_positions: [1, 2], p_payload: { game_id: gameId, played_at: '2026-10-15', duration_minutes: 42,
        source: 'offline', notes: null, is_cooperative: false, team_won: null, scores: [
          { id: null, player_id: first, score: '9007199254740993.125', winner: true, color: null, role: null },
          { id: null, player_id: second, score: '-0.25', winner: false, color: null, role: null },
        ] } })
    expect(f.catalogCalls.map(call => call.table)).toEqual(['games', 'players'])
    expect(f.catalogCalls.find(call => call.table === 'games')?.filters).toEqual([])
    expect(f.catalogCalls.find(call => call.table === 'players')?.filters).toEqual([['user_id', actor]])
    expect(f.rows.get(actor)?.receiptBody).toBeDefined()
  })

  it('uses server skipped receipts for deduplication, rather than client table-id guesses', async () => {
    const f = fixture(); f.control.skipped = true
    expect(await f.run()).toMatchObject({ imported: 0, skipped: 1, stopped: null })
    expect(f.rpcBodies).toHaveLength(1)
    expect(f.catalogCalls.some(call => call.table === 'plays')).toBe(false)
  })

  it('resolves every participant before transmitting and never skips an unresolved name', async () => {
    const f = fixture(); f.players.length = 0
    let inserts = 0
    f.control.onCatalog = request => {
      if (request.operation === 'insert') { inserts++; if (inserts === 2) f.control.catalogError = true }
    }
    expect(await f.run()).toMatchObject({ imported: 0, stopped: 'catalog' })
    expect(inserts).toBe(2); expect(f.rpcBodies).toHaveLength(0)
    expect(f.catalogCalls.filter(call => call.operation === 'insert').every(call => call.table === 'players')).toBe(true)
  })

  it('keeps catalogue game creation separate from the complete atomic play import', async () => {
    const f = fixture(); f.games.length = 0
    const imageFetch = vi.fn(async () => new Response('<items></items>'))
    vi.stubGlobal('fetch', imageFetch)
    expect(await f.run()).toMatchObject({ imported: 1, stopped: null })
    expect(imageFetch).toHaveBeenCalledTimes(1)
    expect(f.catalogCalls.filter(call => call.operation === 'insert')).toEqual([
      expect.objectContaining({ table: 'games', value: { name: 'Game', bga_id: null, image_url: null } }),
    ])
    expect(f.rpcBodies[0]).toMatchObject({ p_payload: { game_id: newId } })
  })

  it('fails closed for an unreadable journal before queries or UUID generation', async () => {
    const f = fixture(); f.options.hasPendingSave = () => { throw new Error('Storage unavailable') }
    const random = vi.spyOn(crypto, 'randomUUID')
    expect(await f.run()).toMatchObject({ stopped: 'pending' })
    expect(f.catalogCalls).toHaveLength(0); expect(f.rpcBodies).toHaveLength(0)
    expect(random).not.toHaveBeenCalled(); random.mockRestore()
  })

  it.each([
    (p: BgaImportPlay) => { p.players[1].name = null },
    (p: BgaImportPlay) => { p.players[1].name = 'First' },
    (p: BgaImportPlay) => { p.players[1].position = '2junk' },
    (p: BgaImportPlay) => { p.players[1].position = 0 },
    (p: BgaImportPlay) => { p.players[1].score = 9007199254740992 },
    (p: BgaImportPlay) => { p.players[1].score = 1.25 },
    (p: BgaImportPlay) => { p.players[1].score = '1e999' },
    (p: BgaImportPlay) => { p.played_at = '2026-02-30' },
    (p: BgaImportPlay) => { p.played_at = '2026-10-15T00:00:00Z' },
    (p: BgaImportPlay) => { p.bga_table_id = 'invalid table id' },
  ])('rejects malformed input before catalogue writes or any play mutation (%#)', async change => {
    const f = fixture(); const input = play(); change(input)
    expect(await f.run([input])).toMatchObject({ imported: 0, errors: 1, stopped: null })
    expect(f.rpcBodies).toHaveLength(0)
    expect(f.catalogCalls.every(call => call.operation === 'select')).toBe(true)
  })

  it('accepts exact legacy integer scores and nullable scores/positions without inventing a zero', async () => {
    const f = fixture(); const input = play()
    input.players[0].score = 42; input.players[1].score = null; input.players[1].position = null
    expect(await f.run([input])).toMatchObject({ imported: 1 })
    expect(f.rpcBodies[0]).toMatchObject({ p_positions: [1, null], p_payload: { scores: [{ score: '42' }, { score: null }] } })
  })

  it('stops a batch after an uncertain response and reuses its persisted UUID only on explicit recovery', async () => {
    const f = fixture(); f.control.rpcStatus = 503
    const next = { ...play(), bga_table_id: '#002' }
    expect(await f.run([play(), next])).toEqual({ imported: 0, skipped: 0, errors: 0, total: 2, stopped: 'uncertain' })
    expect(f.rpcBodies).toHaveLength(1)
    const pending = f.rows.get(actor)!
    f.control.rpcStatus = 200
    const random = vi.spyOn(crypto, 'randomUUID')
    expect(await f.run([play(), next])).toMatchObject({ stopped: 'pending' })
    expect(random).not.toHaveBeenCalled()
    random.mockRestore()
    expect(f.rpcBodies).toHaveLength(1)
    expect(f.rows.get(actor)).toEqual(pending)
    expect(await f.writer.recover(actor)).toMatchObject({ kind: 'saved' })
    expect(f.rpcBodies).toHaveLength(2)
    expect(f.rpcBodies[1]).toEqual(f.rpcBodies[0])
  })

  it('continues only after a definitive data rejection, and stops after permission rejection', async () => {
    const f = fixture(); f.control.rpcStatus = 400
    expect(await f.run([play(), { ...play(), bga_table_id: '#002' }])).toMatchObject({ errors: 2, stopped: null })
    expect(f.rpcBodies).toHaveLength(2)
    const g = fixture(); g.control.rpcStatus = 403
    expect(await g.run([play(), play()])).toMatchObject({ errors: 1, stopped: 'session' })
    expect(g.rpcBodies).toHaveLength(1)
  })

  it.each(['account', 'role', 'offline'])('stops before catalogue writes when %s changes during a read', async change => {
    const f = fixture()
    f.control.onCatalog = () => {
      if (change === 'offline') f.deps.online = () => false
      else f.deps.session = vi.fn(async () => ({ actorId: change === 'account' ? second : actor, accessToken: 'token', admin: change !== 'role' }))
    }
    expect(await f.run()).toMatchObject({ stopped: 'session' })
    expect(f.rpcBodies).toHaveLength(0)
    expect(f.catalogCalls.every(call => call.operation === 'select')).toBe(true)
  })

  it('checks identity after catalogue insertion before constructing the play request', async () => {
    const f = fixture(); f.players.pop()
    f.control.onCatalog = request => {
      if (request.operation === 'insert') f.deps.session = vi.fn(async () => ({ actorId: second, accessToken: 'token', admin: true }))
    }
    expect(await f.run()).toMatchObject({ stopped: 'session' })
    expect(f.rpcBodies).toHaveLength(0)
  })

  it.each([false, true])('fails closed for catalogue query errors (%s)', async reject => {
    const f = fixture(); f.control.catalogError = !reject; f.control.catalogReject = reject
    expect(await f.run()).toMatchObject({ stopped: 'catalog' })
    expect(f.rpcBodies).toHaveLength(0)
    expect(JSON.stringify(f.hooks.onLog.mock.calls)).not.toContain('private')
  })

  it('does not choose one of several catalogue rows with the same name', async () => {
    const f = fixture(); f.players.push({ id: newId, name: 'First' })
    expect(await f.run()).toMatchObject({ errors: 1, imported: 0 })
    expect(f.rpcBodies).toHaveLength(0)
  })

  it('paginates catalogue reads beyond the PostgREST page size', async () => {
    const f = fixture()
    const target = f.players.pop()!
    f.players.push(...Array.from({ length: 1000 }, (_, index) => ({
      id: `00000000-0000-0000-0000-${String(index + 100).padStart(12, '0')}`, name: `Other ${index}`,
    })), target)
    expect(await f.run()).toMatchObject({ imported: 1 })
    expect(f.catalogCalls.filter(call => call.table === 'players').map(call => call.from)).toEqual([0, 1000])
    expect(f.catalogCalls.every(call => call.operation === 'select')).toBe(true)
  })

  it('copies inputs before any async session work', async () => {
    const f = fixture(); const input = play()
    const session = f.deps.session
    f.deps.session = vi.fn(async () => {
      input.players[0].score = '123'; input.bga_table_id = '#CHANGED'
      return session()
    })
    expect(await f.run([input])).toMatchObject({ imported: 1 })
    expect(f.rpcBodies[0]).toMatchObject({ p_metadata: { bga_table_id: '#001' },
      p_payload: { scores: [{ score: '9007199254740993.125' }, { score: '-0.25' }] } })
  })

  it('bounds a stalled Auth verification without touching the catalogues', async () => {
    vi.useFakeTimers()
    const f = fixture(); f.deps.session = () => new Promise(() => undefined)
    const running = f.run()
    await vi.advanceTimersByTimeAsync(30000)
    expect(await running).toMatchObject({ stopped: 'session' })
    expect(f.catalogCalls).toHaveLength(0); expect(f.rpcBodies).toHaveLength(0)
  })

  it('sends the complete import through a real loopback HTTP transport', async () => {
    const bodies: unknown[] = []
    const server = createServer((req, res) => {
      expect(req.method).toBe('POST'); expect(req.url).toBe('/rest/v1/rpc/import_bga_play_v1')
      let body = ''; req.on('data', chunk => { body += chunk }); req.on('end', () => {
        bodies.push(JSON.parse(body))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ play_id: playId, revision: 'v1:loopback', replayed: false, skipped: false }))
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port')
      const f = fixture(); f.deps.fetch = fetch
      f.options.writer = new AtomicPlayWriter(`http://127.0.0.1:${address.port}`, 'synthetic-key', f.deps)
      expect(await f.run()).toMatchObject({ imported: 1 })
      expect(bodies).toHaveLength(1)
      expect(bodies[0]).toMatchObject({ p_positions: [1, 2], p_payload: { scores: [
        { score: '9007199254740993.125', player_id: first }, { score: '-0.25', player_id: second },
      ] } })
    } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
  })
})
