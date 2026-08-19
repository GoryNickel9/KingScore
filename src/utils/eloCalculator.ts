import type { SupabaseClient } from '@supabase/supabase-js'
import { calculateELOForGame, simulateAllPlays } from './elo/simulation'
import type { PlayerInput, SimulationPlay } from './elo/simulation'
import { performFullRecalc } from './elo/recalc'
import type { RecalcSummary } from './elo/recalc'

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
 * Questo modulo gestisce SOLO cache e persistenza: l'algoritmo di simulazione
 * vive nel core puro src/utils/elo/simulation.ts, la pipeline di ricalcolo
 * bulk in src/utils/elo/recalc.ts.
 */

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface GeneralELOResult {
  playerId: string
  rating: number
  gamesPlayed: number
  wins: number
  losses: number
  draws: number
}

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

// ─── Aggiornamento a caldo (dopo una singola partita) ──────────────────────
/**
 * Aggiorna i rating ELO nel database dopo una partita
 */
export async function updateELOAfterGame(supabase: SupabaseClient, gameId: string, players: PlayerInput[], userId: string | null = null): Promise<Record<string, unknown>[]> {
  try {
    // Calcola i nuovi rating
    const eloResults = calculateELOForGame(players);

    // Aggiorna i rating nel database
    const updatePromises = eloResults.map(async (result) => {
      const { data: existingRating } = await supabase
        .from('player_ratings')
        .select('*')
        .eq('player_id', result.playerId)
        .eq('game_id', gameId)
        .maybeSingle();

      const playerData = players.find(p => p.playerId === result.playerId);
      const isWinner = playerData?.winner || false;
      const isDraw = playerData?.draw || false;

      if (existingRating) {
        // Aggiorna il rating esistente
        const { data, error } = await supabase
          .from('player_ratings')
          .update({
            rating: result.newRating,
            games_played: existingRating.games_played + 1,
            wins: existingRating.wins + (isWinner ? 1 : 0),
            losses: existingRating.losses + (!isWinner && !isDraw ? 1 : 0),
            draws: existingRating.draws + (isDraw ? 1 : 0),
            last_played_at: new Date().toISOString()
          })
          .eq('id', existingRating.id)
          .select()
          .single();

        if (error) throw error;
        return data;
      } else {
        // Crea un nuovo rating
        const { data, error } = await supabase
          .from('player_ratings')
          .insert({
            player_id: result.playerId,
            game_id: gameId,
            rating: result.newRating,
            games_played: 1,
            wins: isWinner ? 1 : 0,
            losses: !isWinner && !isDraw ? 1 : 0,
            draws: isDraw ? 1 : 0,
            last_played_at: new Date().toISOString()
          })
          .select()
          .single();

        if (error) throw error;
        return data;
      }
    });

    const updatedRatings = await Promise.all(updatePromises);

    // Aggiorna l'ELO Generale per ogni giocatore se userId è fornito
    if (userId) {
      const generalELOPromises = players.map(async (player) => {
        try {
          await updateGeneralELO(supabase, player.playerId, userId);
        } catch (error) {
          console.error(`Errore nell'aggiornamento dell'ELO Generale per il giocatore ${player.playerId}:`, error);
          // Non bloccare l'intero processo se l'aggiornamento dell'ELO Generale fallisce
        }
      });
      await Promise.all(generalELOPromises);
    }

    return updatedRatings;
  } catch (error) {
    console.error('Errore nell\'aggiornamento dei rating ELO:', error);
    throw error;
  }
}

/**
 * Ottieni i rating ELO per un gioco specifico
 */
export async function getELOForGame(supabase: SupabaseClient, gameId: string): Promise<Record<string, unknown>[]> {
  try {
    const { data, error } = await supabase
      .from('player_ratings')
      .select(`
        *,
        players(*)
      `)
      .eq('game_id', gameId)
      .order('rating', { ascending: false });

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Errore nel recupero dei rating ELO:', error);
    throw error;
  }
}

/**
 * Ottieni i rating ELO per un giocatore specifico
 */
export async function getELOForPlayer(supabase: SupabaseClient, playerId: string): Promise<Record<string, unknown>[]> {
  try {
    const { data, error } = await supabase
      .from('player_ratings')
      .select(`
        *,
        games(*)
      `)
      .eq('player_id', playerId)
      .order('rating', { ascending: false });

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Errore nel recupero dei rating ELO del giocatore:', error);
    throw error;
  }
}

/**
 * Calcola l'ELO Generale (aggregato) per un giocatore
 * L'ELO Generale è una media ponderata degli ELO specifici per gioco
 */
export async function calculateGeneralELO(supabase: SupabaseClient, playerId: string): Promise<GeneralELOResult | null> {
  try {
    // Recupera tutti gli ELO specifici per gioco del giocatore
    const { data: gameRatings, error } = await supabase
      .from('player_ratings')
      .select('*')
      .eq('player_id', playerId);

    if (error) throw error;

    if (!gameRatings || gameRatings.length === 0) {
      return null;
    }

    // Calcola l'ELO Generale come media ponderata
    // Il peso è il numero di partite giocate in quel gioco
    let totalWeightedRating = 0;
    let totalWeight = 0;
    let totalGamesPlayed = 0;
    let totalWins = 0;
    let totalLosses = 0;
    let totalDraws = 0;

    gameRatings.forEach((rating: any) => {
      const weight: number = rating.games_played;
      totalWeightedRating += rating.rating * weight;
      totalWeight += weight;
      totalGamesPlayed += rating.games_played;
      totalWins += rating.wins;
      totalLosses += rating.losses;
      totalDraws += rating.draws;
    });

    const generalRating = totalWeight > 0 ? Math.round(totalWeightedRating / totalWeight) : 1000;

    return {
      playerId,
      rating: generalRating,
      gamesPlayed: totalGamesPlayed,
      wins: totalWins,
      losses: totalLosses,
      draws: totalDraws
    };
  } catch (error) {
    console.error('Errore nel calcolo dell\'ELO Generale:', error);
    throw error;
  }
}

/**
 * Aggiorna l'ELO Generale per un giocatore
 */
export async function updateGeneralELO(supabase: SupabaseClient, playerId: string, userId: string): Promise<GeneralELOResult> {
  try {
    // Calcola il nuovo ELO Generale
    const generalELO = await calculateGeneralELO(supabase, playerId);

    if (!generalELO) {
      // Se non ci sono ELO specifici, crea un ELO Generale di default
      const { data, error } = await supabase
        .from('player_general_ratings')
        .upsert({
          player_id: playerId,
          user_id: userId,
          rating: 1000,
          games_played: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          last_played_at: new Date().toISOString()
        }, {
          onConflict: 'player_id,user_id'
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    }

    // Aggiorna o crea l'ELO Generale
    const { data, error } = await supabase
      .from('player_general_ratings')
      .upsert({
        player_id: playerId,
        user_id: userId,
        rating: generalELO.rating,
        games_played: generalELO.gamesPlayed,
        wins: generalELO.wins,
        losses: generalELO.losses,
        draws: generalELO.draws,
        last_played_at: new Date().toISOString()
      }, {
        onConflict: 'player_id,user_id'
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Errore nell\'aggiornamento dell\'ELO Generale:', error);
    throw error;
  }
}

/**
 * Ottieni l'ELO Generale per un giocatore
 */
export async function getGeneralELO(supabase: SupabaseClient, playerId: string): Promise<GeneralELOResult | null> {
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
export async function getAllGeneralELO(supabase: SupabaseClient, userId: string | null): Promise<GeneralELOResult[]> {
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
export async function recalculateAllELO(supabase: SupabaseClient, userId: string): Promise<RecalcSummary> {
  return performFullRecalc(supabase, userId)
}

/**
 * Salva in batch le entry della storia ELO nella tabella elo_history.
 * Viene chiamata da getELOHistoryForGame e getGeneralELOHistory in caso di cache miss.
 * Gli errori di chiave duplicata (es. chiamate concorrenti) vengono ignorati silenziosamente.
 */
export async function saveELOHistoryEntries(supabase: SupabaseClient, entries: ELOHistoryDBEntry[]): Promise<void> {
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
export async function getELOHistoryForGame(supabase: SupabaseClient, gameId: string, userId: string | null = null): Promise<ELOHistoryEntry[]> {
  try {
    // ── Controllo cache ───────────────────────────────────────────────────────
    const { data: cached, error: cacheError } = await supabase
      .from('elo_history')
      .select('play_id, player_id, player_name, rating, rating_change, date')
      .eq('game_id', gameId)
      .eq('is_general', false)
      .order('date', { ascending: true })
      .limit(10000)

    if (cacheError) {
      console.warn('[getELOHistoryForGame] Cache read failed (RLS/policy issue?), recomputing:', cacheError.message)
    }

    if (cached && cached.length > 0) {
      return cached.map(entry => ({
        date: entry.date,
        playId: entry.play_id,
        playerId: entry.player_id,
        playerName: entry.player_name,
        rating: entry.rating,
        ratingChange: entry.rating_change
      }))
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Cache miss: unica lettura del gioco + simulazione col core puro condiviso
    let query = supabase
      .from('plays')
      .select(`
        *,
        play_scores(
          *,
          players(*)
        )
      `)
      .eq('game_id', gameId)
      .order('played_at', { ascending: true })
      .limit(10000)

    // Filtra per user_id solo se fornito
    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data: plays, error } = await query;

    if (error) throw error;

    if (!plays || plays.length === 0) return [];

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
export async function getGeneralELOHistory(supabase: SupabaseClient, userId: string | null = null): Promise<GeneralELOHistoryEntry[]> {
  try {
    // ── Controllo cache (solo per utenti autenticati) ─────────────────────────
    if (userId) {
      const { data: cached, error: cacheError } = await supabase
        .from('elo_history')
        .select('play_id, player_id, player_name, rating, rating_change, date, games_played')
        .eq('is_general', true)
        .eq('user_id', userId)
        .order('date', { ascending: true })
        .limit(10000)

      if (cacheError) {
        console.warn('[getGeneralELOHistory] Cache read failed (RLS/policy issue?), recomputing:', cacheError.message)
      }

      if (cached && cached.length > 0) {
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
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Cache miss: unica lettura di tutte le partite (senza join games(*), mai
    // usato dalla simulazione) + core puro condiviso
    let query = supabase
      .from('plays')
      .select(`
        *,
        play_scores(
          *,
          players(*)
        )
      `)
      .order('played_at', { ascending: true })
      .limit(10000)

    // Filtra per user_id solo se fornito
    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data: plays, error } = await query;

    if (error) throw error;

    if (!plays || plays.length === 0) return [];

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
export async function invalidateELOHistory(supabase: SupabaseClient, playId: string): Promise<void> {
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
      .eq('game_id', play.game_id)
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
