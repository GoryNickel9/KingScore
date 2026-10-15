import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayWriterSession } from './atomicPlayWriter'
import { preparePlaySave } from './playSaveRequests'

const mocks = vi.hoisted(() => ({
  auth: {},
  verified: vi.fn<(auth: unknown) => Promise<PlayWriterSession | null>>(),
  createClient: vi.fn<(...args: unknown[]) => object>(),
  fetch: vi.fn<typeof fetch>(),
}))
vi.mock('../lib/supabase', () => ({
  supabase: { auth: mocks.auth }, supabaseUrl: 'http://127.0.0.1:31987', supabaseAnonKey: 'synthetic-public-key',
}))
vi.mock('./playWriterSession', () => ({ verifiedPlayWriterSession: mocks.verified }))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))

const actor = '00000000-0000-0000-0000-000000000001'
const other = '00000000-0000-0000-0000-000000000002'
const play = '00000000-0000-0000-0000-000000000003'
const session = (accessToken = 'synthetic-token'): PlayWriterSession => ({ actorId: actor, admin: true, accessToken })
const request = () => preparePlaySave(actor, 'create_play_v1', {
  p_request_id: '00000000-0000-0000-0000-000000000004',
  p_payload: { game_id: other, played_at: '2026-10-15', duration_minutes: null, source: 'offline',
    notes: null, is_cooperative: false, team_won: null,
    scores: [{ id: null, player_id: actor, score: '9007199254740993.125', winner: false, color: null, role: null }] },
})
class MemoryStorage implements Storage {
  readonly rows = new Map<string, string>()
  get length() { return this.rows.size }
  clear() { this.rows.clear() }
  getItem(key: string) { return this.rows.get(key) ?? null }
  key(index: number) { return [...this.rows.keys()][index] ?? null }
  removeItem(key: string) { this.rows.delete(key) }
  setItem(key: string, value: string) { this.rows.set(key, value) }
}
let storage: MemoryStorage
let browser: { onLine: boolean; locks: LockManager | undefined }
async function factory(enabled: string | undefined = 'true') {
  vi.stubEnv('VITE_ATOMIC_PLAY_WRITES', enabled)
  return (await import('./browserPlayWrites')).browserPlayWrites()
}
function catalogToken() {
  return (mocks.createClient.mock.calls[0][2] as { accessToken: () => Promise<string> }).accessToken
}
beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  storage = new MemoryStorage()
  browser = { onLine: true, locks: { request: vi.fn(async (name: string, _options: LockOptions,
    callback: (lock: Lock | null) => unknown) => callback({ name, mode: 'exclusive' } as Lock)) } as unknown as LockManager }
  vi.stubGlobal('navigator', browser)
  vi.stubGlobal('window', { fetch: mocks.fetch, localStorage: storage })
  mocks.verified.mockResolvedValue(session())
  mocks.createClient.mockReturnValue({ catalog: true })
  mocks.fetch.mockImplementation(async () => new Response(JSON.stringify({ play_id: play, revision: 'rev1', replayed: false })))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('browser play-write boundary', () => {
  it.each([undefined, 'false', 'TRUE', '1'])('keeps writes disabled unless the flag is exactly true (%s)', async flag => {
    // Pass undefined explicitly rather than relying on the enabled factory default.
    vi.stubEnv('VITE_ATOMIC_PLAY_WRITES', flag)
    const { browserPlayWrites, atomicPlayWritesEnabled } = await import('./browserPlayWrites')
    const api = browserPlayWrites()
    expect(atomicPlayWritesEnabled).toBe(false)
    await expect(api.requireActor(actor)).rejects.toThrow()
    await expect(api.editor(actor, play)).rejects.toThrow()
    await expect(api.catalogClient(actor)).rejects.toThrow()
    await expect(api.writer.save(request())).rejects.toThrow()
    expect(mocks.verified).not.toHaveBeenCalled()
    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(storage.length).toBe(0)
  })

  it('blocks offline reads, catalog writes and mutation persistence before contacting Auth', async () => {
    const api = await factory()
    browser.onLine = false
    await expect(api.requireActor(actor)).rejects.toThrow()
    await expect(api.editor(actor, play)).rejects.toThrow()
    await expect(api.catalogClient(actor)).rejects.toThrow()
    await expect(api.writer.save(request())).rejects.toThrow()
    expect(mocks.verified).not.toHaveBeenCalled()
    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(storage.length).toBe(0)
  })

  it.each([null, { ...session(), admin: false }, { ...session(), actorId: other }])(
    'rejects missing, non-admin or mismatched identities before catalog creation or HTTP (%#)', async identity => {
      const api = await factory()
      mocks.verified.mockResolvedValue(identity)
      await expect(api.requireActor(actor)).rejects.toThrow()
      await expect(api.catalogClient(actor)).rejects.toThrow()
      await expect(api.writer.save(request())).rejects.toThrow()
      expect(mocks.createClient).not.toHaveBeenCalled()
      expect(mocks.fetch).not.toHaveBeenCalled()
      expect(storage.length).toBe(0)
    },
  )

  it('rechecks connectivity after a successful Auth response', async () => {
    const api = await factory()
    mocks.verified.mockImplementation(async () => { browser.onLine = false; return session() })
    await expect(api.catalogClient(actor)).rejects.toThrow()
    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('ends a stalled verification at 30 seconds and clears its timer', async () => {
    vi.useFakeTimers()
    const api = await factory()
    mocks.verified.mockImplementation(() => new Promise(() => undefined))
    const settled = vi.fn()
    const verification = api.requireActor(actor).finally(settled)
    const rejected = expect(verification).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(29_999)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await rejected
    expect(settled).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('clears the verification timer after both success and failure', async () => {
    vi.useFakeTimers()
    const api = await factory()
    await expect(api.requireActor(actor)).resolves.toEqual(session())
    expect(vi.getTimerCount()).toBe(0)
    mocks.verified.mockRejectedValueOnce(new TypeError('Synthetic Auth failure'))
    await expect(api.requireActor(actor)).rejects.toThrow('Synthetic Auth failure')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('binds catalog authorization to the actor and obtains the current token for every request', async () => {
    const api = await factory()
    await api.catalogClient(actor)
    expect(mocks.createClient).toHaveBeenCalledWith('http://127.0.0.1:31987', 'synthetic-public-key', {
      accessToken: expect.any(Function),
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const token = catalogToken()
    mocks.verified.mockResolvedValue(session('synthetic-refreshed-token'))
    await expect(token()).resolves.toBe('synthetic-refreshed-token')
    mocks.verified.mockResolvedValue(session('synthetic-next-token'))
    await expect(token()).resolves.toBe('synthetic-next-token')
    expect(mocks.verified).toHaveBeenCalledTimes(3)
    expect(mocks.verified).toHaveBeenLastCalledWith(mocks.auth)
    expect(storage.length).toBe(0)
  })

  it('cannot reuse a catalog token after account switch, role loss or disconnect', async () => {
    const api = await factory()
    await api.catalogClient(actor)
    const token = catalogToken()
    mocks.verified.mockResolvedValue({ ...session('other-account-token'), actorId: other })
    await expect(token()).rejects.toThrow()
    mocks.verified.mockResolvedValue({ ...session(), admin: false })
    await expect(token()).rejects.toThrow()
    mocks.verified.mockResolvedValue(session())
    browser.onLine = false
    await expect(token()).rejects.toThrow()
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(storage.length).toBe(0)
  })

  it('stores the original mutation and receipt without storing bearer tokens', async () => {
    const api = await factory()
    const input = request()
    expect(await api.writer.save(input)).toMatchObject({ kind: 'saved', restored: false })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.fetch.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer synthetic-token' })
    expect(storage.length).toBe(1)
    const persisted = storage.getItem(storage.key(0)!)!
    const record = JSON.parse(persisted) as Record<string, unknown>
    expect(Object.keys(record).sort()).toEqual(['actorId', 'body', 'receiptBody', 'rpc'])
    expect(record.body).toBe(input.body)
    expect(record.receiptBody).toBeDefined()
    expect(persisted).not.toContain('synthetic-token')
    expect(persisted).not.toContain('Authorization')
    expect(persisted).not.toContain('accessToken')
  })

  it('fails closed without cross-tab browser locks before Auth, persistence or HTTP', async () => {
    browser.locks = undefined
    const api = await factory()
    await expect(api.writer.inspect(actor)).rejects.toThrow('locks unavailable')
    await expect(api.writer.save(request())).rejects.toThrow('locks unavailable')
    await expect(api.writer.recover(actor)).rejects.toThrow('locks unavailable')
    expect(mocks.verified).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(storage.length).toBe(0)
  })

  it.each(['false', 'true'])('constructs without reading a denied localStorage getter (flag %s)', async flag => {
    const deniedStorage = vi.fn<() => Storage>(() => { throw new DOMException('Synthetic storage denial', 'SecurityError') })
    vi.stubGlobal('window', { fetch: mocks.fetch, get localStorage() { return deniedStorage() } })
    const api = await factory(flag)
    expect(api.writer).toBeDefined()
    expect(deniedStorage).not.toHaveBeenCalled()
    expect(mocks.verified).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
    if (flag === 'false') {
      await expect(api.requireActor(actor)).rejects.toThrow()
      await expect(api.editor(actor, play)).rejects.toThrow()
      await expect(api.catalogClient(actor)).rejects.toThrow()
      expect(deniedStorage).not.toHaveBeenCalled()
      expect(mocks.verified).not.toHaveBeenCalled()
      expect(mocks.fetch).not.toHaveBeenCalled()
    }
  })

  it('defers denied storage until a journal operation and fails closed without mutation HTTP', async () => {
    const denial = new DOMException('Synthetic storage denial', 'SecurityError')
    const deniedStorage = vi.fn<() => Storage>(() => { throw denial })
    vi.stubGlobal('window', { fetch: mocks.fetch, get localStorage() { return deniedStorage() } })
    const api = await factory()
    await expect(api.requireActor(actor)).resolves.toEqual(session())
    await expect(api.catalogClient(actor)).resolves.toEqual({ catalog: true })
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'PT404' }), { status: 404 }))
    await expect(api.editor(actor, play)).rejects.toMatchObject({ code: 'not-found' })
    expect(deniedStorage).not.toHaveBeenCalled()
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.fetch.mock.calls[0][0]).toContain('/rpc/get_play_editor_v1')
    mocks.fetch.mockClear()

    await expect(async () => api.writer.inspect(actor)).rejects.toBe(denial)
    await expect(async () => api.writer.save(request())).rejects.toBe(denial)
    await expect(async () => api.writer.recover(actor)).rejects.toBe(denial)
    expect(deniedStorage).toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(storage.length).toBe(0)
  })
})
