import { describe, expect, it } from 'vitest'
import { runEloWorker } from './worker'
import type { EloWorkerRpc, EloWorkerRpcResult } from './worker'
import { buildEloPublication } from './publication'
import type { EloPublication, EloSourceSnapshot } from './publication'

const uuid = (n: number) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`
const source = (revision = '4'): EloSourceSnapshot => ({ scopeId: 'global', sourceRevision: revision,
  plays: [{ id: uuid(1), game_id: uuid(2), played_at: '2026-10-15', play_scores: [
    { player_id: uuid(3), score: null, winner: false, position: null },
    { player_id: uuid(4), score: 8, winner: false, position: 1 },
    { player_id: uuid(5), score: null, winner: true, position: 2 },
  ] }] })
const ok = (data: unknown): EloWorkerRpcResult => ({ data, error: null, status: 200 })
function server() {
  let revision = '4'
  let head: EloPublication | null = null
  let sequence = 100
  const calls: string[] = []
  const sent: EloPublication[] = []
  const receipts = new Map<string, EloPublication>()
  const read = () => ({ scopeId: 'global', algorithm: head?.algorithm ?? null,
    status: !head ? 'missing' : head.sourceRevision === revision ? 'current' : 'stale',
    sourceRevision: revision, publishedRevision: head?.sourceRevision ?? null,
    publicationId: head?.publicationId ?? null,
    result: head?.sourceRevision === revision ? head.result : null })
  const publish = (publication: EloPublication) => {
    sent.push(structuredClone(publication))
    const replayed = receipts.has(publication.publicationId)
    if (!replayed) { receipts.set(publication.publicationId, publication); head = publication }
    return ok({ publicationId: publication.publicationId, scopeId: 'global', sourceRevision: publication.sourceRevision, replayed })
  }
  const rpc: EloWorkerRpc = async (name, args) => {
    calls.push(name)
    if (name === 'get_elo_publication_v1') return ok(read())
    if (name === 'get_elo_source_v1') return ok(source(revision))
    return publish(args!.p_publication as EloPublication)
  }
  return { rpc, read, publish, calls, sent, receipts, nextId: () => uuid(sequence++),
    advance: () => { revision = String(Number(revision) + 1) },
    seed: () => { head = buildEloPublication(source(revision), uuid(50)) } }
}

describe('global ELO worker', () => {
  it('publishes one complete global generation with the unchanged null-score core and exact revision', async () => {
    const test = server()
    const result = await runEloWorker(test.rpc, { newPublicationId: test.nextId })
    expect(result).toMatchObject({ status: 'published', attempts: 1, sourceRevision: '4', processedPlays: 1 })
    expect(test.calls).toEqual(['get_elo_publication_v1', 'get_elo_source_v1', 'publish_elo_v1', 'get_elo_publication_v1'])
    expect(test.sent[0]).toEqual(buildEloPublication(source(), uuid(100)))
  })
  it('skips current data without snapshot, calculation or write', async () => {
    const test = server(); test.seed()
    expect(await runEloWorker(test.rpc)).toMatchObject({ status: 'current', attempts: 0 })
    expect(test.calls).toEqual(['get_elo_publication_v1'])
  })
  it('replays the exact UUID/body after a committed publication loses its response', async () => {
    const test = server(); let lost = true
    const rpc: EloWorkerRpc = async (name, args) => {
      const result = await test.rpc(name, args)
      if (name === 'publish_elo_v1' && lost) { lost = false; throw new TypeError('fetch failed') }
      return result
    }
    expect(await runEloWorker(rpc, { newPublicationId: test.nextId })).toMatchObject({ status: 'published' })
    expect(test.sent).toHaveLength(2)
    expect(test.sent[1]).toEqual(test.sent[0])
    expect(test.receipts.size).toBe(1)
  })
  it('takes a fresh snapshot and UUID on source CAS conflict, never resending stale content', async () => {
    const test = server(); let drift = true
    const rpc: EloWorkerRpc = async (name, args) => {
      if (name === 'publish_elo_v1' && drift) {
        drift = false; test.advance()
        return { data: null, error: { code: '40001', message: 'changed' }, status: 500 }
      }
      return test.rpc(name, args)
    }
    expect(await runEloWorker(rpc, { newPublicationId: test.nextId })).toMatchObject({ status: 'published', attempts: 2, sourceRevision: '5' })
    expect(test.sent[0].publicationId).toBe(uuid(101))
  })
  it('recomputes if an edit commits after successful publication', async () => {
    const test = server(); let drift = true
    const rpc: EloWorkerRpc = async (name, args) => {
      const result = await test.rpc(name, args)
      if (name === 'publish_elo_v1' && drift) { drift = false; test.advance() }
      return result
    }
    expect(await runEloWorker(rpc, { newPublicationId: test.nextId })).toMatchObject({ status: 'published', attempts: 2, sourceRevision: '5' })
    expect(test.sent).toHaveLength(2)
    expect(test.sent[0].sourceRevision).toBe('4')
    expect(test.sent[1].sourceRevision).toBe('5')
  })
  it('returns pending after bounded continuous source edits, with no partial totals', async () => {
    const test = server(); let writes = 0
    const rpc: EloWorkerRpc = async (name, args) => {
      if (name === 'publish_elo_v1') { writes++; test.advance(); return { data: null, error: { code: '40001', message: 'changed' } } }
      return test.rpc(name, args)
    }
    expect(await runEloWorker(rpc, { maxSnapshots: 2, newPublicationId: test.nextId })).toMatchObject({ status: 'pending', attempts: 2, processedPlays: null })
    expect(writes).toBe(2)
  })
  it('does not retry forbidden or request-ID conflicts, or disclose upstream diagnostics', async () => {
    for (const code of ['42501', 'PT409', '22023']) {
      const test = server(); let writes = 0
      const rpc: EloWorkerRpc = async (name, args) => {
        if (name === 'publish_elo_v1') { writes++; return { data: null, error: { code, message: 'SECRET diagnostic' }, status: 400 } }
        return test.rpc(name, args)
      }
      await expect(runEloWorker(rpc, { newPublicationId: test.nextId })).rejects.toThrow(`ELO RPC failed (${code})`)
      expect(writes).toBe(1)
    }
  })
  it('bounds unknown publish outcomes and preserves one request body across all attempts', async () => {
    const test = server(); const bodies: unknown[] = []
    const rpc: EloWorkerRpc = async (name, args) => {
      if (name === 'publish_elo_v1') { bodies.push(args!.p_publication); return { data: null, error: { message: 'fetch failed' }, status: 0 } }
      return test.rpc(name, args)
    }
    await expect(runEloWorker(rpc, { newPublicationId: test.nextId })).rejects.toThrow('ELO RPC failed')
    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toBe(bodies[0])
  })
  it('rejects malformed source/order before publishing anything', async () => {
    const test = server()
    const rpc: EloWorkerRpc = async (name, args) => name === 'get_elo_source_v1'
      ? ok({ ...source(), scopeId: uuid(7) }) : test.rpc(name, args)
    await expect(runEloWorker(rpc)).rejects.toThrow('global snapshot')
    expect(test.sent).toHaveLength(0)
  })
  it('rejects malformed acknowledgement without blindly retrying it', async () => {
    const test = server(); let writes = 0
    const rpc: EloWorkerRpc = async (name, args) => {
      if (name === 'publish_elo_v1') { writes++; return ok({ replayed: false }) }
      return test.rpc(name, args)
    }
    await expect(runEloWorker(rpc, { newPublicationId: test.nextId })).rejects.toThrow('receipt')
    expect(writes).toBe(1)
  })
  it('rejects malformed read generations and missing ordinal error without a legacy fallback', async () => {
    const test = server()
    await expect(runEloWorker(async () => ok({ ...test.read(), status: 'current' }))).rejects.toThrow('read response')
    await expect(runEloWorker(async (name, args) => name === 'get_elo_source_v1'
      ? { data: null, error: { code: '22023', message: 'order missing' } } : test.rpc(name, args))).rejects.toThrow('22023')
    expect(test.sent).toHaveLength(0)
  })
})
