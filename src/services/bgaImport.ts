import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/db'
import { withRetry } from '../utils/retry'
import { XMLParser } from 'fast-xml-parser'
import type { AtomicPlayWriter, PlayWriterDependencies } from './atomicPlayWriter'
import { preparePlaySave, type PlayScoreInput } from './playSaveRequests'

/**
 * La pagina risolve i nomi; il servizio salva ogni partita completa tramite
 * import_bga_play_v1. Cataloghi separati, deduplicazione e ricevute sul server.
 */

export interface BgaImportPlayer {
  name: string | null
  score?: string | number | null
  winner?: boolean
  position?: string | number | null
}

export interface BgaImportPlay {
  bga_table_id: string
  game_name: string
  played_at: string | null
  duration_minutes: number | null
  location: string | null
  players: BgaImportPlayer[]
}

export interface BgaConfirmedItem {
  raw: string
  name: string | null
}

export type ImportLogType = 'info' | 'success' | 'warning' | 'error'

export interface BgaImportHooks {
  onLog: (message: string, type: ImportLogType) => void
  onProgress: (percent: number) => void
}

export interface BgaImportResult {
  imported: number
  skipped: number
  errors: number
  total: number
  stopped: 'pending' | 'uncertain' | 'session' | 'catalog' | null
}

export interface BgaAtomicImportOptions {
  writer: Pick<AtomicPlayWriter, 'save'>
  session: PlayWriterDependencies['session']
  online: PlayWriterDependencies['online']
  /** Account-scoped journal check. Corrupt/unavailable storage must throw, never report false. */
  hasPendingSave(): boolean
}

const CATALOG_PAGE_SIZE = 1000
const MAX_CATALOG_ROWS = 10000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
class ImportSessionError extends Error {}
class ImportCatalogError extends Error {}
class ImportPendingError extends Error {}

const parser = new XMLParser()

export async function fetchGameImageFromBGG(gameName: string): Promise<string | null> {
  try {
    // Search for the game on BGG (retry: BGG throttla e risponde spesso 502/202)
    const searchUrl = `https://boardgamegeek.com/xmlapi2/search?query=${encodeURIComponent(gameName)}&type=boardgame`
    const searchResponse = await withRetry(() => fetch(searchUrl))
    const searchXml = await searchResponse.text()
    const searchResult = parser.parse(searchXml)

    const items = searchResult?.items?.item
    if (!items) return null

    const gameId = Array.isArray(items) ? items[0].id : items.id
    if (!gameId) return null

    const detailsUrl = `https://boardgamegeek.com/xmlapi2/thing?id=${gameId}&stats=1`
    const detailsResponse = await withRetry(() => fetch(detailsUrl))
    const detailsXml = await detailsResponse.text()
    const detailsResult = parser.parse(detailsXml)

    const items2 = detailsResult?.items?.item
    if (!items2) return null

    const game = Array.isArray(items2) ? items2[0] : items2
    return (game?.image as string) || null
  } catch (error) {
    console.error('Error fetching game image from BGG:', error)
    return null
  }
}

/** Disambiguation is complete before entering this service. No partial participant import. */
export async function runBgaImport(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: BgaImportPlay[],
  _confirmedItems: BgaConfirmedItem[],
  hooks: BgaImportHooks,
  options: BgaAtomicImportOptions,
): Promise<BgaImportResult> {
  const actor = userId.toLowerCase()
  if (!UUID.test(actor)) throw new ImportSessionError('Account non valido')
  // Copy before the first await: edits to the page cannot alter an in-flight batch.
  const plays = input.map(play => ({ ...play, players: play.players.map(player => ({ ...player })) }))
  const result: BgaImportResult = { imported: 0, skipped: 0, errors: 0, total: plays.length, stopped: null }
  hooks.onProgress(0)
  function pending() {
    let unresolved = true
    try { unresolved = options.hasPendingSave() } catch { /* Fail closed for unreadable storage. */ }
    if (!unresolved) return false
    result.stopped = 'pending'
    hooks.onLog('Importazione sospesa: risolvere il salvataggio pendente dalla sezione di recupero.', 'warning')
    return true
  }

  async function verify() {
    if (!options.online()) throw new ImportSessionError('Internet necessario')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ImportSessionError('Verifica account scaduta')), 30_000)
      })
      const session = await Promise.race([options.session(), deadline])
      if (!session || session.actorId.toLowerCase() !== actor || !session.admin || !session.accessToken || !options.online()) {
        throw new ImportSessionError('Account amministratore verificato necessario')
      }
    } catch { throw new ImportSessionError('Account amministratore verificato necessario') }
    finally { clearTimeout(timer) }
  }
  async function guarded<T>(operation: () => PromiseLike<T>): Promise<T> {
    await verify()
    if (pending()) throw new ImportPendingError()
    let value: T
    try { value = await operation() }
    catch { throw new ImportCatalogError('Operazione catalogo non confermata') }
    await verify()
    return value
  }
  async function catalog(table: 'games' | 'players') {
    const names = new Map<string, string | null>()
    for (let offset = 0; offset < MAX_CATALOG_ROWS; offset += CATALOG_PAGE_SIZE) {
      const response = await guarded(() => {
        let query = supabase.from(table).select('id, name').order('id')
        if (table === 'players') query = query.eq('user_id', actor)
        return query.range(offset, offset + CATALOG_PAGE_SIZE - 1)
      })
      if (response.error || !response.data) throw new ImportCatalogError('Catalogo non disponibile')
      for (const entry of response.data) {
        if (!UUID.test(entry.id) || !entry.name) throw new ImportCatalogError('Catalogo non valido')
        names.set(entry.name, names.has(entry.name) ? null : entry.id)
      }
      if (response.data.length < CATALOG_PAGE_SIZE) return names
    }
    // A truncated catalogue must never make an existing name look new.
    throw new ImportCatalogError('Catalogo oltre il limite di importazione')
  }
  function scoreText(value: BgaImportPlayer['score']): string | null {
    if (value === undefined || value === null) return null
    if (typeof value === 'string') return value
    // Legacy page numbers are accepted only when their integer representation is exact.
    if (!Number.isSafeInteger(value)) throw new TypeError('Usare testo per punteggi decimali o oltre gli interi sicuri')
    return String(value)
  }
  function position(value: BgaImportPlayer['position']): number | null {
    if (value === undefined || value === null || value === '') return null
    if (typeof value === 'string' && !/^0*[1-9][0-9]*$/.test(value)) throw new TypeError('Posizione non valida')
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 2147483647) throw new TypeError('Posizione non valida')
    return parsed
  }

  try {
    await verify()
    if (pending()) return result
    const [games, players] = await Promise.all([catalog('games'), catalog('players')])
    for (let index = 0; index < plays.length; index++) {
      const play = plays[index]
      hooks.onProgress(Math.round((index / plays.length) * 95))
      try {
        await verify()
        if (pending()) break
        const names = play.players.map(player => player.name)
        if (!play.game_name || names.some(name => !name || !name.trim()) ||
          new Set(names).size !== names.length || !play.played_at) throw new TypeError('Partecipanti, gioco o data non validi')
        const positions = play.players.map(player => position(player.position))
        const scores: PlayScoreInput[] = play.players.map((player, ordinal) => ({
          id: null, player_id: `00000000-0000-0000-0000-${String(ordinal + 1).padStart(12, '0')}`,
          score: scoreText(player.score), winner: player.winner ?? false, color: null, role: null,
        }))
        const payload = { game_id: actor, played_at: play.played_at, duration_minutes: play.duration_minutes,
          source: 'offline' as const, notes: null, is_cooperative: false, team_won: null, scores }
        const metadata = { location: play.location, bga_table_id: play.bga_table_id }
        // Validate every supplied field before creating catalogue entries.
        preparePlaySave(actor, 'import_bga_play_v1', { p_request_id: actor, p_payload: payload,
          p_metadata: metadata, p_positions: positions })
        if (games.get(play.game_name) === null || names.some(name => players.get(name!) === null)) {
          throw new TypeError('Nome ambiguo nel catalogo')
        }
        let gameId = games.get(play.game_name)
        if (!gameId) {
          const imageUrl = await guarded(() => fetchGameImageFromBGG(play.game_name))
          const created = await guarded(() => supabase.from('games')
            .insert({ name: play.game_name, bga_id: null, image_url: imageUrl }).select('id').single())
          if (created.error || !created.data || !UUID.test(created.data.id)) throw new ImportCatalogError('Creazione gioco non confermata')
          gameId = created.data.id; games.set(play.game_name, gameId)
        }
        for (let ordinal = 0; ordinal < play.players.length; ordinal++) {
          const name = play.players[ordinal].name!
          let playerId = players.get(name)
          if (!playerId) {
            const created = await guarded(() => supabase.from('players')
              .insert({ user_id: actor, name, is_me: false }).select('id').single())
            if (created.error || !created.data || !UUID.test(created.data.id)) throw new ImportCatalogError('Creazione giocatore non confermata')
            playerId = created.data.id; players.set(name, playerId)
          }
          scores[ordinal].player_id = playerId
        }
        // All participant IDs exist before constructing the one immutable mutation.
        await verify()
        if (pending()) break
        const request = preparePlaySave(actor, 'import_bga_play_v1', {
          p_request_id: crypto.randomUUID(), p_payload: { ...payload, game_id: gameId },
          p_metadata: metadata, p_positions: positions,
        })
        await verify()
        let outcome
        try { outcome = await options.writer.save(request) }
        catch {
          // The writer owns receipt persistence; never guess whether transmission began.
          result.stopped = 'uncertain'
          hooks.onLog('Importazione sospesa: verificare il salvataggio dalla sezione di recupero.', 'warning')
          break
        }
        if (outcome.kind === 'uncertain') {
          result.stopped = 'uncertain'
          hooks.onLog("Esito incerto: recuperare la richiesta prima di riprendere l'importazione.", 'warning')
          break
        }
        await verify()
        if (outcome.kind === 'rejected') {
          result.errors++
          hooks.onLog(`Partita ${play.bga_table_id} rifiutata dal server.`, 'error')
          if (outcome.status === 401 || outcome.status === 403) { result.stopped = 'session'; break }
        } else if (outcome.receipt.skipped) result.skipped++
        else result.imported++
      } catch (error) {
        if (error instanceof ImportSessionError || error instanceof ImportCatalogError || error instanceof ImportPendingError) throw error
        result.errors++
        hooks.onLog(`Partita ${play.bga_table_id} non importata: dati non validi.`, 'error')
      }
    }
  } catch (error) {
    if (error instanceof ImportPendingError) return result
    result.stopped = error instanceof ImportSessionError ? 'session' : 'catalog'
    hooks.onLog(result.stopped === 'session' ? 'Importazione sospesa: verificare account e connessione.' :
      'Importazione sospesa: catalogo non disponibile o creazione non confermata.', 'error')
  }
  if (!result.stopped) hooks.onProgress(100)
  return result
}
