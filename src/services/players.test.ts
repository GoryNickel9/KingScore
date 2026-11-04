import { createClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import type { Database } from '../types/db'
import { listUserPlayers } from './players'

describe('giocatori selezionabili nei moduli partita', () => {
  it('esclude Player 1 anche con alias, maiuscole o spazi e conserva gli altri giocatori', async () => {
    const rows = [
      { id: 'hidden', name: 'Player 1', alias: 'Ospite' },
      { id: 'hidden-lower', name: 'player 1', alias: null },
      { id: 'hidden-spaces', name: ' PLAYER 1 ', alias: null },
      { id: 'anna', name: 'Anna', alias: null },
      { id: 'ten', name: 'Player 10', alias: null },
      { id: 'two', name: 'Player 2', alias: 'Player 1' },
    ]
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(rows), {
      headers: { 'Content-Type': 'application/json' },
    }))
    const client = createClient<Database>('https://example.test', 'test-key', {
      global: { fetch }, auth: { persistSession: false, autoRefreshToken: false },
    })

    const players = await listUserPlayers(client, 'owner')

    expect(players).toEqual(rows.slice(3))
    expect(rows).toHaveLength(6)
    const url = new URL(String(fetch.mock.calls[0][0]))
    expect(url.pathname).toBe('/rest/v1/players')
    expect(url.searchParams.get('user_id')).toBe('eq.owner')
    expect(url.searchParams.get('order')).toBe('name.asc')
  })

  it('restituisce una lista vuota quando il catalogo non contiene giocatori', async () => {
    const client = createClient<Database>('https://example.test', 'test-key', {
      global: { fetch: async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } }) },
      auth: { persistSession: false, autoRefreshToken: false },
    })

    expect(await listUserPlayers(client, 'owner')).toEqual([])
  })
})
