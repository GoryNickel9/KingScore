import { createServer } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import type { Database } from '../../types/db'
import { readGameDetailElo } from './gameDetail'
import { decodeEloRead } from './readModel'
import { ELO_ALGORITHM } from './algorithm'
import { simulateAllPlays } from './simulation'
import type { SimulationPlay } from './simulation'

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const gameId = id(1)
const a = id(2)
const b = id(3)
const games = { lower_score_wins: false, shared_score_positions: true }
const play = (n: number, winner = a) => ({
  id: id(n), game_id: gameId, played_at: '2026-10-21', games, is_cooperative: false, team_won: null,
  score_count: [{ count: 2 }],
  play_scores: [
    { player_id: a, winner: winner === a, score: winner === a ? 10 : 0, position: null, elo_ordinal: 0 },
    { player_id: b, winner: winner === b, score: winner === b ? 10 : 0, position: null, elo_ordinal: 1 },
  ],
})
const stale = (revision = '2') => ({ scopeId: 'global', algorithm: ELO_ALGORITHM, status: 'stale',
  sourceRevision: revision, publishedRevision: '1', publicationId: id(4), result: null })
const current = (source = [play(10), play(11, b)]) => ({ ...stale(), status: 'current', publishedRevision: '2',
  result: simulateAllPlays(source) })

type Page = { rows: unknown[]; count?: number | null; status?: number }
type CapturedRequest = { method: string; path: string; prefer: string | string[] | undefined }
async function fixture(
  pages: Page[], reads: unknown[],
  run: (client: ReturnType<typeof createClient<Database>>, requests: CapturedRequest[]) => Promise<void>
) {
  const requests: CapturedRequest[] = []
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* Consume the read-only RPC body. */ }
    requests.push({ method: request.method!, path: request.url!, prefer: request.headers.prefer })
    response.setHeader('Content-Type', 'application/json')
    if (request.url?.startsWith('/rest/v1/rpc/')) {
      response.end(JSON.stringify(reads.shift())); return
    }
    const page = pages.shift()!
    if (page.count !== null) response.setHeader('Content-Range', `0-${Math.max(0, page.rows.length - 1)}/${page.count ?? page.rows.length}`)
    response.writeHead(page.status ?? 200)
    response.end(JSON.stringify(page.rows))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture address missing')
  const client = createClient<Database>(`http://127.0.0.1:${address.port}`, 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  try { await run(client, requests) } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

describe('immediate game detail ELO', () => {
  it('uses a current global publication without querying raw rows', async () => {
    await fixture([], [], async (client, requests) => {
      const read = decodeEloRead(current(), 'global')
      const result = await readGameDetailElo(client, gameId, read)
      expect(result.calculated).toBe(false)
      expect(result.history).toEqual(read.result!.gameHistory)
      expect(requests).toHaveLength(0)
    })
  })

  it('replays the complete game across owners, keeping general ELO unpublished', async () => {
    await fixture([{ rows: [play(10), play(11, b)] }], [stale()], async (client, requests) => {
      const result = await readGameDetailElo(client, gameId, decodeEloRead(stale(), 'global'))
      expect(result.calculated).toBe(true)
      expect(result.history.map(p => [p.playerId, p.rating, p.ratingChange])).toEqual([
        [a, 1024, 24], [b, 976, -24], [b, 1003, 27], [a, 997, -27],
      ])
      expect(result.read.result).toBeNull()
      const query = new URL(requests[0].path, 'http://local').searchParams
      expect(query.get('game_id')).toBe(`eq.${gameId}`)
      expect(query.has('user_id')).toBe(false)
      expect(query.get('order')).toBe('played_at.asc,id.asc')
      expect(query.get('play_scores.order')).toBe('elo_ordinal.asc')
      expect(query.get('select')).toContain('score_count:play_scores(count)')
      expect(requests[0].prefer).toContain('count=exact')
      expect(requests.map(r => [r.method, r.path.split('?')[0]])).toEqual([
        ['GET', '/rest/v1/plays'], ['POST', '/rest/v1/rpc/get_elo_publication_v1'],
      ])
    })
  })

  it('follows the exact count when the server caps pages below the requested size', async () => {
    await fixture([{ rows: [play(10)], count: 2 }, { rows: [play(11, b)], count: 2 }], [stale()], async (client, requests) => {
      const result = await readGameDetailElo(client, gameId, decodeEloRead(stale(), 'global'))
      expect(result.history).toHaveLength(4)
      expect(new URL(requests[1].path, 'http://local').searchParams.get('offset')).toBe('1')
    })
  })

  it('prefers a publication that finishes during the source read', async () => {
    await fixture([{ rows: [play(10)] }], [current()], async client => {
      const result = await readGameDetailElo(client, gameId, decodeEloRead(stale(), 'global'))
      expect(result.calculated).toBe(false)
      expect(result.read.status).toBe('current')
      expect(result.history).toHaveLength(4)
    })
  })

  it('discards a changed revision and retries the entire game once', async () => {
    await fixture([{ rows: [play(10)] }, { rows: [play(10), play(11, b)] }], [stale('3'), stale('3')], async client => {
      const result = await readGameDetailElo(client, gameId, decodeEloRead(stale(), 'global'))
      expect(result.read.sourceRevision).toBe('3')
      expect(result.history).toHaveLength(4)
    })
  })

  it('returns no mixed result when both revision checks conflict', async () => {
    await fixture([{ rows: [play(10)] }, { rows: [play(10)] }], [stale('3'), stale('4')], async client => {
      await expect(readGameDetailElo(client, gameId, decodeEloRead(stale(), 'global'))).rejects.toThrow('stanno cambiando')
    })
  })

  it.each([
    { rows: [play(10)], count: null },
    { rows: [], count: 1 },
    { rows: [play(10)], count: 0 },
    { rows: [{ ...play(10), score_count: [{ count: 3 }] }] },
    { rows: [{ ...play(10), game_id: id(99) }] },
    { rows: [{ ...play(10), games: null }] },
    { rows: [{ ...play(10), play_scores: play(10).play_scores.map(s => ({ ...s, elo_ordinal: 0 })) }] },
    { rows: [{ ...play(10), play_scores: play(10).play_scores.map(s => ({ ...s, elo_ordinal: null })) }] },
    { rows: [play(11), play(10)] },
    { rows: [play(10), play(10)] },
    { rows: [{ ...play(10), played_at: '2026-02-30' }] },
  ])('rejects incomplete or invalid source rows (#%#)', async page => {
    await fixture([page], [stale()], async client => {
      await expect(readGameDetailElo(client, gameId, decodeEloRead(stale(), 'global'))).rejects.toThrow()
    })
  })

  it('propagates source read failure without writing or displaying old ratings', async () => {
    await fixture([{ rows: [], status: 403 }], [], async (client, requests) => {
      await expect(readGameDetailElo(client, gameId, decodeEloRead(stale(), 'global'))).rejects.toThrow('Impossibile leggere')
      expect(requests).toHaveLength(1)
    })
  })

  it('keeps game-specific replay equal to full replay with interleaved games', () => {
    const full: SimulationPlay[] = [play(10), { ...play(11, b), game_id: id(99) }, play(12, b)]
    expect(simulateAllPlays(full.filter(p => p.game_id === gameId)).gameHistory)
      .toEqual(simulateAllPlays(full).gameHistory.filter(p => p.gameId === gameId))
  })
})
