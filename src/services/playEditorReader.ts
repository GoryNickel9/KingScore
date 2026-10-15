import type { DbGame, DbPlay, DbPlayer, DbPlayScore } from '../types/rows'
import type { PlayWriterDependencies } from './atomicPlayWriter'
import { preparePlaySave } from './playSaveRequests'

export type PlayEditorPlay = DbPlay & Record<string, unknown>
export type PlayEditorScore = Omit<DbPlayScore, 'score'> & { score: string | null } & Record<string, unknown>
export interface PlayEditorSnapshot {
  detail: {
    play: PlayEditorPlay
    game: (DbGame & Record<string, unknown>) | null
    scores: Array<{ score: PlayEditorScore; player: (DbPlayer & Record<string, unknown>) | null }>
  }
  revision: string
  editability: { editable: boolean; issues: string[] }
}
export type PlayEditorReadCode = 'invalid-request' | 'offline' | 'unauthorized' | 'forbidden' |
  'not-found' | 'unavailable' | 'invalid-response' | 'timeout' | 'network'
export class PlayEditorReadError extends Error {
  constructor(readonly code: PlayEditorReadCode, readonly status: number | null = null) {
    super(`Play editor: ${code}`)
    this.name = 'PlayEditorReadError'
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
type Row = Record<string, unknown>
function requireValue(condition: unknown): asserts condition {
  if (!condition) throw new PlayEditorReadError('invalid-response')
}
function row(value: unknown): Row {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value))
  return value as Row
}
function exact(value: Row, keys: string[]) {
  requireValue(Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key)))
}
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value) }
function text(value: unknown): value is string { return typeof value === 'string' }
function nullable(value: unknown, check: (value: unknown) => boolean) { return value === null || check(value) }
function integer(value: unknown) { return typeof value === 'number' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 }
function bool(value: unknown) { return typeof value === 'boolean' }
function fields(value: Row, names: string[], check: (value: unknown) => boolean) {
  requireValue(names.every(name => Object.prototype.hasOwnProperty.call(value, name) && check(value[name])))
}
function decode(value: unknown, actor: string, expectedPlay: string): PlayEditorSnapshot {
  const root = row(value); exact(root, ['detail', 'revision', 'editability'])
  requireValue(text(root.revision) && root.revision.length <= 160 && /^[!-~]+$/.test(root.revision))
  const editability = row(root.editability); exact(editability, ['editable', 'issues'])
  requireValue(bool(editability.editable) && Array.isArray(editability.issues) &&
    editability.issues.every(issue => text(issue) && issue.trim().length > 0) &&
    editability.editable === (editability.issues.length === 0))
  const detail = row(root.detail); exact(detail, ['play', 'game', 'scores'])
  const play = row(detail.play)
  requireValue(uuid(play.id) && play.id.toLowerCase() === expectedPlay)
  fields(play, ['user_id', 'game_id'], value => nullable(value, uuid))
  fields(play, ['location', 'notes', 'source', 'bga_table_id', 'created_at'], value => nullable(value, text))
  fields(play, ['is_cooperative', 'team_won'], value => nullable(value, bool))
  fields(play, ['duration_minutes'], value => nullable(value, integer))
  requireValue(text(play.played_at) && play.played_at.length > 0)
  const game = detail.game === null ? null : row(detail.game)
  if (game) {
    requireValue(uuid(game.id) && game.id.toLowerCase() === (play.game_id as string | null)?.toLowerCase() && text(game.name))
    fields(game, ['bga_id', 'image_url', 'created_at'], value => nullable(value, text))
    fields(game, ['min_players', 'max_players'], value => nullable(value, integer))
  }
  requireValue(Array.isArray(detail.scores))
  const scoreIds = new Set<string>()
  for (const item of detail.scores) {
    const entry = row(item); exact(entry, ['score', 'player'])
    const score = row(entry.score)
    requireValue(uuid(score.id) && !scoreIds.has(score.id.toLowerCase()) &&
      uuid(score.play_id) && score.play_id.toLowerCase() === expectedPlay)
    scoreIds.add(score.id.toLowerCase())
    fields(score, ['player_id'], value => nullable(value, uuid))
    // Decimal text (including unsupported historical numeric values) stays untouched.
    fields(score, ['score', 'color', 'role'], value => nullable(value, text))
    fields(score, ['winner'], value => nullable(value, bool))
    fields(score, ['position'], value => nullable(value, integer))
    if (entry.player !== null) {
      const player = row(entry.player)
      requireValue(uuid(player.id) && player.id.toLowerCase() === (score.player_id as string | null)?.toLowerCase() &&
        text(player.name) && text(player.updated_at))
      fields(player, ['user_id', 'account_user_id'], value => nullable(value, uuid))
      fields(player, ['alias', 'avatar_url', 'color', 'created_at'], value => nullable(value, text))
      fields(player, ['is_me'], value => nullable(value, bool))
    }
  }
  if (editability.editable) {
    // Reuse the mutation contract to reject an allegedly editable incompatible snapshot.
    try {
      preparePlaySave(actor, 'update_play_v1', { p_request_id: expectedPlay, p_play_id: expectedPlay,
        p_expected_revision: root.revision, p_payload: {
          game_id: play.game_id, played_at: play.played_at, duration_minutes: play.duration_minutes,
          source: play.source, notes: play.notes, is_cooperative: play.is_cooperative, team_won: play.team_won,
          scores: detail.scores.map(item => {
            const score = (item as { score: Row }).score
            return { id: score.id, player_id: score.player_id, score: score.score, winner: score.winner,
              color: score.color, role: score.role }
          }),
        } })
    } catch { throw new PlayEditorReadError('invalid-response') }
  }
  return root as unknown as PlayEditorSnapshot
}

async function responseValue(response: Response, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) throw new PlayEditorReadError('timeout')
  if (!response.body) throw new PlayEditorReadError('invalid-response', response.status)
  const reader = response.body.getReader()
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', cancel, { once: true })
  const chunks: Uint8Array[] = []; let size = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_RESPONSE_BYTES) throw new PlayEditorReadError('invalid-response', response.status)
      chunks.push(chunk.value)
    }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch (error) {
    if (error instanceof PlayEditorReadError) throw error
    throw new PlayEditorReadError('invalid-response', response.status)
  } finally {
    signal.removeEventListener('abort', cancel)
    await reader.cancel().catch(() => undefined); reader.releaseLock()
  }
}

/** Read only: no table fallback, retry, journal changes or conversion of historical rows. */
export async function getPlayEditor(baseUrl: string, apiKey: string, actorId: string, playId: string,
  deps: Pick<PlayWriterDependencies, 'session' | 'online' | 'fetch'>): Promise<PlayEditorSnapshot> {
  let base: URL
  try { base = new URL(baseUrl) } catch { throw new PlayEditorReadError('invalid-request') }
  if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) ||
    base.username || base.password || base.search || base.hash || base.pathname !== '/' || !apiKey || !UUID.test(actorId) || !UUID.test(playId)) {
    throw new PlayEditorReadError('invalid-request')
  }
  const actor = actorId.toLowerCase(); const target = playId.toLowerCase()
  const abort = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new PlayEditorReadError('timeout')); abort.abort() }, 30_000)
  })
  const verify = async () => {
    if (!deps.online()) throw new PlayEditorReadError('offline')
    let session
    try { session = await deps.session() } catch { throw new PlayEditorReadError('unauthorized') }
    if (abort.signal.aborted) throw new PlayEditorReadError('timeout')
    if (!session || session.actorId.toLowerCase() !== actor || !session.accessToken) throw new PlayEditorReadError('unauthorized')
    if (!session.admin) throw new PlayEditorReadError('forbidden')
    if (!deps.online()) throw new PlayEditorReadError('offline')
    return session
  }
  try {
    return await Promise.race([deadline, (async () => {
      const session = await verify()
      const response = await deps.fetch(`${base.origin}/rest/v1/rpc/get_play_editor_v1`, {
        method: 'POST', body: JSON.stringify({ p_play_id: target }), signal: abort.signal,
        redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', apikey: apiKey, Authorization: `Bearer ${session.accessToken}` },
      })
      const value = await responseValue(response, abort.signal)
      await verify()
      if (response.status !== 200) {
        const code = value && typeof value === 'object' && 'code' in value ? value.code : null
        const recognized: Array<[number, string[], PlayEditorReadCode]> = [
          [400, ['PT400'], 'invalid-request'], [401, ['PT401', 'PGRST301'], 'unauthorized'],
          [403, ['PT403', '42501'], 'forbidden'], [404, ['PT404'], 'not-found'],
          [404, ['PGRST202'], 'unavailable'],
        ]
        throw new PlayEditorReadError(recognized.find(([status, codes]) => status === response.status && codes.includes(code as string))?.[2] ?? 'unavailable', response.status)
      }
      return decode(value, actor, target)
    })()])
  } catch (error) {
    if (error instanceof PlayEditorReadError) throw error
    throw new PlayEditorReadError('network')
  } finally { clearTimeout(timer); abort.abort() }
}
