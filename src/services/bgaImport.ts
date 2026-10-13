import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/db'
import { getErrorMessage } from '../utils/errors'
import { withRetry } from '../utils/retry'
import { XMLParser } from 'fast-xml-parser'

/**
 * Persistenza dell'import partite BGA (TD-018).
 *
 * Il componente Import.tsx si occupa di parsing e disambiguazione dei nomi;
 * questo servizio riceve le partite già risolte e le persiste con un
 * pre-caricamento in memoria (3 query) invece del pattern N+1 precedente
 * (~7-10 query per partita): per 100 partite × 4 giocatori si passa da
 * ~2000 richieste sequenziali a ~2 per partita + 3 di pre-caricamento.
 *
 * L'inserimento dei play_scores resta per-partita (non bulk finale) per
 * mantenere l'isolamento degli errori: una partita o è salvata completa
 * o è conteggiata come errore.
 */

export interface BgaImportPlayer {
  name: string | null
  score?: number | null
  winner?: boolean
  position?: string
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
}

const PRELOAD_LIMIT = 10000

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

export async function runBgaImport(
  supabase: SupabaseClient<Database>,
  userId: string,
  plays: BgaImportPlay[],
  confirmedItems: BgaConfirmedItem[],
  hooks: BgaImportHooks
): Promise<BgaImportResult> {
  hooks.onProgress(0)
  let imported = 0
  let skipped = 0
  let errors = 0

  // ── Pre-caricamento (3 query parallele): elimina il pattern N+1 ──
  const [{ data: existingPlays }, { data: existingGames }, { data: existingPlayers }] = await Promise.all([
    supabase.from('plays')
      .select('bga_table_id')
      .eq('user_id', userId)
      .not('bga_table_id', 'is', null)
      .limit(PRELOAD_LIMIT),
    supabase.from('games')
      .select('id, name')
      .eq('user_id', userId)
      .limit(PRELOAD_LIMIT),
    supabase.from('players')
      .select('id, name')
      .eq('user_id', userId)
      .limit(PRELOAD_LIMIT),
  ])

  const knownTableIds = new Set<string>(
    (existingPlays ?? [])
      .map(row => row.bga_table_id)
      .filter((id): id is string => id !== null)
  )
  const gameIdsByName = new Map<string, string>()
  for (const game of existingGames ?? []) gameIdsByName.set(game.name, game.id)
  const playerIdsByName = new Map<string, string>()
  for (const player of existingPlayers ?? []) playerIdsByName.set(player.name, player.id)

  // Memorizza i nomi confermati in disambiguazione
  for (const item of confirmedItems) {
    if (!item.name || playerIdsByName.has(item.name)) continue
    const { data: newPlayer } = await supabase.from('players')
      .insert({ user_id: userId, name: item.name, is_me: false })
      .select('id')
      .single()
    if (newPlayer) {
      playerIdsByName.set(item.name, newPlayer.id)
      hooks.onLog(`Giocatore memorizzato: ${item.name}`, 'info')
    }
  }

  for (let i = 0; i < plays.length; i++) {
    const play = plays[i]
    hooks.onProgress(Math.round((i / plays.length) * 95))

    try {
      if (knownTableIds.has(play.bga_table_id)) { skipped++; continue }

      let gameId = gameIdsByName.get(play.game_name)
      if (!gameId) {
        const imageUrl = await fetchGameImageFromBGG(play.game_name)
        hooks.onLog(
          imageUrl ? `Immagine trovata per: ${play.game_name}` : `Nessuna immagine trovata per: ${play.game_name}`,
          imageUrl ? 'info' : 'warning'
        )

        const { data: newGame } = await supabase.from('games')
          .insert({ name: play.game_name, bga_id: null, image_url: imageUrl })
          .select('id')
          .single()
        if (newGame) {
          gameId = newGame.id
          gameIdsByName.set(play.game_name, newGame.id)
          hooks.onLog(`Nuovo gioco: ${play.game_name}`, 'info')
        }
      }

      if (!gameId) { errors++; hooks.onLog(`Impossibile creare gioco per ${play.bga_table_id}`, 'error'); continue }
      if (!play.played_at) { errors++; hooks.onLog(`Data mancante per ${play.bga_table_id}`, 'error'); continue }

      const { data: newPlay, error: playError } = await supabase.from('plays')
        .insert({
          user_id: userId,
          game_id: gameId,
          played_at: play.played_at,
          location: play.location,
          duration_minutes: play.duration_minutes,
          source: 'offline',
          bga_table_id: play.bga_table_id
        })
        .select('id')
        .single()

      if (playError) throw playError
      knownTableIds.add(play.bga_table_id)

      const scoreRows: { play_id: string; player_id: string; score: number | null; winner: boolean; position: number | null }[] = []
      for (const p of play.players) {
        if (!p.name) continue
        let playerId = playerIdsByName.get(p.name)
        if (!playerId) {
          const { data: newPlayer } = await supabase.from('players')
            .insert({ user_id: userId, name: p.name, is_me: false })
            .select('id')
            .single()
          if (!newPlayer) continue
          playerId = newPlayer.id
          playerIdsByName.set(p.name, newPlayer.id)
        }
        scoreRows.push({
          play_id: newPlay.id,
          player_id: playerId,
          score: p.score ?? null,
          winner: p.winner || false,
          position: p.position ? parseInt(p.position) : null
        })
      }

      const { error: scoresError } = await supabase.from('play_scores').insert(scoreRows)
      if (scoresError) throw scoresError

      imported++
    } catch (err) {
      errors++
      hooks.onLog(`Errore partita ${play.bga_table_id}: ${getErrorMessage(err)}`, 'error')
    }
  }

  hooks.onProgress(100)
  return { imported, skipped, errors, total: plays.length }
}
