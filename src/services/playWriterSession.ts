import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlayWriterSession } from './atomicPlayWriter'

/** Auth verifies the token remotely; a cached user's role is never authorization. */
export async function verifiedPlayWriterSession(auth: Pick<SupabaseClient['auth'], 'getSession' | 'getUser'>): Promise<PlayWriterSession | null> {
  const initial = await auth.getSession()
  const session = initial.data.session
  if (initial.error || !session || !session.expires_at || session.expires_at * 1000 <= Date.now()) return null
  const token = session.access_token
  const actor = session.user.id
  const expires = session.expires_at
  const verified = await auth.getUser(token)
  if (verified.error || !verified.data.user || verified.data.user.id !== actor) return null
  const current = await auth.getSession()
  if (current.error || current.data.session?.access_token !== token ||
    current.data.session.user.id !== actor || expires * 1000 <= Date.now()) return null
  return { actorId: verified.data.user.id, accessToken: token,
    admin: verified.data.user.app_metadata.role === 'admin' }
}
