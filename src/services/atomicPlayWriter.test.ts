import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { AtomicPlayWriter, browserPlayJournal, type PendingPlaySave, type PlayWriterDependencies } from './atomicPlayWriter'
import { preparePlaySave } from './playSaveRequests'

const actor = '00000000-0000-0000-0000-000000000001'
const other = '00000000-0000-0000-0000-000000000002'
const play = '00000000-0000-0000-0000-000000000003'
const requestId = '00000000-0000-0000-0000-000000000004'
const create = () => preparePlaySave(actor, 'create_play_v1', { p_request_id: requestId, p_payload: {
  game_id: other, played_at: '2026-10-14', duration_minutes: 0, source: 'offline', notes: null,
  is_cooperative: false, team_won: null,
  scores: [{ id: null, player_id: actor, score: '9007199254740993.125', winner: false, color: null, role: null }],
} })
const success = () => new Response(JSON.stringify({ play_id: play, revision: 'rev1', replayed: false }))

function fixture() {
  const rows = new Map<string, PendingPlaySave>()
  const busy = new Set<string>()
  const deps: PlayWriterDependencies = {
    online: () => true,
    session: async () => ({ actorId: actor, accessToken: 'synthetic-token', admin: true }),
    fetch: vi.fn<typeof fetch>().mockImplementation(async () => success()),
    journal: {
      load: key => rows.get(key) ?? null,
      save: (key, value) => { rows.set(key, value) },
      clear: key => { rows.delete(key) },
    },
    lock: async (key, operation) => {
      if (busy.has(key)) throw new Error('Save already in progress')
      busy.add(key)
      try { return await operation() } finally { busy.delete(key) }
    },
  }
  return { rows, deps, writer: () => new AtomicPlayWriter('http://127.0.0.1:3000', 'synthetic-key', deps) }
}

describe('atomic mutation transport', () => {
  it('persists before sending the exact decimal body and persists a valid confirmation', async () => {
    const f = fixture(); const input = create()
    f.deps.fetch = vi.fn(async (_url, init) => {
      expect(f.rows.get(actor)?.body).toBe(input.body)
      expect(init?.body).toBe(input.body)
      expect(init?.redirect).toBe('error')
      expect(init?.credentials).toBe('omit')
      return success()
    })
    expect(await f.writer().save(input)).toEqual({ kind: 'saved', receipt: {
      playId: play, revision: 'rev1', replayed: false, skipped: false,
    }, restored: false })
    expect(f.rows.get(actor)?.receiptBody).toBeDefined()
    expect(f.deps.fetch).toHaveBeenCalledTimes(1)
  })

  it('retains UUID/body after a lost response and after a new writer instance', async () => {
    const f = fixture(); const input = create()
    f.deps.fetch = vi.fn().mockRejectedValueOnce(new TypeError('Lost response')).mockResolvedValueOnce(success())
    expect(await f.writer().save(input)).toEqual({ kind: 'uncertain' })
    expect(f.deps.fetch).toHaveBeenCalledTimes(1)
    await expect(f.writer().save(input)).rejects.toThrow('pending')
    const restarted = f.writer()
    expect((await restarted.pending(actor))?.body).toBe(input.body)
    expect(await restarted.recover(actor)).toMatchObject({ kind: 'saved' })
    expect(vi.mocked(f.deps.fetch).mock.calls[0][1]?.body).toBe(vi.mocked(f.deps.fetch).mock.calls[1][1]?.body)
  })

  it.each([400, 401, 403, 404])('accepts matching RPC rejection %s only on a first attempt', async status => {
    const f = fixture()
    f.deps.fetch = vi.fn(async () => new Response(JSON.stringify({ code: `PT${status}` }), { status }))
    expect(await f.writer().save(create())).toEqual({ kind: 'rejected', status })
    expect(f.rows.size).toBe(0)
    f.rows.set(actor, { actorId: actor, rpc: 'create_play_v1', body: create().body })
    expect(await f.writer().recover(actor)).toEqual({ kind: 'uncertain' })
    expect(f.rows.size).toBe(1)
  })

  it.each([409, 500, 503])('keeps a pending request for status %s, with no automatic retry', async status => {
    const f = fixture()
    f.deps.fetch = vi.fn(async () => new Response(JSON.stringify({ code: `PT${status}` }), { status, headers: { 'Retry-After': '0' } }))
    expect(await f.writer().save(create())).toEqual({ kind: 'uncertain' })
    expect(f.rows.size).toBe(1)
    expect(f.deps.fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    '{}', 'not JSON', JSON.stringify({ play_id: play, revision: 'rev1', replayed: 'false' }),
    JSON.stringify({ play_id: play, revision: 'rev1', replayed: false, extra: true }),
    JSON.stringify({ play_id: play, revision: 'bad revision', replayed: false }),
    'x'.repeat(32_769),
  ])('keeps uninterpretable success pending (%#)', async body => {
    const f = fixture(); f.deps.fetch = vi.fn(async () => new Response(body))
    expect(await f.writer().save(create())).toEqual({ kind: 'uncertain' })
    expect(f.rows.size).toBe(1)
  })

  it('does not trust a generic HTTP rejection as a database receipt', async () => {
    const f = fixture(); f.deps.fetch = vi.fn(async () => new Response('<html>Denied</html>', { status: 403 }))
    expect(await f.writer().save(create())).toEqual({ kind: 'uncertain' })
    expect(f.rows.size).toBe(1)
  })

  it('recognizes the candidate database permission error before any earlier uncertain attempt', async () => {
    const f = fixture(); f.deps.fetch = vi.fn(async () => new Response(JSON.stringify({ code: '42501' }), { status: 403 }))
    expect(await f.writer().save(create())).toEqual({ kind: 'rejected', status: 403 })
    expect(f.rows.size).toBe(0)
  })

  it('requires login, admin, matching account and Internet before persistence/HTTP', async () => {
    for (const session of [null, { actorId: actor, accessToken: 'token', admin: false }, { actorId: other, accessToken: 'token', admin: true }]) {
      const f = fixture(); f.deps.session = async () => session
      await expect(f.writer().save(create())).rejects.toThrow('account')
      expect(f.rows.size).toBe(0); expect(f.deps.fetch).not.toHaveBeenCalled()
    }
    const f = fixture(); f.deps.online = () => false
    await expect(f.writer().save(create())).rejects.toThrow('Internet')
    expect(f.rows.size).toBe(0); expect(f.deps.fetch).not.toHaveBeenCalled()
  })

  it('does not display an old account result or clear its journal after an account switch', async () => {
    const f = fixture()
    f.deps.fetch = vi.fn(async () => {
      f.deps.session = async () => ({ actorId: other, accessToken: 'new-token', admin: true })
      return success()
    })
    expect(await f.writer().save(create())).toEqual({ kind: 'uncertain' })
    expect(f.rows.size).toBe(1)
    await expect(f.writer().recover(actor)).rejects.toThrow('account')
    expect(f.deps.fetch).toHaveBeenCalledTimes(1)
  })

  it('blocks simultaneous writers sharing the actor lock', async () => {
    const f = fixture(); let finish!: (response: Response) => void
    let signalStarted!: () => void
    const started = new Promise<void>(resolve => { signalStarted = resolve })
    f.deps.fetch = vi.fn(() => { signalStarted(); return new Promise<Response>(resolve => { finish = resolve }) })
    const first = f.writer().save(create()); await started
    await expect(f.writer().save(create())).rejects.toThrow('progress')
    finish(success()); expect(await first).toMatchObject({ kind: 'saved' })
    expect(f.deps.fetch).toHaveBeenCalledTimes(1)
  })

  it('fails closed on unavailable or corrupt durable storage', async () => {
    const f = fixture(); f.deps.journal.save = () => { throw new Error('Quota exceeded') }
    await expect(f.writer().save(create())).rejects.toThrow('Quota')
    expect(f.deps.fetch).not.toHaveBeenCalled()
    f.rows.set(actor, { actorId: other, rpc: 'create_play_v1', body: create().body })
    await expect(f.writer().recover(actor)).rejects.toThrow('mismatch')
    expect(f.deps.fetch).not.toHaveBeenCalled()
  })

  it('retains an uncertain result when confirmation storage fails', async () => {
    const f = fixture(); const save = f.deps.journal.save
    f.deps.journal.save = (key, value) => {
      if (value.receiptBody !== undefined) throw new Error('Storage unavailable')
      save(key, value)
    }
    expect(await f.writer().save(create())).toEqual({ kind: 'uncertain' })
    expect(f.rows.size).toBe(1)
    expect(f.rows.get(actor)?.receiptBody).toBeUndefined()
  })

  it('checks delete target/deleted and BGA skipped response semantics', async () => {
    const f = fixture()
    const deleted = preparePlaySave(actor, 'delete_play_v1', { p_request_id: requestId, p_play_id: play, p_expected_revision: 'rev1' })
    f.deps.fetch = vi.fn(async () => new Response(JSON.stringify({ play_id: other, deleted: true, replayed: false })))
    expect(await f.writer().save(deleted)).toEqual({ kind: 'uncertain' })
    f.deps.fetch = vi.fn(async () => new Response(JSON.stringify({ play_id: play, deleted: true, replayed: true })))
    expect(await f.writer().recover(actor)).toMatchObject({ kind: 'saved', receipt: { revision: null, replayed: true } })
    const imported = preparePlaySave(actor, 'import_bga_play_v1', { p_request_id: other,
      p_payload: create().arguments().p_payload, p_metadata: { location: null, bga_table_id: 'table' }, p_positions: [null] })
    f.deps.fetch = vi.fn(async () => new Response(JSON.stringify({ play_id: play, revision: 'rev1', replayed: false, skipped: true })))
    expect(await f.writer().save(imported)).toMatchObject({ kind: 'saved', receipt: { skipped: true } })
  })

  it('restores a confirmed result after restart without a second mutation request', async () => {
    const f = fixture(); const input = create()
    expect(await f.writer().save(input)).toMatchObject({ kind: 'saved', restored: false })
    const restarted = f.writer()
    expect(await restarted.recover(actor)).toMatchObject({ kind: 'saved', restored: true })
    expect(await restarted.save(input)).toMatchObject({ kind: 'saved', restored: true })
    expect(f.deps.fetch).toHaveBeenCalledTimes(1)
    const changed = preparePlaySave(actor, 'create_play_v1', { ...input.arguments(),
      p_payload: { ...(input.arguments().p_payload as Record<string, unknown>), notes: 'Changed' } })
    await expect(restarted.save(changed)).rejects.toThrow('Request ID conflict')
    expect(f.deps.fetch).toHaveBeenCalledTimes(1)
  })

  it('allows a new explicit UUID after confirmation while retaining per-account safety', async () => {
    const f = fixture(); await f.writer().save(create())
    const input = preparePlaySave(actor, 'create_play_v1', { ...create().arguments(), p_request_id: other })
    expect(await f.writer().save(input)).toMatchObject({ kind: 'saved', restored: false })
    expect(f.deps.fetch).toHaveBeenCalledTimes(2)
    expect(f.rows.get(actor)?.body).toBe(input.body)
  })

  it('aborts a hung transport after 30 seconds without retrying', async () => {
    vi.useFakeTimers()
    try {
      const f = fixture()
      f.deps.fetch = vi.fn<typeof fetch>((_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')))
      }))
      const result = f.writer().save(create())
      await vi.advanceTimersByTimeAsync(30_000)
      expect(await result).toEqual({ kind: 'uncertain' })
      expect(f.rows.size).toBe(1); expect(f.deps.fetch).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })

  it('bounds stalled identity verification before sending or persisting anything', async () => {
    vi.useFakeTimers()
    try {
      const f = fixture(); f.deps.session = () => new Promise(() => {})
      const result = f.writer().save(create())
      const rejected = expect(result).rejects.toThrow('verification timed out')
      await vi.advanceTimersByTimeAsync(30_000)
      await rejected
      expect(f.rows.size).toBe(0); expect(f.deps.fetch).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('refuses a redirect on actual loopback HTTP, without reaching the redirected URL', async () => {
    let redirected = 0
    const server = createServer((req, res) => {
      if (req.url === '/redirected') { redirected++; res.end('{}'); return }
      res.writeHead(307, { Location: '/redirected' }); res.end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing loopback address')
      const f = fixture(); f.deps.fetch = fetch
      const writer = new AtomicPlayWriter(`http://127.0.0.1:${address.port}`, 'synthetic-key', f.deps)
      expect(await writer.save(create())).toEqual({ kind: 'uncertain' })
      expect(redirected).toBe(0); expect(f.rows.size).toBe(1)
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
  })
})

describe('browser journal', () => {
  it('persists only request data across adapters and namespaces it by backend/account', async () => {
    const data = new Map<string, string>()
    const storage = { getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } } as Storage
    const first = browserPlayJournal('local', storage, undefined as unknown as LockManager)
    first.journal.save(actor, { actorId: actor, rpc: 'create_play_v1', body: create().body })
    expect(browserPlayJournal('local', storage, undefined as unknown as LockManager).journal.load(actor)?.body).toBe(create().body)
    expect(browserPlayJournal('other-backend', storage, undefined as unknown as LockManager).journal.load(actor)).toBeNull()
    expect(first.journal.load(other)).toBeNull()
    expect([...data.values()].join()).not.toContain('synthetic-token')
    await expect(first.lock(actor, async () => 1)).rejects.toThrow('locks unavailable')
    data.set([...data.keys()][0], 'null')
    expect(() => first.journal.load(actor)).toThrow('Corrupt pending journal')
  })
})
