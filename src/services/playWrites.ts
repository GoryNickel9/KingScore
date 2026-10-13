import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '../types/db'
import type { DbGame, DbPlay, DbPlayer, DbPlayScore } from '../types/rows'

export const atomicPlayWritesEnabled = import.meta.env.VITE_ATOMIC_PLAY_WRITES === 'true'

export type PlayWriteErrorKind = 'unknown' | 'conflict' | 'validation' | 'permission' | 'missing' | 'unavailable'
export class PlayWriteError extends Error {
  constructor(public readonly kind: PlayWriteErrorKind, message: string) { super(message); this.name = 'PlayWriteError' }
}
export interface ScoreInput { id: string | null; player_id: string; score: string | number | null; winner: boolean; color: string | null; role: string | null }
export interface PlayInput {
  game_id: string; played_at: string; duration_minutes: number | null; source: string; notes: string | null
  is_cooperative: boolean; team_won: boolean | null; scores: ScoreInput[]
}
export interface CreatePlayCommand { actorId: string; requestId: string; payload: PlayInput }
export interface UpdatePlayCommand extends CreatePlayCommand { playId: string; revision: string }
export interface DeletePlayCommand { actorId: string; requestId: string; playId: string; revision: string }
export interface ImportBgaCommand extends CreatePlayCommand { metadata: { location: string | null; bga_table_id: string }; positions: (number | null)[] }
export interface PlayMutation { play_id: string; revision: string; replayed: boolean }
export interface PlayDeletion { play_id: string; deleted: true; replayed: boolean }
export interface BgaMutation extends PlayMutation { skipped: boolean }
export interface PlayEditor {
  detail: { play: DbPlay; game: DbGame | null; scores: { score: Omit<DbPlayScore, 'score'> & { score: string | null }; player: DbPlayer | null }[] }
  revision: string
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const revisionPattern = /^v1:[0-9a-f]{64}$/
const decimalPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
function invalid(message: string): never { throw new PlayWriteError('validation', message) }
function assertUuid(value: string): void { if (!uuid.test(value)) invalid('Identificatore non valido') }
function assertRevision(value: string): void { if (!revisionPattern.test(value)) invalid('Revisione non valida: ricarica la partita') }
export function parseScoreInput(value: string | number): string | null {
  const text = String(value).trim()
  if (text === '') return null
  if (!decimalPattern.test(text) || !Number.isFinite(Number(text)) ||
      (Number(text) === 0 && /[1-9]/.test(text.split(/[eE]/)[0]))) invalid('Punteggio non valido o fuori intervallo')
  return text
}
export function parseDurationInput(value: string): number | null {
  if (value === '') return null
  if (!/^\d+$/.test(value) || Number(value) > 2147483647) invalid('Durata non valida: usa minuti interi non negativi')
  return Number(value)
}
function validateInput(input: PlayInput): void {
  assertUuid(input.game_id)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.played_at) || input.played_at.startsWith('0000-') ||
      !Number.isFinite(Date.parse(input.played_at + 'T00:00:00Z')) || new Date(input.played_at + 'T00:00:00Z').toISOString().slice(0, 10) !== input.played_at) invalid('Data non valida')
  if (!['offline', 'online'].includes(input.source)) invalid('Modalità non valida')
  if (input.duration_minutes !== null && (!Number.isInteger(input.duration_minutes) || input.duration_minutes < 0 || input.duration_minutes > 2147483647)) invalid('Durata non valida')
  if (input.scores.length < 1 || input.scores.length > 63) invalid('Sono richiesti da 1 a 63 partecipanti')
  if (!input.is_cooperative && input.team_won !== null) invalid('Esito del team non valido')
  const players = new Set<string>(); const ids = new Set<string>()
  for (const score of input.scores) {
    assertUuid(score.player_id)
    if (players.has(score.player_id)) invalid('Giocatore duplicato')
    players.add(score.player_id)
    if (score.id !== null) { assertUuid(score.id); if (ids.has(score.id)) invalid('Punteggio duplicato'); ids.add(score.id) }
    if (score.score !== null) parseScoreInput(score.score)
    if (input.is_cooperative && input.team_won !== null && score.winner !== input.team_won) invalid('Risultato individuale diverso da quello del team')
  }
  if (new TextEncoder().encode(JSON.stringify(input)).length > 1048576) invalid('Dati della partita troppo grandi')
}
function payloadJson(input: PlayInput): Json { return { ...input, scores: input.scores.map(score => ({ ...score })) } }

async function authorize(client: SupabaseClient<Database>, actorId: string): Promise<string> {
  assertUuid(actorId)
  let local: Awaited<ReturnType<typeof client.auth.getSession>>
  try { local = await client.auth.getSession() } catch { throw new PlayWriteError('unavailable', 'Sessione non verificabile: nessun invio effettuato') }
  const { data: { session }, error } = local
  if (error || !session || session.user.id !== actorId) throw new PlayWriteError('permission', 'Sessione cambiata: accedi con l’account della richiesta')
  let result: Awaited<ReturnType<typeof client.auth.getUser>>
  try { result = await client.auth.getUser(session.access_token) } catch { throw new PlayWriteError('unavailable', 'Connessione non disponibile: nessun invio effettuato') }
  if (result.error && (result.error.status === undefined || result.error.status >= 500)) throw new PlayWriteError('unavailable', 'Connessione non disponibile: nessun invio effettuato')
  if (result.error || !result.data.user || result.data.user.id !== actorId || result.data.user.app_metadata.role !== 'admin') {
    throw new PlayWriteError('permission', 'Sessione amministratore non valida: accedi nuovamente')
  }
  return session.access_token
}
type RpcName = 'get_web_play_editor_v1' | 'create_web_play_v1' | 'update_web_play_v1' | 'delete_play_v1' | 'import_bga_play_v1'
async function invoke(client: SupabaseClient<Database>, token: string, name: RpcName, args: Database['public']['Functions'][RpcName]['Args']): Promise<Json> {
  let result
  try { result = await client.rpc(name, args).setHeader('Authorization', `Bearer ${token}`) } catch { throw new PlayWriteError('unknown', 'Esito del salvataggio incerto: riprova la stessa richiesta') }
  if (result.error) {
    const code = result.error.code ?? ''
    if (code === 'PT409') throw new PlayWriteError('conflict', 'La partita è cambiata o la richiesta è già stata usata: ricarica prima di modificare')
    if (code === 'PT404') throw new PlayWriteError('missing', 'Partita non trovata')
    if (code === '42501' || result.status === 401 || result.status === 403) throw new PlayWriteError('permission', 'Permesso negato: verifica la sessione amministratore')
    if (code === 'PGRST202') throw new PlayWriteError('unavailable', 'Salvataggio non disponibile: contatta l’amministratore')
    if (code.startsWith('22') || code.startsWith('23')) throw new PlayWriteError('validation', 'Dati della partita non validi: verifica i campi e i partecipanti')
    throw new PlayWriteError('unknown', 'Esito del salvataggio incerto: riprova la stessa richiesta')
  }
  if (result.status < 200 || result.status >= 300 || result.data === null) throw new PlayWriteError('unknown', 'Risposta non valida: verifica l’esito prima di un nuovo invio')
  return result.data
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
const nullableString = (value: unknown): boolean => value === null || typeof value === 'string'
const nullableBoolean = (value: unknown): boolean => value === null || typeof value === 'boolean'
const nullableUuid = (value: unknown): boolean => value === null || (typeof value === 'string' && uuid.test(value))
const nullableInteger = (value: unknown): boolean => value === null || (typeof value === 'number' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647)
function assertResponse(ok: boolean): asserts ok { if (!ok) throw new PlayWriteError('unknown', 'Risposta non valida: riprova la stessa richiesta') }
function mutation(value: Json): PlayMutation {
  assertResponse(record(value) && typeof value.play_id === 'string' && uuid.test(value.play_id) &&
    typeof value.revision === 'string' && revisionPattern.test(value.revision) && typeof value.replayed === 'boolean')
  return { play_id: value.play_id as string, revision: value.revision as string, replayed: value.replayed as boolean }
}
export async function createPlay(client: SupabaseClient<Database>, command: CreatePlayCommand): Promise<PlayMutation> {
  assertUuid(command.requestId); validateInput(command.payload)
  if (command.payload.scores.some(score => score.id !== null)) invalid('Una nuova partita non può riusare i punteggi esistenti')
  const token = await authorize(client, command.actorId)
  return mutation(await invoke(client, token, 'create_web_play_v1', { p_request_id: command.requestId, p_payload: payloadJson(command.payload) }))
}
export async function updatePlay(client: SupabaseClient<Database>, command: UpdatePlayCommand): Promise<PlayMutation> {
  assertUuid(command.requestId); assertUuid(command.playId); assertRevision(command.revision); validateInput(command.payload)
  const token = await authorize(client, command.actorId)
  const response = mutation(await invoke(client, token, 'update_web_play_v1', { p_request_id: command.requestId, p_play_id: command.playId,
    p_expected_revision: command.revision, p_payload: payloadJson(command.payload) }))
  assertResponse(response.play_id === command.playId)
  return response
}
export async function deletePlay(client: SupabaseClient<Database>, command: DeletePlayCommand): Promise<PlayDeletion> {
  assertUuid(command.requestId); assertUuid(command.playId); assertRevision(command.revision)
  const token = await authorize(client, command.actorId)
  const value = await invoke(client, token, 'delete_play_v1', { p_request_id: command.requestId, p_play_id: command.playId, p_expected_revision: command.revision })
  assertResponse(record(value) && value.play_id === command.playId && value.deleted === true && typeof value.replayed === 'boolean')
  return { play_id: command.playId, deleted: true, replayed: value.replayed as boolean }
}
export async function importBgaPlay(client: SupabaseClient<Database>, command: ImportBgaCommand): Promise<BgaMutation> {
  assertUuid(command.requestId); validateInput(command.payload)
  if (command.payload.scores.some(score => score.id !== null || typeof score.score === 'string') ||
      command.positions.length !== command.payload.scores.length || command.positions.some(position => position !== null && (!Number.isInteger(position) || position < 1 || position > 2147483647)) ||
      !command.metadata.bga_table_id.trim() || command.metadata.bga_table_id.length > 256) invalid('Dati di importazione non validi')
  const token = await authorize(client, command.actorId)
  const value = await invoke(client, token, 'import_bga_play_v1', { p_request_id: command.requestId, p_payload: payloadJson(command.payload),
    p_metadata: { ...command.metadata }, p_positions: command.positions })
  const response = mutation(value)
  assertResponse(record(value) && typeof value.skipped === 'boolean')
  return { ...response, skipped: value.skipped as boolean }
}
export async function getPlayEditor(client: SupabaseClient<Database>, playId: string, actorId: string): Promise<PlayEditor> {
  assertUuid(playId); const token = await authorize(client, actorId)
  const value = await invoke(client, token, 'get_web_play_editor_v1', { p_play_id: playId })
  assertResponse(record(value) && typeof value.revision === 'string' && revisionPattern.test(value.revision) && record(value.detail))
  const detail = value.detail as Record<string, unknown>
  assertResponse(record(detail.play) && detail.play.id === playId && typeof detail.play.played_at === 'string' &&
    nullableUuid(detail.play.user_id) && nullableUuid(detail.play.game_id) && nullableInteger(detail.play.duration_minutes) &&
    nullableString(detail.play.source) && nullableString(detail.play.notes) && nullableBoolean(detail.play.is_cooperative) && nullableBoolean(detail.play.team_won) &&
    (detail.game === null || (record(detail.game) && typeof detail.game.id === 'string' && typeof detail.game.name === 'string')) && Array.isArray(detail.scores))
  const ids = new Set<string>()
  for (const entry of detail.scores as unknown[]) {
    assertResponse(record(entry) && record(entry.score) && typeof entry.score.id === 'string' && uuid.test(entry.score.id) &&
      entry.score.play_id === playId && nullableUuid(entry.score.player_id) && nullableInteger(entry.score.position) &&
      (entry.score.score === null || (typeof entry.score.score === 'string' && decimalPattern.test(entry.score.score))) &&
      (entry.score.winner === null || typeof entry.score.winner === 'boolean') &&
      (entry.score.color === null || typeof entry.score.color === 'string') && (entry.score.role === null || typeof entry.score.role === 'string') &&
      (entry.player === null || (record(entry.player) && entry.player.id === entry.score.player_id && typeof entry.player.name === 'string' && nullableString(entry.player.alias))))
    const score = entry.score as Record<string, unknown>
    assertResponse(!ids.has(score.id as string)); ids.add(score.id as string)
  }
  return value as unknown as PlayEditor
}
