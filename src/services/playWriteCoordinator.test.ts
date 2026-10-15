import { describe, expect, it, vi } from 'vitest'
import type { PlaySaveReceipt } from './atomicPlayWriter'
import { preparePlaySave } from './playSaveRequests'
import { PlayWriteCoordinator, type PlayWriteApi } from './playWriteCoordinator'

const actor = '00000000-0000-0000-0000-000000000001'
const request = preparePlaySave(actor, 'create_play_v1', {
  p_request_id: '00000000-0000-0000-0000-000000000002',
  p_payload: {
    game_id: '00000000-0000-0000-0000-000000000003', played_at: '2026-10-15',
    duration_minutes: null, source: 'offline', notes: null, is_cooperative: false, team_won: null,
    scores: [{ id: null, player_id: actor, score: '9007199254740993.125', winner: false, color: null, role: null }],
  },
})
const receipt: PlaySaveReceipt = {
  playId: '00000000-0000-0000-0000-000000000004', revision: 'v1:confirmed', replayed: false, skipped: false,
}
type Record = Awaited<ReturnType<PlayWriteApi['writer']['inspect']>>

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

function fixture(enabled = true) {
  let record: Record = null
  const requireActor = vi.fn<PlayWriteApi['requireActor']>().mockResolvedValue(undefined)
  const inspect = vi.fn<PlayWriteApi['writer']['inspect']>().mockImplementation(async () => record)
  const recover = vi.fn<PlayWriteApi['writer']['recover']>().mockResolvedValue({ kind: 'uncertain' })
  const api: PlayWriteApi = { requireActor, writer: { inspect, recover } }
  return { requireActor, inspect, recover, coordinator: new PlayWriteCoordinator(actor, api, enabled),
    setRecord: (next: Record) => { record = next } }
}

describe('play write UI lifecycle', () => {
  it.each(['empty', 'pending', 'confirmed'] as const)('boots from the %s durable state without sending requests', async kind => {
    const f = fixture()
    if (kind !== 'empty') f.setRecord({ request, confirmed: kind === 'confirmed' ? receipt : null })
    await f.coordinator.initialize()
    expect(f.coordinator.snapshot()).toEqual({
      phase: kind === 'pending' ? 'pending' : 'ready', message: '', confirmed: kind === 'confirmed' ? receipt : null,
    })
    expect(f.requireActor).toHaveBeenCalledExactlyOnceWith(actor)
    expect(f.inspect).toHaveBeenCalledExactlyOnceWith(actor)
    expect(f.recover).not.toHaveBeenCalled()
  })

  it('keeps disabled writes unavailable without touching Auth or the journal', async () => {
    const f = fixture(false)
    await f.coordinator.initialize()
    const operation = vi.fn().mockResolvedValue('saved')
    expect(f.coordinator.snapshot().phase).toBe('unavailable')
    expect(await f.coordinator.run(operation)).toBeNull()
    expect(await f.coordinator.recover()).toBeNull()
    expect(f.requireActor).not.toHaveBeenCalled()
    expect(f.inspect).not.toHaveBeenCalled()
    expect(f.recover).not.toHaveBeenCalled()
    expect(operation).not.toHaveBeenCalled()
  })

  it.each(['auth', 'inspection'] as const)('fails closed when boot %s fails', async failure => {
    const f = fixture()
    if (failure === 'auth') f.requireActor.mockRejectedValue(new Error('Account changed'))
    else f.inspect.mockRejectedValue(new Error('Unreadable journal'))
    await f.coordinator.initialize()
    expect(f.coordinator.snapshot()).toMatchObject({ phase: 'unavailable', confirmed: null })
    const operation = vi.fn().mockResolvedValue('saved')
    expect(await f.coordinator.run(operation)).toBeNull()
    expect(operation).not.toHaveBeenCalled()
    expect(f.recover).not.toHaveBeenCalled()
    if (failure === 'auth') expect(f.inspect).not.toHaveBeenCalled()
  })

  it('latches synchronously before Auth so a double click runs only one operation', async () => {
    const f = fixture()
    await f.coordinator.initialize()
    const auth = deferred<unknown>()
    f.requireActor.mockReturnValueOnce(auth.promise)
    const operation = vi.fn().mockResolvedValue('saved')
    const first = f.coordinator.run(operation)
    expect(f.coordinator.snapshot().phase).toBe('busy')
    expect(await f.coordinator.run(operation)).toBeNull()
    expect(operation).not.toHaveBeenCalled()
    auth.resolve(undefined)
    expect(await first).toBe('saved')
    expect(operation).toHaveBeenCalledTimes(1)
    expect(f.requireActor).toHaveBeenCalledTimes(2)
    expect(f.coordinator.snapshot().phase).toBe('ready')
  })

  it.each([false, true])('rechecks durable state after an error, persisted=%s', async persisted => {
    const f = fixture()
    await f.coordinator.initialize()
    const operation = vi.fn(async () => {
      if (persisted) f.setRecord({ request, confirmed: null })
      throw new Error(persisted ? 'Lost response' : 'Invalid form')
    })
    expect(await f.coordinator.run(operation)).toBeNull()
    expect(f.coordinator.snapshot().phase).toBe(persisted ? 'pending' : 'ready')
    expect(f.coordinator.snapshot().message).not.toBe('')
    expect(f.inspect).toHaveBeenCalledTimes(2)
    expect(operation).toHaveBeenCalledTimes(1)
    expect(f.recover).not.toHaveBeenCalled()
    if (persisted) {
      expect(await f.coordinator.run(operation)).toBeNull()
      expect(operation).toHaveBeenCalledTimes(1)
    }
  })

  it('retains a durable confirmation when presentation fails after the commit', async () => {
    const f = fixture()
    await f.coordinator.initialize()
    expect(await f.coordinator.run(async () => {
      f.setRecord({ request, confirmed: receipt })
      throw new Error('Presentation interrupted')
    })).toBeNull()
    expect(f.coordinator.snapshot()).toMatchObject({ phase: 'ready', confirmed: receipt })
    expect(f.recover).not.toHaveBeenCalled()
  })

  it('blocks further operations if durable inspection fails after an error', async () => {
    const f = fixture()
    await f.coordinator.initialize()
    f.inspect.mockRejectedValue(new Error('Storage denied'))
    const operation = vi.fn().mockRejectedValue(new Error('Interrupted'))
    expect(await f.coordinator.run(operation)).toBeNull()
    expect(f.coordinator.snapshot()).toMatchObject({ phase: 'unavailable', confirmed: null })
    expect(await f.coordinator.run(operation)).toBeNull()
    expect(await f.coordinator.recover()).toBeNull()
    expect(operation).toHaveBeenCalledTimes(1)
    expect(f.recover).not.toHaveBeenCalled()
  })

  it('withholds a returned value if it cannot inspect the resulting journal', async () => {
    const f = fixture()
    await f.coordinator.initialize()
    f.inspect.mockRejectedValue(new Error('Storage inaccessible'))
    const operation = vi.fn().mockResolvedValue('response received')
    expect(await f.coordinator.run(operation)).toBeNull()
    expect(f.coordinator.snapshot().phase).toBe('unavailable')
    expect(operation).toHaveBeenCalledTimes(1)
    expect(f.recover).not.toHaveBeenCalled()
  })

  it('only explicitly recovers through the writer and keeps an uncertain request blocked', async () => {
    const f = fixture()
    f.setRecord({ request, confirmed: null })
    await f.coordinator.initialize()
    expect(f.recover).not.toHaveBeenCalled()
    const operation = vi.fn().mockResolvedValue('new UUID')
    expect(await f.coordinator.run(operation)).toBeNull()
    expect(await f.coordinator.recover()).toEqual({ kind: 'uncertain' })
    expect(f.recover).toHaveBeenCalledExactlyOnceWith(actor)
    expect(f.coordinator.snapshot().phase).toBe('pending')
    expect(operation).not.toHaveBeenCalled()
  })

  it('restores a successful recovery from the writer confirmation', async () => {
    const f = fixture()
    f.setRecord({ request, confirmed: null })
    await f.coordinator.initialize()
    f.recover.mockImplementationOnce(async () => {
      f.setRecord({ request, confirmed: receipt })
      return { kind: 'saved', receipt, restored: true }
    })
    expect(await f.coordinator.recover()).toEqual({ kind: 'saved', receipt, restored: true })
    expect(f.coordinator.snapshot()).toEqual({ phase: 'ready', message: '', confirmed: receipt })
    expect(f.recover).toHaveBeenCalledTimes(1)
  })

  it('does not retry a failed recovery automatically', async () => {
    const f = fixture()
    f.setRecord({ request, confirmed: null })
    await f.coordinator.initialize()
    f.recover.mockRejectedValue(new Error('Disconnected'))
    expect(await f.coordinator.recover()).toBeNull()
    expect(f.coordinator.snapshot().phase).toBe('pending')
    expect(f.recover).toHaveBeenCalledTimes(1)
  })

  it('does not start a mutation after unmount or account change during Auth verification', async () => {
    const f = fixture()
    await f.coordinator.initialize()
    const auth = deferred<unknown>()
    f.requireActor.mockReturnValueOnce(auth.promise)
    const operation = vi.fn().mockResolvedValue('late save')
    const running = f.coordinator.run(operation)
    f.coordinator.close()
    const closedState = f.coordinator.snapshot()
    auth.resolve(undefined)
    expect(await running).toBeNull()
    expect(operation).not.toHaveBeenCalled()
    expect(f.coordinator.snapshot()).toBe(closedState)
    expect(await f.coordinator.run(operation)).toBeNull()
  })

  it('does not deliver a completed in-flight result to an unmounted consumer', async () => {
    const f = fixture()
    await f.coordinator.initialize()
    const entered = deferred<void>()
    const response = deferred<string>()
    const running = f.coordinator.run(() => { entered.resolve(undefined); return response.promise })
    await entered.promise
    f.coordinator.close()
    const closedState = f.coordinator.snapshot()
    const listener = vi.fn()
    f.coordinator.subscribe(listener)
    f.setRecord({ request, confirmed: receipt })
    response.resolve('saved before unmount')
    expect(await running).toBeNull()
    expect(f.coordinator.snapshot()).toBe(closedState)
    expect(listener).not.toHaveBeenCalled()
  })

  it('ignores a late initialization after StrictMode cleanup and reinitialization', async () => {
    const f = fixture()
    const oldRecord = deferred<Record>()
    const inspectionStarted = deferred<void>()
    f.inspect.mockImplementationOnce(() => { inspectionStarted.resolve(undefined); return oldRecord.promise })
    const firstBoot = f.coordinator.initialize()
    await inspectionStarted.promise
    f.coordinator.close()
    await f.coordinator.initialize()
    expect(f.coordinator.snapshot().phase).toBe('ready')
    const currentState = f.coordinator.snapshot()
    oldRecord.resolve({ request, confirmed: null })
    await firstBoot
    expect(f.coordinator.snapshot()).toBe(currentState)
  })

  it('ignores a stale initialization failure after a newer initialization succeeds', async () => {
    const f = fixture()
    const oldAuth = deferred<unknown>()
    f.requireActor.mockReturnValueOnce(oldAuth.promise)
    const firstBoot = f.coordinator.initialize()
    await f.coordinator.initialize()
    const currentState = f.coordinator.snapshot()
    oldAuth.reject(new Error('Old connection failed'))
    await firstBoot
    expect(f.coordinator.snapshot()).toBe(currentState)
    expect(f.coordinator.snapshot().phase).toBe('ready')
  })

  it('invalidates an operation awaiting Auth when a new lifecycle is initialized', async () => {
    const f = fixture()
    await f.coordinator.initialize()
    const oldAuth = deferred<unknown>()
    f.requireActor.mockReturnValueOnce(oldAuth.promise)
    const operation = vi.fn().mockResolvedValue('stale mutation')
    const running = f.coordinator.run(operation)
    f.coordinator.close()
    await f.coordinator.initialize()
    const currentState = f.coordinator.snapshot()
    oldAuth.resolve(undefined)
    expect(await running).toBeNull()
    expect(operation).not.toHaveBeenCalled()
    expect(f.coordinator.snapshot()).toBe(currentState)
  })

  it('unsubscribes exactly one consumer without silencing the remaining consumer', async () => {
    const f = fixture()
    const removed = vi.fn()
    const remaining = vi.fn()
    const unsubscribe = f.coordinator.subscribe(removed)
    f.coordinator.subscribe(remaining)
    unsubscribe()
    unsubscribe()
    await f.coordinator.initialize()
    expect(removed).not.toHaveBeenCalled()
    expect(remaining).toHaveBeenCalledTimes(2)
    expect(f.coordinator.snapshot()).toBe(f.coordinator.snapshot())
  })
})
