import { preparePlaySave, type PreparedPlaySave, type PlaySaveRpc } from './playSaveRequests'

export interface PlayWriterSession { actorId: string; accessToken: string; admin: boolean }
export interface PendingPlaySave { actorId: string; rpc: PlaySaveRpc; body: string }
export interface PlaySaveReceipt { playId: string; revision: string | null; replayed: boolean; skipped: boolean }
export type PlayWriteOutcome =
  | { kind: 'saved'; receipt: PlaySaveReceipt }
  | { kind: 'rejected'; status: number }
  | { kind: 'uncertain' }

export interface PlayWriterDependencies {
  /** Must verify identity with Auth, rather than trusting decoded JWT/user_metadata. */
  session(): Promise<PlayWriterSession | null>
  online(): boolean
  fetch: typeof fetch
  journal: {
    load(actor: string): PendingPlaySave | null
    save(actor: string, request: PendingPlaySave): void
    clear(actor: string): void
  }
  /** Exclusive across tabs; fail closed when a lock is unavailable. */
  lock<T>(actor: string, operation: () => Promise<T>): Promise<T>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function receipt(value: unknown, request: PreparedPlaySave): PlaySaveReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid receipt')
  const row = value as Record<string, unknown>
  const deletion = request.rpc === 'delete_play_v1'
  const imported = request.rpc === 'import_bga_play_v1'
  const keys = deletion ? ['play_id', 'deleted', 'replayed'] : imported
    ? ['play_id', 'revision', 'replayed', 'skipped'] : ['play_id', 'revision', 'replayed']
  if (Object.keys(row).length !== keys.length || !keys.every(key => Object.prototype.hasOwnProperty.call(row, key)) ||
    typeof row.play_id !== 'string' || !UUID.test(row.play_id) ||
    (request.playId !== null && row.play_id.toLowerCase() !== request.playId.toLowerCase()) ||
    typeof row.replayed !== 'boolean' || (deletion && row.deleted !== true) ||
    (imported && typeof row.skipped !== 'boolean') || (!deletion &&
      (typeof row.revision !== 'string' || row.revision.length > 160 || !/^[!-~]+$/.test(row.revision)))) {
    throw new Error('Invalid receipt')
  }
  return { playId: row.play_id, revision: deletion ? null : row.revision as string,
    replayed: row.replayed, skipped: imported && row.skipped === true }
}

async function responseValue(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Empty response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 32_768) throw new Error('Receipt exceeds limit')
      chunks.push(chunk.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } finally { await reader.cancel(); reader.releaseLock() }
}

/** Mutation transport only. Pages remain on the existing path until RPC rollout is authorized. */
export class AtomicPlayWriter {
  private readonly base: string
  constructor(baseUrl: string, private readonly apiKey: string, private readonly dependencies: PlayWriterDependencies) {
    const url = new URL(baseUrl)
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/' || !apiKey) {
      throw new Error('Invalid RPC configuration')
    }
    this.base = url.origin
  }

  private async requireSession(actor: string): Promise<PlayWriterSession> {
    if (!this.dependencies.online()) throw new Error('Internet required')
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Account verification timed out')), 30_000)
    })
    let session: PlayWriterSession | null
    try { session = await Promise.race([this.dependencies.session(), deadline]) }
    finally { clearTimeout(timer) }
    if (!session || session.actorId.toLowerCase() !== actor || !session.admin || !session.accessToken) {
      throw new Error('Verified admin account required')
    }
    if (!this.dependencies.online()) throw new Error('Internet required')
    return session
  }

  pending(actorId: string): Promise<PreparedPlaySave | null> {
    const actor = actorId.toLowerCase()
    return this.dependencies.lock(actor, async () => {
      await this.requireSession(actor)
      const pending = this.dependencies.journal.load(actor)
      return pending ? this.restore(actor, pending) : null
    })
  }

  private restore(actor: string, pending: PendingPlaySave): PreparedPlaySave {
    if (pending.actorId !== actor) throw new Error('Pending account mismatch')
    const request = preparePlaySave(actor, pending.rpc, JSON.parse(pending.body))
    if (request.requestId === null || request.body !== pending.body) throw new Error('Invalid pending mutation')
    return request
  }

  save(input: PreparedPlaySave): Promise<PlayWriteOutcome> {
    // Revalidate even if a caller forges the TypeScript interface.
    const request = this.restore(input.actorId.toLowerCase(), input)
    return this.dependencies.lock(request.actorId, async () => {
      await this.requireSession(request.actorId)
      if (this.dependencies.journal.load(request.actorId)) throw new Error('Resolve pending save first')
      this.dependencies.journal.save(request.actorId, { actorId: request.actorId, rpc: request.rpc, body: request.body })
      const stored = this.dependencies.journal.load(request.actorId)
      if (!stored || this.restore(request.actorId, stored).body !== request.body || stored.rpc !== request.rpc) {
        throw new Error('Pending save not persisted')
      }
      return this.send(request, false)
    })
  }

  /** Explicit user recovery; never generate another UUID or use the current form. */
  recover(actorId: string): Promise<PlayWriteOutcome> {
    const actor = actorId.toLowerCase()
    return this.dependencies.lock(actor, async () => {
      await this.requireSession(actor)
      const stored = this.dependencies.journal.load(actor)
      if (!stored) throw new Error('No pending save')
      return this.send(this.restore(actor, stored), true)
    })
  }

  private async send(request: PreparedPlaySave, recovery: boolean): Promise<PlayWriteOutcome> {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 30_000)
    try {
      const session = await this.requireSession(request.actorId)
      const response = await this.dependencies.fetch(`${this.base}/rest/v1/rpc/${request.rpc}`, {
        method: 'POST', body: request.body, signal: abort.signal, redirect: 'error',
        credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', apikey: this.apiKey, Authorization: `Bearer ${session.accessToken}` },
      })
      const value = await responseValue(response)
      await this.requireSession(request.actorId)
      if (response.status === 200) {
        const parsed = receipt(value, request)
        this.dependencies.journal.clear(request.actorId)
        return { kind: 'saved', receipt: parsed }
      }
      // A rejection during recovery cannot disprove an earlier committed save.
      // Keep 409 too: a reused UUID may refer to an existing receipt with different content.
      const code = value && typeof value === 'object' && 'code' in value ? value.code : null
      const rejected = code === `PT${response.status}` || (response.status === 403 && code === '42501')
      if (!recovery && [400, 401, 403, 404].includes(response.status) && rejected) {
        this.dependencies.journal.clear(request.actorId)
        return { kind: 'rejected', status: response.status }
      }
      return { kind: 'uncertain' }
    } catch {
      // Includes timeout, account switch, malformed success and failed journal cleanup.
      return { kind: 'uncertain' }
    } finally { clearTimeout(timer) }
  }
}

/** Local browser receipt journal; contains form data, never bearer tokens. */
export function browserPlayJournal(namespace: string, storage: Storage, locks: LockManager): Pick<PlayWriterDependencies, 'journal' | 'lock'> {
  const key = (actor: string) => `kingscore:atomic:v1:${namespace}:${actor}`
  return {
    journal: {
      load: actor => {
        const body = storage.getItem(key(actor))
        if (body === null) return null
        const value: unknown = JSON.parse(body)
        if (!value || typeof value !== 'object' || Array.isArray(value) ||
          Object.keys(value).length !== 3 || !('actorId' in value) || !('rpc' in value) || !('body' in value) ||
          value.actorId !== actor || typeof value.rpc !== 'string' || typeof value.body !== 'string') {
          throw new Error('Corrupt pending journal')
        }
        return value as PendingPlaySave
      },
      save: (actor, request) => storage.setItem(key(actor), JSON.stringify(request)),
      clear: actor => {
        storage.removeItem(key(actor))
        if (storage.getItem(key(actor)) !== null) throw new Error('Pending cleanup failed')
      },
    },
    lock: async (actor, operation) => {
      if (!locks) throw new Error('Browser save locks unavailable')
      return await locks.request(key(actor), { ifAvailable: true }, lock => {
        if (!lock) throw new Error('Save already in progress')
        return operation()
      })
    },
  }
}
