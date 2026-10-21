import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitForCurrentGlobalElo } from './liveRead'
import { decodeEloRead } from './readModel'
import { ELO_ALGORITHM } from './algorithm'

const current = { scopeId: 'global', algorithm: ELO_ALGORITHM, status: 'current', sourceRevision: '2',
  publishedRevision: '2', publicationId: '00000000-0000-0000-0000-000000000001',
  result: { gamePlayers: {}, generalPlayers: {}, gameHistory: [], generalHistory: [], processedPlays: 0, skippedPlays: 0 } }
const stale = { ...current, status: 'stale', publishedRevision: '1', result: null }
const missing = { ...stale, status: 'missing', algorithm: null, publicationId: null, publishedRevision: null }
const ok = (data: unknown) => ({ data, error: null })
const signal = () => new AbortController()

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('automatic ELO publication refresh', () => {
  it('reads a current publication once and leaves no timer', async () => {
    const rpc = vi.fn().mockResolvedValue(ok(current))
    const update = vi.fn()
    expect((await waitForCurrentGlobalElo({ rpc }, update, signal().signal)).status).toBe('current')
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_elo_publication_v1')
    expect(update).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('refreshes missing/stale data until current, then stops', async () => {
    const rpc = vi.fn().mockResolvedValueOnce(ok(missing)).mockResolvedValueOnce(ok(stale)).mockResolvedValue(ok(current))
    const states: string[] = []
    const pending = waitForCurrentGlobalElo({ rpc }, read => states.push(read.status), signal().signal)
    await vi.advanceTimersByTimeAsync(2000)
    expect((await pending).publishedRevision).toBe('2')
    expect(states).toEqual(['missing', 'stale', 'current'])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(rpc).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reuses the initial snapshot without duplicating the first request', async () => {
    const rpc = vi.fn().mockResolvedValue(ok(current))
    const update = vi.fn()
    const pending = waitForCurrentGlobalElo({ rpc }, update, signal().signal, decodeEloRead(stale, 'global'))
    expect(update).toHaveBeenCalledTimes(1)
    expect(rpc).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    await pending
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('cancels timers on navigation without another request', async () => {
    const abort = signal()
    const rpc = vi.fn().mockResolvedValue(ok(stale))
    const pending = waitForCurrentGlobalElo({ rpc }, vi.fn(), abort.signal)
    const rejected = expect(pending).rejects.toHaveProperty('name', 'AbortError')
    await vi.advanceTimersByTimeAsync(10)
    abort.abort()
    await rejected
    await vi.advanceTimersByTimeAsync(10_000)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not update after an in-flight request resolves on a closed page', async () => {
    const abort = signal()
    let resolve!: (value: ReturnType<typeof ok>) => void
    const rpc = vi.fn(() => new Promise<ReturnType<typeof ok>>(done => { resolve = done }))
    const update = vi.fn()
    const pending = waitForCurrentGlobalElo({ rpc }, update, abort.signal)
    const rejected = expect(pending).rejects.toHaveProperty('name', 'AbortError')
    abort.abort()
    resolve(ok(current))
    await rejected
    expect(update).not.toHaveBeenCalled()
  })

  it('never overlaps requests when one read is slow', async () => {
    let resolve!: (value: ReturnType<typeof ok>) => void
    const rpc = vi.fn().mockImplementationOnce(() => new Promise(done => { resolve = done })).mockResolvedValue(ok(current))
    const pending = waitForCurrentGlobalElo({ rpc }, vi.fn(), signal().signal)
    await vi.advanceTimersByTimeAsync(5000)
    expect(rpc).toHaveBeenCalledTimes(1)
    resolve(ok(stale))
    await vi.advanceTimersByTimeAsync(1000)
    await pending
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('recovers two transient read errors, without re-running any save', async () => {
    const rpc = vi.fn().mockRejectedValueOnce(new Error('network')).mockRejectedValueOnce(new Error('network')).mockResolvedValue(ok(current))
    const update = vi.fn()
    const pending = waitForCurrentGlobalElo({ rpc }, update, signal().signal)
    await vi.advanceTimersByTimeAsync(2000)
    await pending
    expect(rpc).toHaveBeenCalledTimes(3)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('stops after three consecutive errors', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('network'))
    const pending = waitForCurrentGlobalElo({ rpc }, vi.fn(), signal().signal)
    const rejected = expect(pending).rejects.toThrow('network')
    await vi.advanceTimersByTimeAsync(2000)
    await rejected
    expect(rpc).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops polling after two minutes if the worker never finishes', async () => {
    const rpc = vi.fn().mockResolvedValue(ok(stale))
    const pending = waitForCurrentGlobalElo({ rpc }, vi.fn(), signal().signal)
    const rejected = expect(pending).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(120_000)
    await rejected
    expect(vi.getTimerCount()).toBe(0)
  })
})
