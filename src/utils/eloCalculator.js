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
 * Per giochi con 2 giocatori:
 * - Usa il metodo ELO classico
 * - Il risultato atteso è calcolato confrontando il rating del giocatore
 *   con il rating dell'avversario
 *
 * Per giochi con 3+ giocatori:
 * - Usa il metodo pairwise (all-pairs)
 * - Il risultato atteso è calcolato confrontando il rating del giocatore
 *   con ogni altro giocatore e facendo la media
 * - Il risultato reale è basato sulla posizione finale nella partita
 */

/**
 * Calcola il risultato atteso per un giocatore contro altri giocatori (metodo classico)
 * @param {number} playerRating - Rating del giocatore
 * @param {number[]} opponentRatings - Array dei rating degli avversari
 * @returns {number} Risultato atteso (0-1)
 */
export function calculateExpectedScore(playerRating, opponentRatings) {
  if (opponentRatings.length === 0) return 0.5;

  // Calcola la media dei rating degli avversari
  const avgOpponentRating = opponentRatings.reduce((sum, r) => sum + r, 0) / opponentRatings.length;

  // Formula logistica ELO
  const expectedScore = 1 / (1 + Math.pow(10, (avgOpponentRating - playerRating) / 400));

  return expectedScore;
}

/**
 * Calcola il risultato atteso per un giocatore usando il metodo pairwise
 * Questo metodo calcola il risultato atteso contro ogni altro giocatore e fa la media
 * @param {number} playerRating - Rating del giocatore
 * @param {number[]} opponentRatings - Array dei rating degli avversari
 * @returns {number} Risultato atteso (0-1)
 */
export function calculateExpectedScorePairwise(playerRating, opponentRatings) {
  if (opponentRatings.length === 0) return 0.5;

  // Calcola il risultato atteso contro ogni avversario
  const expectedScores = opponentRatings.map(opponentRating => {
    return 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
  });

  // Fai la media di tutti i risultati attesi
  const avgExpectedScore = expectedScores.reduce((sum, score) => sum + score, 0) / expectedScores.length;

  return avgExpectedScore;
}

/**
 * Calcola il risultato reale basato sulla posizione finale nella partita
 * @param {number} playerPosition - Posizione del giocatore (1 = primo)
 * @param {number} totalPlayers - Numero totale di giocatori
 * @param {boolean} isWinner - Se il giocatore ha vinto
 * @returns {number} Risultato reale (0-1)
 */
export function calculateActualScore(playerPosition, totalPlayers, isWinner) {
  if (isWinner) return 1;
  
  // Per non vincitori, assegna un punteggio basato sulla posizione
  // L'ultimo riceve 0, il primo non vincitore riceve (totalPlayers - 2) / (totalPlayers - 1)
  if (playerPosition === totalPlayers) return 0;
  
  const score = (totalPlayers - playerPosition) / (totalPlayers - 1);
  return Math.max(0, Math.min(1, score));
}

/**
 * Calcola il nuovo rating ELO per un giocatore
 * @param {number} currentRating - Rating attuale del giocatore
 * @param {number} expectedScore - Risultato atteso (0-1)
 * @param {number} actualScore - Risultato reale (0-1)
 * @param {number} kFactor - Fattore K (default: 32)
 * @returns {number} Nuovo rating
 */
export function calculateNewRating(currentRating, expectedScore, actualScore, kFactor = 32) {
  const ratingChange = kFactor * (actualScore - expectedScore);
  const newRating = Math.round(currentRating + ratingChange);
  
  return newRating;
}

/**
 * Calcola il fattore K basato sul numero di partite giocate
 * @param {number} gamesPlayed - Numero di partite giocate
 * @returns {number} Fattore K
 */
export function calculateKFactor(gamesPlayed) {
  // Nuovi giocatori (< 10 partite): K = 48 per adattamento più rapido
  // Giocatori esperti (10-30 partite): K = 32
  // Giocatori molto esperti (>= 30 partite): K = 24 per maggiore stabilità

  if (gamesPlayed < 10) return 48;
  if (gamesPlayed < 30) return 32;
  return 24;
}

/**
 * Calcola i nuovi rating ELO per tutti i giocatori in una partita
 * @param {Array} players - Array di giocatori con i loro dati
 * @param {Array} players[].playerId - ID del giocatore
 * @param {number} players[].currentRating - Rating attuale del giocatore
 * @param {number} players[].gamesPlayed - Numero di partite giocate
 * @param {boolean} players[].winner - Se il giocatore ha vinto
 * @param {number} players[].position - Posizione nella partita (opzionale)
 * @returns {Array} Array con i nuovi rating calcolati
 *
 * Note:
 * - Per 2 giocatori: usa il metodo ELO classico
 * - Per 3+ giocatori: usa il metodo pairwise (all-pairs)
 */
export function calculateELOForGame(players) {
  if (players.length < 2) {
    throw new Error('Servono almeno 2 giocatori per calcolare il rating ELO');
  }

  // Calcola le posizioni se non fornite
  const playersWithPositions = players.map((player, index) => ({
    ...player,
    position: player.position !== undefined ? player.position : index + 1
  }));

  // Ordina i giocatori per posizione (vincitori primi)
  const sortedPlayers = [...playersWithPositions].sort((a, b) => a.position - b.position);

  // Assegna le posizioni corrette gestendo i pareggi
  let currentPosition = 1;
  sortedPlayers.forEach((player, index) => {
    if (index > 0 && sortedPlayers[index - 1].position !== player.position) {
      currentPosition = index + 1;
    }
    player.finalPosition = currentPosition;
  });

  // Calcola i nuovi rating per ogni giocatore
  // Usa il metodo pairwise per 3+ player, metodo classico per 2 player
  const usePairwise = players.length >= 3;

  const results = sortedPlayers.map(player => {
    const opponentRatings = playersWithPositions
      .filter(p => p.playerId !== player.playerId)
      .map(p => p.currentRating);

    // Usa il metodo appropriato in base al numero di giocatori
    const expectedScore = usePairwise
      ? calculateExpectedScorePairwise(player.currentRating, opponentRatings)
      : calculateExpectedScore(player.currentRating, opponentRatings);

    const actualScore = calculateActualScore(player.finalPosition, players.length, player.winner);
    const kFactor = calculateKFactor(player.gamesPlayed);
    const newRating = calculateNewRating(player.currentRating, expectedScore, actualScore, kFactor);

    return {
      playerId: player.playerId,
      oldRating: player.currentRating,
      newRating,
      ratingChange: newRating - player.currentRating,
      expectedScore: expectedScore.toFixed(3),
      actualScore: actualScore.toFixed(3),
      kFactor
    };
  });

  return results;
}

/**
 * Aggiorna i rating ELO nel database dopo una partita
 * @param {Object} supabase - Client Supabase
 * @param {string} gameId - ID del gioco
 * @param {Array} players - Array di giocatori con i loro dati
 * @param {string} userId - ID dell'utente (opzionale, per aggiornare l'ELO Generale)
 * @returns {Promise<Array>} Array con i rating aggiornati
 */
export async function updateELOAfterGame(supabase, gameId, players, userId = null) {
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
 * @param {Object} supabase - Client Supabase
 * @param {string} gameId - ID del gioco
 * @returns {Promise<Array>} Array di rating ELO ordinati
 */
export async function getELOForGame(supabase, gameId) {
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
 * @param {Object} supabase - Client Supabase
 * @param {string} playerId - ID del giocatore
 * @returns {Promise<Array>} Array di rating ELO per tutti i giochi
 */
export async function getELOForPlayer(supabase, playerId) {
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
 * @param {Object} supabase - Client Supabase
 * @param {string} playerId - ID del giocatore
 * @returns {Promise<Object|null>} Oggetto con l'ELO generale o null
 */
export async function calculateGeneralELO(supabase, playerId) {
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

    gameRatings.forEach(rating => {
      const weight = rating.games_played;
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
 * @param {Object} supabase - Client Supabase
 * @param {string} playerId - ID del giocatore
 * @param {string} userId - ID dell'utente
 * @returns {Promise<Object>} L'ELO Generale aggiornato
 */
export async function updateGeneralELO(supabase, playerId, userId) {
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
 * @param {Object} supabase - Client Supabase
 * @param {string} playerId - ID del giocatore
 * @returns {Promise<Object|null>} L'ELO Generale o null
 */
export async function getGeneralELO(supabase, playerId) {
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
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID dell'utente (opzionale, se non fornito mostra tutti)
 * @returns {Promise<Array>} Array di ELO Generali ordinati
 */
export async function getAllGeneralELO(supabase, userId) {
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
 * Ricalcola tutti gli ELO Generali per un utente
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID dell'utente
 * @returns {Promise<void>}
 */
export async function recalculateAllGeneralELO(supabase, userId) {
  try {
    // Recupera tutti i giocatori dell'utente
    const { data: players, error: playersError } = await supabase
      .from('players')
      .select('id')
      .eq('user_id', userId);

    if (playersError) throw playersError;

    // Aggiorna l'ELO Generale per ogni giocatore
    for (const player of players || []) {
      await updateGeneralELO(supabase, player.id, userId);
    }
  } catch (error) {
    console.error('Errore nel ricalcolo degli ELO Generali:', error);
    throw error;
  }
}

/**
 * Ricalcola tutti i rating ELO per un gioco partendo dalle partite storiche
 * @param {Object} supabase - Client Supabase
 * @param {string} gameId - ID del gioco
 * @param {string} userId - ID dell'utente
 * @returns {Promise<void>}
 */
export async function recalculateAllELOForGame(supabase, gameId, userId) {
  try {
    // Elimina tutti i rating esistenti per questo gioco
    await supabase
      .from('player_ratings')
      .delete()
      .eq('game_id', gameId);

    // Recupera tutte le partite per questo gioco ordinate cronologicamente
    const { data: plays } = await supabase
      .from('plays')
      .select(`
        *,
        play_scores(
          *,
          players(*)
        )
      `)
      .eq('game_id', gameId)
      .eq('user_id', userId)
      .order('played_at', { ascending: true });

    if (!plays || plays.length === 0) return;

    // Mappa per tenere traccia dell'ELO corrente di ogni giocatore
    const playerRatings = {};

    // Processa ogni partita in ordine cronologico
    for (const play of plays) {
      if (!play.play_scores || play.play_scores.length < 2) continue;

      // Prepara i dati dei giocatori per il calcolo ELO
      const playersData = play.play_scores.map((score) => {
        const playerId = score.player_id;

        // Inizializza il rating per questo giocatore se non esiste
        if (!playerRatings[playerId]) {
          playerRatings[playerId] = {
            playerId,
            currentRating: 1000,
            gamesPlayed: 0
          };
        }

        return {
          playerId: score.player_id,
          currentRating: playerRatings[playerId].currentRating,
          gamesPlayed: playerRatings[playerId].gamesPlayed,
          winner: score.winner || false,
          position: score.position || undefined,
          score: score.score
        };
      });

      // Calcola le posizioni se non sono definite
      // Ordina i giocatori: vincitori prima, poi per punteggio decrescente
      const sortedPlayers = [...playersData].sort((a, b) => {
        if (a.winner && !b.winner) return -1;
        if (!a.winner && b.winner) return 1;
        if (a.score !== null && b.score !== null) {
          return b.score - a.score;
        }
        return 0;
      });

      // Assegna le posizioni
      let currentPosition = 1;
      const winnersCount = sortedPlayers.filter(p => p.winner).length;
      sortedPlayers.forEach((player, index) => {
        if (player.winner) {
          player.position = 1;
        } else if (index === winnersCount) {
          currentPosition = winnersCount + 1;
          player.position = currentPosition;
        } else if (!player.winner) {
          currentPosition++;
          player.position = currentPosition;
        }
      });

      // Calcola i nuovi rating ELO
      const eloResults = calculateELOForGame(playersData);

      // Aggiorna i rating nel mapping
      eloResults.forEach((result) => {
        if (playerRatings[result.playerId]) {
          playerRatings[result.playerId].currentRating = result.newRating;
          playerRatings[result.playerId].gamesPlayed++;
        }
      });

      // Salva i rating nel database
      await updateELOAfterGame(supabase, gameId, playersData, userId);
    }
  } catch (error) {
    console.error('Errore nel ricalcolo dei rating ELO:', error);
    throw error;
  }
}

/**
 * Calcola lo storico degli ELO per un gioco specifico
 * Questa funzione simula il calcolo degli ELO nel tempo senza salvare nel database
 * @param {Object} supabase - Client Supabase
 * @param {string} gameId - ID del gioco
 * @param {string} userId - ID dell'utente (opzionale)
 * @returns {Promise<Array>} Array di oggetti con data, giocatore e ELO per il grafico
 */
export async function getELOHistoryForGame(supabase, gameId, userId = null) {
  try {
    // Recupera tutte le partite per questo gioco ordinate cronologicamente
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
      .order('played_at', { ascending: true });

    // Filtra per user_id solo se fornito
    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data: plays, error } = await query;

    if (error) throw error;

    if (!plays || plays.length === 0) return [];

    // Mappa per tenere traccia dell'ELO corrente di ogni giocatore
    const playerRatings = {};
    const eloHistory = [];

    // Processa ogni partita in ordine cronologico
    for (const play of plays) {
      if (!play.play_scores || play.play_scores.length < 2) continue;

      // Prepara i dati dei giocatori per il calcolo ELO
      const playersData = play.play_scores.map((score) => {
        // Recupera o inizializza il rating corrente del giocatore
        if (!playerRatings[score.player_id]) {
          playerRatings[score.player_id] = {
            playerId: score.player_id,
            playerName: score.players?.alias || score.players?.name || 'Unknown',
            currentRating: 1000,
            gamesPlayed: 0
          };
        }

        return {
          playerId: score.player_id,
          playerName: score.players?.alias || score.players?.name || 'Unknown',
          currentRating: playerRatings[score.player_id].currentRating,
          gamesPlayed: playerRatings[score.player_id].gamesPlayed,
          winner: score.winner || false,
          position: score.position || undefined,
          score: score.score
        };
      });

      // Calcola le posizioni se non sono definite
      const sortedPlayers = [...playersData].sort((a, b) => {
        if (a.winner && !b.winner) return -1;
        if (!a.winner && b.winner) return 1;
        if (a.score !== null && b.score !== null) {
          return b.score - a.score;
        }
        return 0;
      });

      // Assegna le posizioni
      let currentPosition = 1;
      const winnersCount = sortedPlayers.filter(p => p.winner).length;
      sortedPlayers.forEach((player, index) => {
        if (player.winner) {
          player.position = 1;
        } else if (index === winnersCount) {
          currentPosition = winnersCount + 1;
          player.position = currentPosition;
        } else if (!player.winner) {
          currentPosition++;
          player.position = currentPosition;
        }
      });

      // Calcola i nuovi rating ELO
      const eloResults = calculateELOForGame(playersData);

      // Aggiorna i rating nel mapping e salva nello storico
      eloResults.forEach((result) => {
        // Aggiorna il rating corrente del giocatore
        if (playerRatings[result.playerId]) {
          playerRatings[result.playerId].currentRating = result.newRating;
          playerRatings[result.playerId].gamesPlayed++;
        }

        // Aggiungi allo storico
        const playerData = playersData.find(p => p.playerId === result.playerId);
        eloHistory.push({
          date: play.played_at,
          playId: play.id,
          playerId: result.playerId,
          playerName: playerData?.playerName || 'Unknown',
          rating: result.newRating,
          ratingChange: result.ratingChange
        });
      });
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
 * @param {Object} supabase - Client Supabase
 * @param {string} userId - ID dell'utente (opzionale)
 * @returns {Promise<Array>} Array di oggetti con data, giocatore e ELO Generale per il grafico
 */
export async function getGeneralELOHistory(supabase, userId = null) {
  try {
    // Recupera tutte le partite ordinate cronologicamente
    let query = supabase
      .from('plays')
      .select(`
        *,
        play_scores(
          *,
          players(*)
        ),
        games(*)
      `)
      .order('played_at', { ascending: true });

    // Filtra per user_id solo se fornito
    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data: plays, error } = await query;

    if (error) throw error;

    if (!plays || plays.length === 0) return [];

    console.log(`[getGeneralELOHistory] Recuperate ${plays.length} partite totali`);

    // Mappa per tenere traccia dell'ELO corrente di ogni giocatore per ogni gioco
    const playerGameRatings = {};
    const generalELOHistory = [];
    let playCounter = 0;
    let skippedPlays = 0;
    let processedPlays = 0;

    // Processa ogni partita in ordine cronologico
    for (const play of plays) {
      playCounter++;

      if (!play.play_scores || play.play_scores.length < 2) {
        const scoresCount = play.play_scores?.length || 0;
        const reason = scoresCount === 0 
          ? 'Nessun punteggio associato (partita incompleta o errata)' 
          : `Solo ${scoresCount} punteggio/i (servono almeno 2 per il calcolo ELO)`;
        console.log(`[getGeneralELOHistory] Partita ${playCounter} (${play.id}) saltata: ${reason}`);
        skippedPlays++;
        continue;
      }

      processedPlays++;
      const gameId = play.game_id;

      // Inizializza lo stato per questo gioco se non esiste
      if (!playerGameRatings[gameId]) {
        playerGameRatings[gameId] = {};
      }

      // Prepara i dati dei giocatori per il calcolo ELO
      const playersData = play.play_scores.map((score) => {
        const playerId = score.player_id;
        const playerName = score.players?.alias || score.players?.name || 'Unknown';

        // Inizializza il rating per questo gioco se non esiste
        if (!playerGameRatings[gameId][playerId]) {
          playerGameRatings[gameId][playerId] = {
            playerId,
            playerName,
            currentRating: 1000,
            gamesPlayed: 0
          };
        }

        return {
          playerId,
          playerName,
          currentRating: playerGameRatings[gameId][playerId].currentRating,
          gamesPlayed: playerGameRatings[gameId][playerId].gamesPlayed,
          winner: score.winner || false,
          position: score.position || undefined,
          score: score.score
        };
      });

      // Calcola le posizioni se non sono definite
      const sortedPlayers = [...playersData].sort((a, b) => {
        if (a.winner && !b.winner) return -1;
        if (!a.winner && b.winner) return 1;
        if (a.score !== null && b.score !== null) {
          return b.score - a.score;
        }
        return 0;
      });

      // Assegna le posizioni
      let currentPosition = 1;
      const winnersCount = sortedPlayers.filter(p => p.winner).length;
      sortedPlayers.forEach((player, index) => {
        if (player.winner) {
          player.position = 1;
        } else if (index === winnersCount) {
          currentPosition = winnersCount + 1;
          player.position = currentPosition;
        } else if (!player.winner) {
          currentPosition++;
          player.position = currentPosition;
        }
      });

      // Calcola i nuovi rating ELO
      const eloResults = calculateELOForGame(playersData);

      // Aggiorna i rating nel mapping
      eloResults.forEach((result) => {
        if (playerGameRatings[gameId][result.playerId]) {
          playerGameRatings[gameId][result.playerId].currentRating = result.newRating;
          playerGameRatings[gameId][result.playerId].gamesPlayed++;
        }
      });

      // Calcola l'ELO Generale per ogni giocatore dopo questa partita
      const playersInPlay = play.play_scores.map(score => score.player_id);

      for (const playerId of playersInPlay) {
        // Calcola l'ELO Generale come media ponderata degli ELO specifici per gioco
        let totalWeightedRating = 0;
        let totalWeight = 0;
        let totalGamesPlayed = 0;

        for (const gId in playerGameRatings) {
          if (playerGameRatings[gId][playerId]) {
            const gameRating = playerGameRatings[gId][playerId];
            const weight = gameRating.gamesPlayed;
            totalWeightedRating += gameRating.currentRating * weight;
            totalWeight += weight;
            totalGamesPlayed += gameRating.gamesPlayed;
          }
        }

        const generalRating = totalWeight > 0 ? Math.round(totalWeightedRating / totalWeight) : 1000;

        // Trova il nome del giocatore
        let playerName = 'Unknown';
        for (const gId in playerGameRatings) {
          if (playerGameRatings[gId][playerId]) {
            playerName = playerGameRatings[gId][playerId].playerName;
            break;
          }
        }

        generalELOHistory.push({
          date: play.played_at,
          playId: play.id,
          playerId,
          playerName,
          rating: generalRating,
          gamesPlayed: totalGamesPlayed
        });
      }

      playCounter++;
    }

    console.log(`[getGeneralELOHistory] Riepilogo: ${plays.length} partite totali, ${processedPlays} processate, ${skippedPlays} saltate, ${generalELOHistory.length} punti nel grafico`);

    return generalELOHistory;
  } catch (error) {
    console.error('Errore nel calcolo dello storico ELO Generale:', error);
    throw error;
  }
}
