import type { AtomicPlayWriter, PlayWriteOutcome, PlaySaveReceipt } from './atomicPlayWriter'

export interface PlayWriteState {
  phase: 'checking' | 'ready' | 'busy' | 'pending' | 'unavailable'
  message: string
  confirmed: PlaySaveReceipt | null
}
export interface PlayWriteApi {
  writer: Pick<AtomicPlayWriter, 'inspect' | 'recover'>
  requireActor(actor: string): Promise<unknown>
}

/** Owns one mounted account's UI lifecycle; the writer owns cross-tab locking and durable recovery. */
export class PlayWriteCoordinator {
  private state: PlayWriteState = { phase: 'checking', message: '', confirmed: null }
  private generation = 0
  private closed = true
  private listeners = new Set<() => void>()
  constructor(readonly actor: string, private readonly api: PlayWriteApi, private readonly enabled: boolean) {}
  snapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(state: PlayWriteState) { this.state = state; this.listeners.forEach(listener => listener()) }
  close() { this.closed = true; this.generation++ }
  async initialize(): Promise<void> {
    const generation = ++this.generation
    this.closed = false
    if (!this.enabled) {
      this.update({ phase: 'unavailable', message: 'La gestione partite non è ancora disponibile in questo ambiente.', confirmed: null })
      return
    }
    this.update({ phase: 'checking', message: '', confirmed: null })
    try {
      await this.api.requireActor(this.actor)
      if (this.closed || generation !== this.generation) return
      const record = await this.api.writer.inspect(this.actor)
      if (this.closed || generation !== this.generation) return
      this.update({ phase: record && !record.confirmed ? 'pending' : 'ready', message: '', confirmed: record?.confirmed ?? null })
    } catch {
      if (!this.closed && generation === this.generation) this.update({ phase: 'unavailable',
        message: 'Impossibile verificare account e salvataggi. Controlla la connessione e accedi come amministratore.', confirmed: null })
    }
  }
  async run<T>(operation: (current: () => boolean) => Promise<T>, recovery = false): Promise<T | null> {
    if (this.closed || (this.state.phase !== 'ready' && !(recovery && this.state.phase === 'pending'))) return null
    const generation = this.generation
    this.update({ ...this.state, phase: 'busy', message: '' })
    try {
      await this.api.requireActor(this.actor)
      const current = () => !this.closed && generation === this.generation
      if (!current()) return null
      const value = await operation(current)
      if (!current()) return null
      const record = await this.api.writer.inspect(this.actor)
      if (this.closed || generation !== this.generation) return null
      this.update({ phase: record && !record.confirmed ? 'pending' : 'ready', message: '', confirmed: record?.confirmed ?? null })
      return value
    } catch {
      if (!this.closed && generation === this.generation) {
        // Recheck durable state before allowing a new UUID after any thrown error.
        try {
          const record = await this.api.writer.inspect(this.actor)
          if (this.closed || generation !== this.generation) return null
          this.update({ phase: record && !record.confirmed ? 'pending' : 'ready', confirmed: record?.confirmed ?? null,
            message: 'Operazione interrotta. Verifica connessione, account e dati inseriti prima di riprovare.' })
        } catch {
          if (!this.closed && generation === this.generation) this.update({ phase: 'unavailable', confirmed: null,
            message: 'Impossibile verificare l’esito. Controlla la connessione e verifica il salvataggio prima di riprovare.' })
        }
      }
      return null
    }
  }
  recover(): Promise<PlayWriteOutcome | null> { return this.run(() => this.api.writer.recover(this.actor), true) }
}
