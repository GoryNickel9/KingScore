import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { verifiedPlayWriterSession } from './playWriterSession'

const actor = '00000000-0000-0000-0000-000000000001'
function fixture() {
  const cached = { access_token: 'synthetic-token', expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: actor, app_metadata: { role: 'admin' }, user_metadata: { role: 'admin' } } }
  const verified = { id: actor, app_metadata: { role: 'admin' }, user_metadata: {} }
  const auth = {
    getSession: vi.fn(async () => ({ data: { session: cached }, error: null })),
    getUser: vi.fn(async () => ({ data: { user: verified }, error: null })),
  }
  const session = () => verifiedPlayWriterSession(auth as unknown as Pick<SupabaseClient['auth'], 'getSession' | 'getUser'>)
  return { auth, cached, verified, session }
}

describe('verified writer identity', () => {
  it('verifies the token and uses only verified app_metadata for admin permission', async () => {
    const f = fixture()
    expect(await f.session()).toEqual({ actorId: actor, accessToken: 'synthetic-token', admin: true })
    expect(f.auth.getUser).toHaveBeenCalledWith('synthetic-token')
    f.verified.app_metadata.role = 'user'
    expect(await f.session()).toMatchObject({ admin: false })
  })
  it('rejects expired credentials without contacting Auth', async () => {
    const f = fixture(); f.cached.expires_at = 1
    expect(await f.session()).toBeNull(); expect(f.auth.getUser).not.toHaveBeenCalled()
  })
  it('rejects a verified identity that differs from the current session', async () => {
    const f = fixture(); f.verified.id = 'another-account'
    expect(await f.session()).toBeNull()
  })
  it('rejects a token/account change while verification is pending', async () => {
    const f = fixture()
    f.auth.getSession.mockResolvedValueOnce({ data: { session: { ...f.cached } }, error: null })
    f.cached.access_token = 'new-token'
    expect(await f.session()).toBeNull()
  })
  it('propagates a verification transport failure to the fail-closed writer', async () => {
    const f = fixture(); f.auth.getUser.mockRejectedValueOnce(new TypeError('Offline'))
    await expect(f.session()).rejects.toThrow('Offline')
  })
  it('snapshots token and account even when the cached session object is mutated during verification', async () => {
    const f = fixture()
    f.auth.getUser.mockImplementationOnce(async () => {
      f.cached.access_token = 'changed-token'
      return { data: { user: f.verified }, error: null }
    })
    expect(await f.session()).toBeNull()
    expect(f.auth.getUser).toHaveBeenCalledWith('synthetic-token')
  })
})
