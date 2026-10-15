import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/db'
import { simulateAllPlays } from './elo/simulation'
import type { SimulationPlay } from './elo/simulation'
import { performFullRecalc } from './elo/recalc'
import type { RecalcSummary } from './elo/recalc'
import { fetchAllPages } from './pagination'
import type { DbGeneralRatingWithPlayer, DbPlayerGeneralRating } from '../types/rows'
import { atomicEloReadsEnabled, readGlobalElo } from './elo/readClient'
import { generalStandings, gameHistory, generalHistory } from './elo/projections'

async function publishedGeneralRatings(client: SupabaseClient<Database>): Promise<DbGeneralRatingWithPlayer[]> {
  const view = generalStandings(await readGlobalElo(client))
  return (view.data ?? []).map(player => ({
    id: player.playerId, player_id: player.playerId, rating: player.rating,
    games_played: player.gamesPlayed, wins: player.wins, losses: player.losses, draws: player.draws,
    last_played_at: player.lastPlayedAt, user_id: null, created_at: null, updated_at: null, players: null,
  }))
}

function requireLegacyWrites(): void {
  if (atomicEloReadsEnabled) throw new Error('Il ricalcolo ELO viene gestito dal server. Le scritture legacy sono disabilitate.')
}

// Le formule ELO pure vivono nel core condiviso con l'Edge Function notturna
// (src/utils/elo/simulation.ts); riesportate per retrocompatibilità.
export {
  calculateExpectedScore,
  calculateExpectedScorePairwise,
  calculateActualScore,
  calculateNewRating,
  calculateKFactor,
  calculateELOForGame
} from './elo/simulation'
export type { PlayerInput, EloResult } from './elo/simulation'

/**
 * Sistema di Rating ELO per giochi da tavolo
 *
 * Il sistema ELO è un metodo per calcolare il livello relativo dei giocatori
 * basato sulle loro performance nelle partite.
 *
 * Formula ELO base:
 * - Nuovo rating = Rating attuale + K × (Risultato atteso - Risultato reale)
 * - Risultato atteso = 1 / (1 + 10^((Rb - Ra)/400))
 *
 * Per giochi con 2 giocatori: metodo ELO classico.
 * Per giochi con 3+ giocatori: metodo pairwise (all-pairs).
 *
 * Con il flag atomico attivo le letture usano soltanto la pubblicazione globale
 * e le scritture legacy sono vietate. A flag disattivato restano i percorsi
 * cache/persistenza precedenti, con simulazione nel core e ricalcolo bulk.
 */

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface ELOHistoryEntry {
  date: string
  playId: string
  playerId: string
  playerName: string
  rating: number
  ratingChange: number
}

interface GeneralELOHistoryEntry {
  date: string
  playId: string
  playerId: string
  playerName: string
  rating: number
  ratingChange: number
  gamesPlayed: number
}

// Riga da persistere nella tabella elo_history (cache)
interface ELOHistoryDBEntry {
  play_id: string
  game_id: string | null   // null per ELO Generale
  player_id: string
  player_name: string
  rating: number
  rating_change: number
  date: string
  is_general: boolean
  games_played: number | null  // valorizzato solo per is_general = true
  user_id: string | null       // valorizzato per ELO Generale, per filtrare per utente
}

/**
 * Ottieni l'ELO Generale per un giocatore
 */
export async function getGeneralELO(supabase: SupabaseClient<Database>, playerId: string): Promise<DbPlayerGeneralRating | null> {
  if (atomicEloReadsEnabled) return (await publishedGeneralRatings(supabase)).find(player => player.player_id === playerId) ?? null
  try {
    const { data, error } = await supabase
      .from('player_general_ratings')
      .select('*')
      .eq('player_id', playerId)
      .maybeSingle();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Errore nel recupero dell\'ELO Generale:', error);
    throw error;
  }
}

/**
 * Ottieni tutti gli ELO Generali per un utente
 */
export async function getAllGeneralELO(supabase: SupabaseClient<Database>, userId: string | null): Promise<DbGeneralRatingWithPlayer[]> {
  if (atomicEloReadsEnabled) return publishedGeneralRatings(supabase)
  try {
    let query = supabase
      .from('player_general_ratings')
      .select(`
        *,
        players(*)
      `)

    // Filtra per user_id solo se fornito (utente registrato)
    if (userId) {
      query = query.eq('user_id', userId)
    }

    const { data, error } = await query.order('rating', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Errore nel recupero degli ELO Generali:', error);
    throw error;
  }
}

/**
 * Ricalcola da zero tutti i rating ELO dell'utente (per gioco e Generali) e
 * rigenera la cache elo_history, con la pipeline bulk condivisa con l'Edge
 * Function notturna: unica lettura → simulazione in memoria → scritture
 * massive (~6-10 richieste totali).
 */
export async function recalculateAllELO(supabase: SupabaseClient<Database>, userId: string): Promise<RecalcSummary> {
  requireLegacyWrites()
  return performFullRecalc(supabase, userId)
}

/**
 * Salva in batch le entry della storia ELO nella tabella elo_history.
 * Viene chiamata da getELOHistoryForGame e getGeneralELOHistory in caso di cache miss.
 * Gli errori di chiave duplicata (es. chiamate concorrenti) vengono ignorati silenziosamente.
 */
export async function saveELOHistoryEntries(supabase: SupabaseClient<Database>, entries: ELOHistoryDBEntry[]): Promise<void> {
  requireLegacyWrites()
  if (entries.length === 0) return
  const BATCH_SIZE = 500
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE)
    // upsert con ignoreDuplicates evita il 409 quando i dati esistono già
    // (es. doppio rendering in React StrictMode o sessioni concorrenti)
    const { error } = await supabase
      .from('elo_history')
      .upsert(batch, { ignoreDuplicates: true })
    if (error) {
      console.error('[saveELOHistoryEntries] Errore nel salvataggio della storia ELO:', error)
    }
  }
}

/**
 * Calcola lo storico degli ELO per un gioco specifico
 * Questa funzione simula il calcolo degli ELO nel tempo senza salvare nel database
 */
export async function getELOHistoryForGame(supabase: SupabaseClient<Database>, gameId: string, userId: string | null = null): Promise<ELOHistoryEntry[]> {
  if (atomicEloReadsEnabled) return [...(gameHistory(await readGlobalElo(supabase), gameId).data ?? [])]
  try {
    // ── Controllo cache ───────────────────────────────────────────────────────
    // Lettura paginata: anche per gioco le righe (partite × giocatori) possono
    // superare il cap PostgREST di 1000 righe e venire troncate in silenzio.
    try {
      const cached = await fetchAllPages<{
        play_id: string
        player_id: string
        player_name: string
        rating: number
        rating_change: number
        date: string
      }>((from, to) =>
        supabase
          .from('elo_history')
          .select('play_id, player_id, player_name, rating, rating_change, date', { count: 'exact' })
          .eq('game_id', gameId)
          .eq('is_general', false)
          .order('date', { ascending: true })
          .order('play_id', { ascending: true })
          .order('player_id', { ascending: true })
          .range(from, to)
      )

      if (cached.length > 0) {
        return cached.map(entry => ({
          date: entry.date,
          playId: entry.play_id,
          playerId: entry.player_id,
          playerName: entry.player_name,
          rating: entry.rating,
          ratingChange: entry.rating_change
        }))
      }
    } catch (cacheError) {
      console.warn('[getELOHistoryForGame] Cache read failed (RLS/policy issue?), recomputing:', (cacheError as Error).message)
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Cache miss: lettura del gioco (paginata, stesso cap PostgREST) +
    // simulazione col core puro condiviso
    const plays = await fetchAllPages((from, to) => {
      let query = supabase
        .from('plays')
        .select(`
          *,
          play_scores(
            *,
            players(*)
          )
        `, { count: 'exact' })
        .eq('game_id', gameId)
        .order('played_at', { ascending: true })
        .order('id', { ascending: true })

      // Filtra per user_id solo se fornito
      if (userId) {
        query = query.eq('user_id', userId)
      }

      return query.range(from, to)
    })

    if (plays.length === 0) return [];

    const sim = simulateAllPlays(plays as unknown as SimulationPlay[]);

    const eloHistory: ELOHistoryEntry[] = sim.gameHistory.map(point => ({
      date: point.date,
      playId: point.playId,
      playerId: point.playerId,
      playerName: point.playerName,
      rating: point.rating,
      ratingChange: point.ratingChange
    }))

    // ── Salva in cache (solo per utenti autenticati, il cui token autorizza INSERT) ──
    if (userId && sim.gameHistory.length > 0) {
      const dbEntries: ELOHistoryDBEntry[] = sim.gameHistory.map(point => ({
        play_id: point.playId,
        game_id: gameId,
        player_id: point.playerId,
        player_name: point.playerName,
        rating: point.rating,
        rating_change: point.ratingChange,
        date: point.date,
        is_general: false,
        games_played: null,
        user_id: userId
      }))
      await saveELOHistoryEntries(supabase, dbEntries)
    }

    return eloHistory;
  } catch (error) {
    console.error('Errore nel calcolo dello storico ELO:', error);
    throw error;
  }
}

/**
 * Calcola lo storico degli ELO Generali
 * Questa funzione simula il calcolo degli ELO Generali nel tempo senza salvare nel database
 */
export async function getGeneralELOHistory(supabase: SupabaseClient<Database>, userId: string | null = null): Promise<GeneralELOHistoryEntry[]> {
  if (atomicEloReadsEnabled) return [...(generalHistory(await readGlobalElo(supabase)).data ?? [])]
  try {
    // ── Controllo cache (solo per utenti autenticati) ─────────────────────────
    // Lettura paginata: con ~2,8 giocatori per partita la cache supera le
    // 1000 righe già intorno alla 350ª partita e PostgREST tronca in silenzio,
    // congelando il grafico sull'ultimo punto consegnato dalla prima pagina.
    if (userId) {
      try {
        const cached = await fetchAllPages<{
          play_id: string
          player_id: string
          player_name: string
          rating: number
          rating_change: number
          date: string
          games_played: number | null
        }>((from, to) =>
          supabase
            .from('elo_history')
            .select('play_id, player_id, player_name, rating, rating_change, date, games_played', { count: 'exact' })
            .eq('is_general', true)
            .eq('user_id', userId)
            .order('date', { ascending: true })
            .order('play_id', { ascending: true })
            .order('player_id', { ascending: true })
            .range(from, to)
        )

        if (cached.length > 0) {
          return cached.map(entry => ({
            date: entry.date,
            playId: entry.play_id,
            playerId: entry.player_id,
            playerName: entry.player_name,
            rating: entry.rating,
            ratingChange: entry.rating_change,
            gamesPlayed: entry.games_played ?? 0
          }))
        }
      } catch (cacheError) {
        console.warn('[getGeneralELOHistory] Cache read failed (RLS/policy issue?), recomputing:', (cacheError as Error).message)
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Cache miss: lettura di tutte le partite (paginata, stesso cap PostgREST;
    // niente join games(*), mai usato dalla simulazione) + core puro condiviso
    const plays = await fetchAllPages((from, to) => {
      let query = supabase
        .from('plays')
        .select(`
          *,
          play_scores(
            *,
            players(*)
          )
        `, { count: 'exact' })
        .order('played_at', { ascending: true })
        .order('id', { ascending: true })

      // Filtra per user_id solo se fornito
      if (userId) {
        query = query.eq('user_id', userId)
      }

      return query.range(from, to)
    })

    if (plays.length === 0) return [];

    const sim = simulateAllPlays(plays as unknown as SimulationPlay[]);

    const generalELOHistory: GeneralELOHistoryEntry[] = sim.generalHistory.map(point => ({
      date: point.date,
      playId: point.playId,
      playerId: point.playerId,
      playerName: point.playerName,
      rating: point.rating,
      ratingChange: point.ratingChange,
      gamesPlayed: point.gamesPlayed
    }))

    console.log(`[getGeneralELOHistory] Riepilogo: ${plays.length} partite totali, ${sim.processedPlays} processate, ${sim.skippedPlays} saltate, ${generalELOHistory.length} punti nel grafico`);

    // ── Salva in cache (solo per utenti autenticati) ──────────────────────────
    if (userId && generalELOHistory.length > 0) {
      const dbEntries: ELOHistoryDBEntry[] = sim.generalHistory.map(point => ({
        play_id: point.playId,
        game_id: null,
        player_id: point.playerId,
        player_name: point.playerName,
        rating: point.rating,
        rating_change: point.ratingChange,
        date: point.date,
        is_general: true,
        games_played: point.gamesPlayed,
        user_id: userId
      }))
      await saveELOHistoryEntries(supabase, dbEntries)
    }

    return generalELOHistory;
  } catch (error) {
    console.error('Errore nel calcolo dello storico ELO Generale:', error);
    throw error;
  }
}

/**
 * Invalida (elimina) la storia ELO cached per il gioco della partita modificata.
 * Da chiamare in EditPlay subito dopo aver salvato le modifiche alla partita.
 *
 * Perché si elimina l'intero gioco e non solo la singola partita:
 * l'ELO è cumulativo — modificare la partita N rende obsoleti i rating
 * di tutte le partite N+1, N+2, … per lo stesso gioco.
 * Il ricalcolo completo avverrà alla prossima apertura di Stats.
 */
export async function invalidateELOHistory(supabase: SupabaseClient<Database>, playId: string): Promise<void> {
  requireLegacyWrites()
  try {
    // Recupera il game_id della partita modificata
    const { data: play, error: playError } = await supabase
      .from('plays')
      .select('game_id')
      .eq('id', playId)
      .maybeSingle()

    if (playError) throw playError
    if (!play) return  // partita non trovata: nulla da invalidare

    // Elimina tutte le entry game-specific per questo gioco
    // (RLS garantisce che vengano eliminati solo i record dell'utente corrente)
    const { error: gameDeleteError } = await supabase
      .from('elo_history')
      .delete()
      .eq('game_id', play.game_id ?? '')
      .eq('is_general', false)

    if (gameDeleteError) throw gameDeleteError

    // Elimina tutte le entry di ELO Generale dell'utente corrente
    // (qualsiasi modifica a una partita impatta l'intera storia ELO Generale)
    const { error: generalDeleteError } = await supabase
      .from('elo_history')
      .delete()
      .eq('is_general', true)

    if (generalDeleteError) throw generalDeleteError
  } catch (error) {
    console.error('[invalidateELOHistory] Errore nella invalidazione della storia ELO:', error)
    throw error
  }
}
