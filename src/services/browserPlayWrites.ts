import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/db'
import { supabase, supabaseUrl, supabaseAnonKey } from '../lib/supabase'
import { AtomicPlayWriter, browserPlayJournal, type PlayWriterSession, type PlayWriterDependencies } from './atomicPlayWriter'
import { verifiedPlayWriterSession } from './playWriterSession'
import { getPlayEditor } from './playEditorReader'

export const atomicPlayWritesEnabled = import.meta.env.VITE_ATOMIC_PLAY_WRITES === 'true'

export function browserPlayWrites() {
  // Storage can be denied even on public pages; fail only when an admin uses the journal.
  const browserJournal = () => browserPlayJournal(new URL(supabaseUrl).host, window.localStorage, navigator.locks)
  const journal: PlayWriterDependencies['journal'] = {
    load: actor => browserJournal().journal.load(actor),
    save: (actor, request) => browserJournal().journal.save(actor, request),
    clear: actor => browserJournal().journal.clear(actor),
  }
  const lock: PlayWriterDependencies['lock'] = (actor, operation) => browserJournal().lock(actor, operation)
  const dependencies = {
    session: async () => {
      if (!atomicPlayWritesEnabled || !navigator.onLine) return null
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([verifiedPlayWriterSession(supabase.auth), new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Account verification timed out')), 30_000)
        })])
      } finally { clearTimeout(timer) }
    },
    online: () => navigator.onLine,
    fetch: window.fetch.bind(window),
    journal, lock,
  }
  const requireActor = async (actor: string): Promise<PlayWriterSession> => {
    if (!atomicPlayWritesEnabled || !dependencies.online()) throw new Error('Salvataggi non disponibili. Verifica la connessione.')
    const session = await dependencies.session()
    if (!session?.admin || session.actorId !== actor || !dependencies.online()) throw new Error('Accedi nuovamente con un account amministratore.')
    return session
  }
  return {
    writer: new AtomicPlayWriter(supabaseUrl, supabaseAnonKey, dependencies),
    dependencies, requireActor,
    editor: async (actor: string, play: string) => {
      await requireActor(actor)
      return getPlayEditor(supabaseUrl, supabaseAnonKey, actor, play, dependencies)
    },
    catalogClient: async (actor: string) => {
      await requireActor(actor)
      // A concurrent login cannot substitute another account's token in a catalog write.
      return createClient<Database>(supabaseUrl, supabaseAnonKey, {
        accessToken: async () => (await requireActor(actor)).accessToken,
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
    },
  }
}
export type BrowserPlayWrites = ReturnType<typeof browserPlayWrites>
