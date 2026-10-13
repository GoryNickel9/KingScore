import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/db'
import { createPlay, deletePlay, getPlayEditor, importBgaPlay, parseDurationInput, parseScoreInput, updatePlay } from './playWrites'

const actorId = '10000000-0000-0000-0000-000000000001'
const playId = '20000000-0000-0000-0000-000000000001'
const requestId = '30000000-0000-0000-0000-000000000001'
const playerId = '40000000-0000-0000-0000-000000000001'
const revision = 'v1:' + 'a'.repeat(64)
const payload = { game_id: playId, played_at: '2026-10-13', duration_minutes: 0, source: 'offline', notes: null,
  is_cooperative: false, team_won: null, scores: [{ id: null, player_id: playerId, score: '9007199254740993.125', winner: true, color: 'red', role: null }] }
const response = { play_id: playId, revision, replayed: false }
function fixture(value: unknown = response, error: unknown = null, status = 200) {
  const user = { id: actorId, app_metadata: { role: 'admin' } }
  const getSession = vi.fn().mockResolvedValue({ data: { session: { user, access_token: 'synthetic-test-token' } }, error: null })
  const getUser = vi.fn().mockResolvedValue({ data: { user }, error: null })
  const setHeader = vi.fn().mockImplementation(() => Promise.resolve({ data: value, error, status }))
  const rpc = vi.fn().mockImplementation(() => ({ setHeader }))
  const from = vi.fn(() => { throw new Error('No direct data writes permitted') })
  const client = { auth: { getSession, getUser }, rpc, from } as unknown as SupabaseClient<Database>
  return { client, rpc, from, getSession, getUser, setHeader }
}

describe('atomic play service', () => {
  it('preserves exact decimal text and null without prefix parsing', () => {
    expect(parseScoreInput('9007199254740993.125')).toBe('9007199254740993.125')
    expect(parseScoreInput(' -1.250 ')).toBe('-1.250')
    expect(parseScoreInput('')).toBeNull()
    expect(parseScoreInput(0)).toBe('0')
    for (const input of ['1point', '0x10', 'NaN', 'Infinity', '1e400', '1e-400']) expect(() => parseScoreInput(input)).toThrow()
    expect(parseDurationInput('0')).toBe(0)
    expect(parseDurationInput('')).toBeNull()
    for (const input of ['-1', '1.5', '2min', '2147483648']) expect(() => parseDurationInput(input)).toThrow()
  })
  it('sends one web RPC, preserving score metadata and binding the verified token', async () => {
    const f = fixture()
    expect(await createPlay(f.client, { actorId, requestId, payload })).toEqual(response)
    expect(f.getUser).toHaveBeenCalledWith('synthetic-test-token')
    expect(f.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer synthetic-test-token')
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith('create_web_play_v1', { p_request_id: requestId, p_payload: payload })
    expect(f.from).not.toHaveBeenCalled()
  })
  it('does not submit with a different account or an ordinary user', async () => {
    const f = fixture()
    f.getSession.mockResolvedValue({ data: { session: { user: { id: playerId }, access_token: 'other' } }, error: null })
    await expect(createPlay(f.client, { actorId, requestId, payload })).rejects.toMatchObject({ kind: 'permission' })
    expect(f.rpc).not.toHaveBeenCalled()
    f.getSession.mockResolvedValue({ data: { session: { user: { id: actorId }, access_token: 'same' } }, error: null })
    f.getUser.mockResolvedValue({ data: { user: { id: actorId, app_metadata: { role: 'user' } } }, error: null })
    await expect(createPlay(f.client, { actorId, requestId, payload })).rejects.toMatchObject({ kind: 'permission' })
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('distinguishes preflight connectivity failure from an ambiguous write', async () => {
    const f = fixture()
    f.getUser.mockRejectedValue(new Error('offline'))
    await expect(createPlay(f.client, { actorId, requestId, payload })).rejects.toMatchObject({ kind: 'unavailable' })
    expect(f.rpc).not.toHaveBeenCalled()
    f.getSession.mockRejectedValue(new Error('session lock failed'))
    await expect(createPlay(f.client, { actorId, requestId, payload })).rejects.toMatchObject({ kind: 'unavailable' })
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it.each([['PT409','conflict'],['PT404','missing'],['42501','permission'],['22023','validation'],['23503','validation'],['PGRST202','unavailable']])('maps %s without falling back', async (code, kind) => {
    const f = fixture(null, { code }, 400)
    await expect(updatePlay(f.client, { actorId, requestId, playId, revision, payload })).rejects.toMatchObject({ kind })
    expect(f.rpc).toHaveBeenCalledTimes(1); expect(f.from).not.toHaveBeenCalled()
  })
  it('reuses exactly the same request after an uncertain outcome, only on explicit invocation', async () => {
    const f = fixture({ ...response, replayed: true })
    f.setHeader.mockRejectedValueOnce(new Error('connection dropped'))
    const command = { actorId, requestId, payload }
    await expect(createPlay(f.client, command)).rejects.toMatchObject({ kind: 'unknown' })
    expect(f.rpc).toHaveBeenCalledTimes(1)
    expect(await createPlay(f.client, command)).toMatchObject({ replayed: true })
    expect(f.rpc.mock.calls[1]).toEqual(f.rpc.mock.calls[0])
  })
  it.each([null, {}, { ...response, revision: 'wrong' }, { ...response, replayed: 'true' }])('treats malformed success as uncertain', async value => {
    const f = fixture(value)
    await expect(createPlay(f.client, { actorId, requestId, payload })).rejects.toMatchObject({ kind: 'unknown' })
  })
  it('requires explicit deletion evidence for the requested play', async () => {
    const f = fixture({ play_id: playId, deleted: true, replayed: true })
    expect(await deletePlay(f.client, { actorId, requestId, playId, revision })).toEqual({ play_id: playId, deleted: true, replayed: true })
    f.setHeader.mockResolvedValue({ data: { play_id: playerId, deleted: true, replayed: false }, error: null, status: 200 })
    await expect(deletePlay(f.client, { actorId, requestId, playId, revision })).rejects.toMatchObject({ kind: 'unknown' })
  })
  it('validates input before authentication or mutation', async () => {
    const f = fixture()
    for (const invalidPayload of [{ ...payload, played_at: '2026-02-29' }, { ...payload, scores: [] },
      { ...payload, scores: [...payload.scores, ...payload.scores] }, { ...payload, duration_minutes: 1.5 }]) {
      await expect(createPlay(f.client, { actorId, requestId, payload: invalidPayload })).rejects.toMatchObject({ kind: 'validation' })
    }
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.getUser).not.toHaveBeenCalled()
  })
  it('uses a separate import contract for BGA metadata and external positions', async () => {
    const f = fixture({ ...response, skipped: true })
    const importPayload = { ...payload, scores: [{ ...payload.scores[0], score: 12.5 }] }
    const metadata = { location: 'BGA', bga_table_id: 'table-7' }
    expect(await importBgaPlay(f.client, { actorId, requestId, payload: importPayload, metadata, positions: [null] })).toMatchObject({ skipped: true })
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith('import_bga_play_v1', { p_request_id: requestId, p_payload: importPayload, p_metadata: metadata, p_positions: [null] })
  })
  it('reads exact score strings with the web getter, never the numeric Android getter', async () => {
    const value = { detail: { play: { id: playId, played_at: '2026-10-13', user_id: actorId, game_id: playId,
      duration_minutes: null, notes: null, source: 'offline', is_cooperative: false, team_won: null }, game: null,
      scores: [{ score: { id: requestId, play_id: playId, player_id: playerId, score: '9007199254740993.125', winner: true, color: null, role: null, position: 1 }, player: null }] }, revision }
    const f = fixture(value)
    expect((await getPlayEditor(f.client, playId, actorId)).detail.scores[0].score.score).toBe('9007199254740993.125')
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith('get_web_play_editor_v1', { p_play_id: playId })
    f.setHeader.mockResolvedValue({ data: { ...value, detail: { ...value.detail, scores: [{ ...value.detail.scores[0], score: { ...value.detail.scores[0].score, score: 12.5 } }] } }, error: null, status: 200 })
    await expect(getPlayEditor(f.client, playId, actorId)).rejects.toMatchObject({ kind: 'unknown' })
  })
})
