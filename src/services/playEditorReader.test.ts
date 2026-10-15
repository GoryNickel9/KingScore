import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPlayEditor, PlayEditorReadError } from './playEditorReader'
import type { PlayWriterDependencies } from './atomicPlayWriter'

const actor = '00000000-0000-0000-0000-000000000001'
const play = '00000000-0000-0000-0000-000000000002'
const game = '00000000-0000-0000-0000-000000000003'
const score = '00000000-0000-0000-0000-000000000004'
const other = '00000000-0000-0000-0000-000000000005'
function snapshot() {
  return { revision: `v1:${'a'.repeat(64)}`, editability: { editable: true, issues: [] as string[] }, detail: {
    play: { id: play, user_id: other, game_id: game, played_at: '2026-10-15', duration_minutes: null,
      source: 'online' as string | null, notes: 'note', location: 'location', bga_table_id: '001',
      is_cooperative: false as boolean | null, team_won: null as boolean | null, created_at: null, extra_metadata: { keep: true } },
    game: { id: game, name: 'Game', bga_id: null, image_url: null, min_players: null, max_players: null, created_at: null },
    scores: [{ score: { id: score, play_id: play, player_id: actor as string | null,
      score: '9007199254740993.125' as string | number | null, winner: false as boolean | null,
      color: 'red', role: 'leader', position: 1 },
    player: { id: actor, name: 'Player', user_id: null, account_user_id: null, alias: null, avatar_url: null,
      color: null, created_at: null, updated_at: '2026-10-15T00:00:00Z', is_me: null } as object | null }],
  } }
}
function fixture(value: unknown = snapshot()) {
  const deps: Pick<PlayWriterDependencies, 'session' | 'online' | 'fetch'> = {
    session: vi.fn(async () => ({ actorId: actor, accessToken: 'synthetic-token', admin: true })),
    online: () => true,
    fetch: vi.fn(async () => new Response(JSON.stringify(value))),
  }
  return { deps, read: (base = 'https://example.test', key = 'synthetic-key', user = actor, target = play) =>
    getPlayEditor(base, key, user, target, deps) }
}
afterEach(() => { vi.useRealTimers() })

describe('play editor snapshot reader', () => {
  it('reads only the RPC, verifies the account twice and preserves exact scores and metadata', async () => {
    const f = fixture()
    const result = await f.read()
    expect(result).toEqual(snapshot())
    expect(result.detail.scores[0].score.score).toBe('9007199254740993.125')
    expect(result.detail.play.user_id).toBe(other)
    expect(result.detail.play.extra_metadata).toEqual({ keep: true })
    expect(f.deps.session).toHaveBeenCalledTimes(2)
    expect(f.deps.fetch).toHaveBeenCalledExactlyOnceWith('https://example.test/rest/v1/rpc/get_play_editor_v1',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ p_play_id: play }),
        redirect: 'error', credentials: 'omit', cache: 'no-store', headers: {
          'Content-Type': 'application/json', apikey: 'synthetic-key', Authorization: 'Bearer synthetic-token',
        } }))
  })

  it('keeps unsupported historical data readable without normalizing it into editable data', async () => {
    const value = snapshot()
    value.editability = { editable: false, issues: ['nullable-mode', 'source-not-supported', 'score-outside-V1', 'date-outside-V1'] }
    value.detail.play.source = null; value.detail.play.is_cooperative = null
    value.detail.play.played_at = '10000-01-01'
    value.detail.scores[0].score.winner = null
    value.detail.scores[0].score.score = 'NaN'
    value.detail.scores = Array.from({ length: 64 }, (_, index) => ({ ...value.detail.scores[0],
      score: { ...value.detail.scores[0].score, id: `00000000-0000-0000-0000-${String(index + 100).padStart(12, '0')}` } }))
    const result = await fixture(value).read()
    expect(result).toEqual(value)
    expect(result.detail.scores).toHaveLength(64)
    expect(result.detail.scores[0].score.score).toBe('NaN')
  })

  it.each([
    ['http://remote.test', 'key', actor, play], ['https://user:pass@example.test', 'key', actor, play],
    ['https://example.test/path', 'key', actor, play], ['https://example.test?key=1', 'key', actor, play],
    ['https://example.test#fragment', 'key', actor, play], ['https://example.test', '', actor, play],
    ['https://example.test', 'key', 'bad', play], ['https://example.test', 'key', actor, 'bad'],
  ])('rejects invalid configuration before Auth or HTTP (%#)', async (base, key, user, target) => {
    const f = fixture()
    await expect(f.read(base, key, user, target)).rejects.toMatchObject({ code: 'invalid-request' })
    expect(f.deps.session).not.toHaveBeenCalled(); expect(f.deps.fetch).not.toHaveBeenCalled()
  })

  it('requires Internet and a remotely verified admin of the expected account', async () => {
    const f = fixture(); f.deps.online = () => false
    await expect(f.read()).rejects.toMatchObject({ code: 'offline' })
    expect(f.deps.session).not.toHaveBeenCalled()
    f.deps.online = () => true
    f.deps.session = vi.fn(async () => null)
    await expect(f.read()).rejects.toMatchObject({ code: 'unauthorized' })
    f.deps.session = vi.fn(async () => ({ actorId: other, accessToken: 'token', admin: true }))
    await expect(f.read()).rejects.toMatchObject({ code: 'unauthorized' })
    f.deps.session = vi.fn(async () => ({ actorId: actor, accessToken: 'token', admin: false }))
    await expect(f.read()).rejects.toMatchObject({ code: 'forbidden' })
    expect(f.deps.fetch).not.toHaveBeenCalled()
  })

  it.each(['account', 'admin', 'offline'])('discards a fetched snapshot after %s changes', async change => {
    const f = fixture()
    f.deps.fetch = vi.fn(async () => {
      if (change === 'offline') f.deps.online = () => false
      else f.deps.session = vi.fn(async () => ({ actorId: change === 'account' ? other : actor,
        accessToken: 'token', admin: change !== 'admin' }))
      return new Response(JSON.stringify(snapshot()))
    })
    await expect(f.read()).rejects.toBeInstanceOf(PlayEditorReadError)
    expect(f.deps.fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    [400, 'PT400', 'invalid-request'], [401, 'PGRST301', 'unauthorized'], [403, '42501', 'forbidden'],
    [404, 'PT404', 'not-found'], [404, 'PGRST202', 'unavailable'], [403, 'PT404', 'unavailable'],
    [500, 'PT500', 'unavailable'], [503, null, 'unavailable'],
  ])('maps only status/code pairs to safe errors (%#)', async (status, code, expected) => {
    const f = fixture()
    f.deps.fetch = vi.fn(async () => new Response(JSON.stringify({ code, message: 'PRIVATE SERVER DETAIL', details: 'secret' }), { status: status as number }))
    await expect(f.read()).rejects.toMatchObject({ code: expected, status, message: `Play editor: ${expected}` })
    expect(f.deps.fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    (v: ReturnType<typeof snapshot>) => { v.detail.play.id = other },
    (v: ReturnType<typeof snapshot>) => { v.detail.game.id = other },
    (v: ReturnType<typeof snapshot>) => { v.detail.scores[0].score.play_id = other },
    (v: ReturnType<typeof snapshot>) => { v.detail.scores[0].score.player_id = other },
    (v: ReturnType<typeof snapshot>) => { v.detail.scores.push(v.detail.scores[0]) },
    (v: ReturnType<typeof snapshot>) => { v.detail.scores[0].score.score = 123 },
    (v: ReturnType<typeof snapshot>) => { v.detail.scores[0].score.score = '1e100' },
    (v: ReturnType<typeof snapshot>) => { v.detail.scores[0].score.winner = null },
    (v: ReturnType<typeof snapshot>) => { v.detail.play.source = 'legacy' },
    (v: ReturnType<typeof snapshot>) => { v.revision = 'bad revision' },
    (v: ReturnType<typeof snapshot>) => { v.editability.editable = false },
    (v: ReturnType<typeof snapshot>) => { v.editability.issues = ['incompatible'] },
  ])('rejects malformed or wrongly editable snapshots (%#)', async mutate => {
    const value = snapshot(); mutate(value)
    await expect(fixture(value).read()).rejects.toMatchObject({ code: 'invalid-response' })
  })

  it.each(['{}', '[]', 'null', 'not JSON', 'x'.repeat(4 * 1024 * 1024 + 1)])('rejects malformed or oversized bodies (%#)', async body => {
    const f = fixture(); f.deps.fetch = vi.fn(async () => new Response(body))
    await expect(f.read()).rejects.toMatchObject({ code: 'invalid-response' })
    expect(f.deps.fetch).toHaveBeenCalledTimes(1)
  })

  it('bounds a hung session and does not send HTTP if it eventually resolves', async () => {
    vi.useFakeTimers()
    const f = fixture()
    let resume!: (value: Awaited<ReturnType<PlayWriterDependencies['session']>>) => void
    f.deps.session = () => new Promise(resolve => { resume = resolve })
    const assertion = expect(f.read()).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(30_000); await assertion
    resume({ actorId: actor, accessToken: 'synthetic-token', admin: true })
    await vi.advanceTimersByTimeAsync(1)
    expect(f.deps.fetch).not.toHaveBeenCalled()
  })

  it('bounds a response stream that never completes and cancels its reader', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const f = fixture(); f.deps.fetch = vi.fn(async () => new Response(new ReadableStream({ cancel })))
    const assertion = expect(f.read()).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(30_000); await assertion
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('reads an actual HTTP loopback response with the exact RPC request and no table access', async () => {
    let calls = 0
    const server = createServer((req, res) => {
      calls++
      expect(req.method).toBe('POST'); expect(req.url).toBe('/rest/v1/rpc/get_play_editor_v1')
      expect(req.headers.authorization).toBe('Bearer synthetic-token')
      let body = ''; req.on('data', chunk => { body += chunk }); req.on('end', () => {
        expect(body).toBe(JSON.stringify({ p_play_id: play }))
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(snapshot()))
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port')
      const f = fixture(); f.deps.fetch = fetch
      expect(await f.read(`http://127.0.0.1:${address.port}`)).toEqual(snapshot())
      expect(calls).toBe(1)
    } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
  })
})
