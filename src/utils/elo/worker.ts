import { buildEloPublication } from './publication.ts'
import type { EloPublication, EloSourceSnapshot } from './publication.ts'
import { decodeEloRead } from './readModel.ts'

type RpcName = 'get_elo_publication_v1' | 'get_elo_source_v1' | 'publish_elo_v1'
export interface EloWorkerRpcResult {
  data: unknown
  error: { code?: string; message: string } | null
  status?: number
}
export type EloWorkerRpc = (name: RpcName, args?: Record<string, unknown>) => Promise<EloWorkerRpcResult>
export interface EloWorkerOptions {
  maxSnapshots?: number
  maxPublishAttempts?: number
  newPublicationId?: () => string
}
export interface EloWorkerSummary {
  status: 'current' | 'published' | 'pending'
  attempts: number
  publicationId: string | null
  sourceRevision: string
  processedPlays: number | null
}

class RpcFailure extends Error {
  constructor(readonly code: string | undefined, readonly status: number | undefined) {
    // Never log source rows, payloads, request headers or upstream diagnostic data.
    super(`ELO RPC failed (${code || status || 'transport'})`)
    this.name = 'EloWorkerError'
  }
}
function bounded(value: number, maximum: number): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error('Invalid ELO worker attempt limit')
  return value
}
async function call(rpc: EloWorkerRpc, name: RpcName, args?: Record<string, unknown>): Promise<unknown> {
  let response: EloWorkerRpcResult
  try { response = await rpc(name, args) } catch { throw new RpcFailure(undefined, undefined) }
  if (response.error) throw new RpcFailure(response.error.code, response.status)
  return response.data
}
function receipt(value: unknown, publication: EloPublication): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid ELO publication receipt')
  const row = value as Record<string, unknown>
  if (Object.keys(row).length !== 4 || row.publicationId !== publication.publicationId
    || row.scopeId !== 'global' || row.sourceRevision !== publication.sourceRevision
    || typeof row.replayed !== 'boolean') throw new Error('Invalid ELO publication receipt')
}
function uncertain(error: unknown): boolean {
  if (!(error instanceof RpcFailure)) return true
  return !error.code || (error.status !== undefined && error.status >= 500)
    || error.code.startsWith('08') || error.code === 'PGRST000' || error.code === 'PGRST001'
}

/** Service-side only. Never writes legacy rating/cache tables or partitions by owner. */
export async function runEloWorker(rpc: EloWorkerRpc, options: EloWorkerOptions = {}): Promise<EloWorkerSummary> {
  const maxSnapshots = bounded(options.maxSnapshots ?? 3, 5)
  const maxPublishAttempts = bounded(options.maxPublishAttempts ?? 2, 3)
  const newId = options.newPublicationId ?? (() => crypto.randomUUID())
  let lastRevision = '0'
  let lastPublication: string | null = null
  for (let attempt = 0; attempt < maxSnapshots; attempt++) {
    const before = decodeEloRead(await call(rpc, 'get_elo_publication_v1'), 'global')
    lastRevision = before.sourceRevision
    lastPublication = before.publicationId
    if (before.status === 'current') {
      return { status: attempt === 0 ? 'current' : 'published', attempts: attempt,
        publicationId: before.publicationId, sourceRevision: before.sourceRevision,
        processedPlays: before.result.processedPlays }
    }
    const source = await call(rpc, 'get_elo_source_v1') as EloSourceSnapshot
    if (source?.scopeId !== 'global') throw new Error('ELO worker requires one global snapshot')
    const publication = buildEloPublication(source, newId())
    lastRevision = publication.sourceRevision
    let conflict = false
    for (let send = 0; send < maxPublishAttempts; send++) {
      let value: unknown
      try {
        // An uncertain outcome resends this exact UUID/body; never recompute on timeout.
        value = await call(rpc, 'publish_elo_v1', { p_publication: publication })
      } catch (error) {
        if (error instanceof RpcFailure && error.code === '40001') { conflict = true; break }
        if (!uncertain(error) || send + 1 === maxPublishAttempts) throw error
        continue
      }
      receipt(value, publication)
      lastPublication = publication.publicationId
      break
    }
    if (conflict) continue
    const after = decodeEloRead(await call(rpc, 'get_elo_publication_v1'), 'global')
    lastRevision = after.sourceRevision
    lastPublication = after.publicationId
    if (after.status === 'current') {
      return { status: 'published', attempts: attempt + 1, publicationId: after.publicationId,
        sourceRevision: after.sourceRevision, processedPlays: after.result.processedPlays }
    }
    // Another edit committed during/after publication: bounded fresh recomputation.
  }
  return { status: 'pending', attempts: maxSnapshots, publicationId: lastPublication,
    sourceRevision: lastRevision, processedPlays: null }
}
