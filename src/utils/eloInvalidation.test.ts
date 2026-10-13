import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/db'
import { invalidateELOHistory } from './eloCalculator'

function fixture(owner: string | null = 'owner') {
  const filters: [string, unknown][][] = []
  const from = vi.fn((table: string) => {
    if (table === 'plays') return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { game_id: 'game', user_id: owner }, error: null }) }) }) }
    const calls: [string, unknown][] = []; filters.push(calls)
    const builder = { eq: (key: string, value: unknown) => { calls.push([key, value]); return builder },
      then: (done: (value: { error: null }) => unknown) => Promise.resolve({ error: null }).then(done) }
    return { delete: () => builder }
  })
  return { client: { from } as unknown as SupabaseClient<Database>, from, filters }
}
describe('web ELO invalidation scope', () => {
  it('uses historical owner on both game and general histories even for a global admin', async () => {
    const f = fixture()
    await invalidateELOHistory(f.client, 'play', 'owner')
    expect(f.filters).toEqual([
      [['game_id','game'],['is_general',false],['user_id','owner']],
      [['is_general',true],['user_id','owner']],
    ])
  })
  it('also scopes the legacy caller from the stored owner', async () => {
    const f = fixture()
    await invalidateELOHistory(f.client, 'play')
    expect(f.filters.every(filters => filters.some(([key, value]) => key === 'user_id' && value === 'owner'))).toBe(true)
  })
  it('does not invent an owner for null historical ownership', async () => {
    const f = fixture(null)
    await invalidateELOHistory(f.client, 'play')
    expect(f.filters).toEqual([])
    f.from.mockClear()
    await invalidateELOHistory(f.client, 'play', null)
    expect(f.from).not.toHaveBeenCalled()
  })
  it('rejects owner changes without deleting unrelated histories', async () => {
    const f = fixture()
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    try { await expect(invalidateELOHistory(f.client, 'play', 'different')).rejects.toThrow('Proprietario') }
    finally { errorLog.mockRestore() }
    expect(f.filters).toEqual([])
  })
})
