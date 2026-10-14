/** V1 request snapshots only: authentication, transport and receipts belong to the writer. */
export type PlaySaveRpc = 'get_play_editor_v1' | 'create_play_v1' | 'update_play_v1' |
  'delete_play_v1' | 'import_bga_play_v1'

export interface PlayScoreInput {
  id: string | null
  player_id: string
  score: string | null
  winner: boolean
  color: string | null
  role: string | null
}

export interface PlaySavePayload {
  game_id: string
  played_at: string
  duration_minutes: number | null
  source: 'offline' | 'online'
  notes: string | null
  is_cooperative: boolean
  team_won: boolean | null
  scores: PlayScoreInput[]
}

export interface PreparedPlaySave {
  readonly actorId: string
  readonly rpc: PlaySaveRpc
  readonly requestId: string | null
  readonly playId: string | null
  readonly body: string
  /** Each call returns a fresh object; mutating it cannot change a later replay. */
  arguments(): Record<string, unknown>
}

const RPC_FIELDS: Record<PlaySaveRpc, readonly string[]> = {
  get_play_editor_v1: ['p_play_id'],
  create_play_v1: ['p_request_id', 'p_payload'],
  update_play_v1: ['p_request_id', 'p_play_id', 'p_expected_revision', 'p_payload'],
  delete_play_v1: ['p_request_id', 'p_play_id', 'p_expected_revision'],
  import_bga_play_v1: ['p_request_id', 'p_payload', 'p_metadata', 'p_positions'],
}
const PAYLOAD_FIELDS = ['game_id', 'played_at', 'duration_minutes', 'source', 'notes', 'is_cooperative', 'team_won', 'scores']
const SCORE_FIELDS = ['id', 'player_id', 'score', 'winner', 'color', 'role']
const MAX_JSONB_BYTES = 1_048_576
const MAX_PARTICIPANTS = 63
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/

function requireValue(condition: unknown, field: string): asserts condition {
  if (!condition) throw new TypeError(`Invalid ${field}`)
}
function isUuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value) }
function isText(value: unknown): value is string {
  if (typeof value !== 'string' || value.includes('\0')) return false
  for (const point of value) {
    const code = point.charCodeAt(0)
    if (point.length === 1 && code >= 0xd800 && code <= 0xdfff) return false
  }
  return true
}
function nullableText(value: unknown): boolean { return value === null || isText(value) }
function fields(value: unknown, expected: readonly string[], name: string): asserts value is Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), name)
  requireValue(Object.keys(value).length === expected.length &&
    expected.every(key => Object.prototype.hasOwnProperty.call(value, key)), `${name} fields`)
}
function validDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
function boundedInteger(value: unknown, minimum: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= 2_147_483_647
}
// Match PostgreSQL jsonb::text separator spacing for the established V1 byte limit.
function jsonbText(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(jsonbText).join(', ')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${jsonbText(item)}`).join(', ')}}`
  }
  const result = JSON.stringify(value)
  requireValue(result !== undefined, 'JSON value')
  return result
}
function checkBytes(value: unknown, name: string) {
  requireValue(new TextEncoder().encode(jsonbText(value)).length <= MAX_JSONB_BYTES, `${name} bytes`)
}
function validatePayload(value: unknown, create: boolean) {
  fields(value, PAYLOAD_FIELDS, 'payload')
  requireValue(isUuid(value.game_id), 'game_id')
  requireValue(validDate(value.played_at), 'played_at')
  requireValue(value.duration_minutes === null || boundedInteger(value.duration_minutes, 0), 'duration_minutes')
  requireValue(value.source === 'online' || value.source === 'offline', 'source')
  requireValue(nullableText(value.notes), 'notes')
  requireValue(typeof value.is_cooperative === 'boolean', 'is_cooperative')
  requireValue(value.team_won === null || typeof value.team_won === 'boolean', 'team_won')
  requireValue(value.is_cooperative || value.team_won === null, 'competitive team_won')
  requireValue(Array.isArray(value.scores) && value.scores.length >= 1 && value.scores.length <= MAX_PARTICIPANTS, 'participants')
  const players = new Set<string>()
  const ids = new Set<string>()
  for (const score of value.scores) {
    fields(score, SCORE_FIELDS, 'score')
    requireValue(score.id === null || isUuid(score.id), 'score.id')
    requireValue(!create || score.id === null, 'create score.id')
    requireValue(isUuid(score.player_id) && !players.has(score.player_id.toLowerCase()), 'unique player_id')
    players.add(score.player_id.toLowerCase())
    if (score.id !== null) {
      requireValue(!ids.has(score.id.toLowerCase()), 'unique score.id')
      ids.add(score.id.toLowerCase())
    }
    if (score.score !== null) {
      requireValue(typeof score.score === 'string' && DECIMAL.test(score.score), 'decimal score')
      // Conversion checks only the site's finite ranking domain. The wire value stays a string.
      const comparison = Number(score.score)
      requireValue(Number.isFinite(comparison) && (comparison !== 0 || !/[1-9]/.test(score.score)), 'finite ranking score')
    }
    requireValue(typeof score.winner === 'boolean', 'winner')
    requireValue(nullableText(score.color) && nullableText(score.role), 'score metadata')
    requireValue(!value.is_cooperative || value.team_won === null || score.winner === value.team_won, 'cooperative winner')
  }
  checkBytes(value, 'payload')
}

function validateArguments(rpc: PlaySaveRpc, args: unknown): asserts args is Record<string, unknown> {
  requireValue(Object.prototype.hasOwnProperty.call(RPC_FIELDS, rpc), 'RPC name')
  fields(args, RPC_FIELDS[rpc], 'arguments')
  if ('p_play_id' in args) requireValue(isUuid(args.p_play_id), 'p_play_id')
  if ('p_request_id' in args) requireValue(isUuid(args.p_request_id), 'p_request_id')
  if ('p_expected_revision' in args) {
    requireValue(typeof args.p_expected_revision === 'string' && args.p_expected_revision.length <= 160 &&
      /^[!-~]+$/.test(args.p_expected_revision), 'revision')
  }
  if ('p_payload' in args) validatePayload(args.p_payload, rpc !== 'update_play_v1')
  if (rpc === 'import_bga_play_v1') {
    fields(args.p_metadata, ['location', 'bga_table_id'], 'import metadata')
    requireValue(nullableText(args.p_metadata.location), 'location')
    const table = args.p_metadata.bga_table_id
    requireValue(isText(table) && table.length >= 1 && [...table].length <= 256 && !/\s/.test(table), 'bga_table_id')
    checkBytes(args.p_metadata, 'metadata')
    const payload = args.p_payload as Record<string, unknown>
    const scores = payload.scores as unknown[]
    requireValue(Array.isArray(args.p_positions) && args.p_positions.length === scores.length &&
      args.p_positions.every(position => position === null || boundedInteger(position, 1)), 'external positions')
  }
}

/** No UUID regeneration: the exact serialized arguments survive form edits and explicit replay. */
export function preparePlaySave(actorId: string, rpc: PlaySaveRpc, args: unknown): PreparedPlaySave {
  requireValue(isUuid(actorId), 'actorId')
  validateArguments(rpc, args)
  const body = JSON.stringify(args)
  const snapshot: unknown = JSON.parse(body)
  validateArguments(rpc, snapshot)
  return Object.freeze({
    actorId: actorId.toLowerCase(), rpc, body,
    requestId: typeof snapshot.p_request_id === 'string' ? snapshot.p_request_id : null,
    playId: typeof snapshot.p_play_id === 'string' ? snapshot.p_play_id : null,
    arguments: () => JSON.parse(body) as Record<string, unknown>,
  })
}
