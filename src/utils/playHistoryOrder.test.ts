import { afterEach, describe, expect, it, vi } from 'vitest'
import { readPlayHistoryOrder, savePlayHistoryOrder } from './playHistoryOrder'

afterEach(() => vi.unstubAllGlobals())

describe('history order preference', () => {
  it.each([null, '', 'unknown', 'created_at'])('opens by insertion time for missing or invalid preference %s', stored => {
    vi.stubGlobal('localStorage', { getItem: () => stored })
    expect(readPlayHistoryOrder()).toBe('created_at')
  })

  it('preserves the explicit choice across page remounts and reloads', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
    expect(readPlayHistoryOrder()).toBe('created_at')
    savePlayHistoryOrder('played_at')
    expect(readPlayHistoryOrder()).toBe('played_at')
    savePlayHistoryOrder('created_at')
    expect(readPlayHistoryOrder()).toBe('created_at')
  })

  it('keeps history usable when browser storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('Storage blocked') },
      setItem: () => { throw new Error('Storage blocked') },
    })
    expect(readPlayHistoryOrder()).toBe('created_at')
    expect(() => savePlayHistoryOrder('played_at')).not.toThrow()
  })
})
