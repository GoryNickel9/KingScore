import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Trophy, Award, Gamepad2, Star, RefreshCw } from 'lucide-react'
import { getAllGeneralELO, recalculateAllELO } from '../utils/eloCalculator'
import toast from 'react-hot-toast'
import { getPlayerImageUrl } from '../utils/imageUpload'
import { Spinner } from '../components/Spinner'
import type { DbGeneralRatingWithPlayer, DbPlayerRatingWithPlayer } from '../types/rows'

/** View model: gioco con conteggio partite, costruito aggregando plays. */
interface DbEloGame {
  id: string
  name: string
  image_url: string | null
  playCount: number
}

interface MyPlayer {
  id: string
}

const ELO = () => {
  const { user } = useAuth()

  const [games, setGames] = useState<DbEloGame[]>([])
  const [selectedGame, setSelectedGame] = useState<DbEloGame | null>(null)
  const [ratings, setRatings] = useState<DbPlayerRatingWithPlayer[]>([])
  const [myPlayer, setMyPlayer] = useState<MyPlayer | null>(null)
  const [loading, setLoading] = useState<boolean>(true)

  // ELO Generale
  const [generalRatings, setGeneralRatings] = useState<DbGeneralRatingWithPlayer[]>([])

  // Pulsante temporaneo per calcolare ELO esistenti
  const [recalculatingAll, setRecalculatingAll] = useState<boolean>(false)

  useEffect(() => {
    void fetchGames()
    void fetchMyPlayer()
    void fetchGeneralRatings()
  }, [])

  useEffect(() => {
    if (selectedGame) {
      void fetchRatings(selectedGame.id)
    }
  }, [selectedGame])

  const fetchGames = async (): Promise<void> => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('plays')
        .select('game_id, games(*)')
        .not('game_id', 'is', null)

      if (error) throw error

      // Raggruppa i giochi e conta le partite
      const gameCounts: Record<string, DbEloGame> = {}
      ;(data ?? []).forEach(play => {
        if (play.games && play.game_id) {
          if (!gameCounts[play.game_id]) {
            gameCounts[play.game_id] = {
              id: play.game_id,
              name: play.games.name,
              image_url: play.games.image_url,
              playCount: 0
            }
          }
          gameCounts[play.game_id].playCount++
        }
      })

      const gamesList = Object.values(gameCounts)
        .sort((a, b) => b.playCount - a.playCount)

      setGames(gamesList)

      // Seleziona automaticamente il primo gioco se disponibile
      if (gamesList.length > 0 && !selectedGame) {
        setSelectedGame(gamesList[0])
      }
    } catch (error) {
      console.error('Errore nel recupero dei giochi:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchMyPlayer = async (): Promise<void> => {
    try {
      if (!user) {
        setMyPlayer(null)
        return
      }
      const { data, error } = await supabase
        .from('players')
        .select('id')
        .eq('user_id', user.id)
        .eq('is_me', true)
        .maybeSingle()

      if (error) throw error
      setMyPlayer(data as MyPlayer | null)
    } catch (error) {
      console.error('Errore nel recupero del giocatore:', error)
    }
  }

  const fetchRatings = async (gameId: string): Promise<void> => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('player_ratings')
        .select(`
          *,
          players(*)
        `)
        .eq('game_id', gameId)
        .order('rating', { ascending: false })

      if (error) throw error
      setRatings(data ?? [])
    } catch (error) {
      console.error('Errore nel recupero dei rating ELO:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchGeneralRatings = async (): Promise<void> => {
    try {
      const data = await getAllGeneralELO(supabase, user?.id ?? null)
      setGeneralRatings(data)
    } catch (error) {
      console.error('Errore nel recupero degli ELO Generali:', error)
    }
  }

  const handleRecalculateAll = async (): Promise<void> => {
    if (!user) return
    const userId = user.id
    try {
      setRecalculatingAll(true)

      // Ricalcolo completo con pipeline bulk: unica lettura → simulazione in
      // memoria → scritture massive (~6-10 richieste totali)
      const summary = await recalculateAllELO(supabase, userId)
      console.log('[ELO] Ricalcolo completato:', summary)

      // Ricarica i dati
      await fetchGeneralRatings()
      if (selectedGame) {
        await fetchRatings(selectedGame.id)
      }

      toast.success('Tutti gli ELO ricalcolati con successo!')
    } catch (error) {
      console.error('Errore nel ricalcolo degli ELO:', error)
      toast.error('Errore nel ricalcolo degli ELO')
    } finally {
      setRecalculatingAll(false)
    }
  }

  const getRatingColor = (rating: number): string => {
    if (rating >= 1500) return 'text-purple-400'
    if (rating >= 1100) return 'text-orange-400'
    if (rating >= 1050) return 'text-emerald-400'
    return 'text-slate-400'
  }

  const getRatingBadge = (rating: number): { label: string; color: string } => {
    if (rating >= 1500) return { label: 'Maestro', color: 'bg-purple-500/20 text-purple-400' }
    if (rating >= 1100) return { label: 'Esperto', color: 'bg-orange-500/20 text-orange-400' }
    if (rating >= 1050) return { label: 'Intermedio', color: 'bg-emerald-500/20 text-emerald-400' }
    return { label: 'Principiante', color: 'bg-slate-500/20 text-slate-400' }
  }

  const getWinRate = (wins: number, losses: number, draws: number): number => {
    const total = wins + losses + draws
    if (total === 0) return 0
    return Math.round((wins / total) * 100)
  }

  if (loading && games.length === 0) {
    return <Spinner className="h-64" />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center">
            <Trophy className="w-8 h-8 mr-3 text-emerald-500" />
            Rating ELO
          </h1>
          <p className="mt-2 text-slate-400">Classifica dei giocatori per ogni gioco</p>
        </div>
        <div className="flex items-center space-x-2">
          {user && (
            <button
              onClick={handleRecalculateAll}
              disabled={recalculatingAll}
              className="flex items-center space-x-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-800 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              <RefreshCw className={`w-5 h-5 ${recalculatingAll ? 'animate-spin' : ''}`} />
              <span>{recalculatingAll ? 'Ricalcolo in corso...' : 'Ricalcola Tutti gli ELO'}</span>
            </button>
          )}
        </div>
      </div>

      {/* ELO Generale */}
      <div className="bg-slate-800 rounded-xl p-6 shadow-md">
        <div className="flex items-center mb-6">
          <Star className="w-6 h-6 mr-2 text-yellow-500" />
          <h2 className="text-xl font-bold text-white">ELO Generale</h2>
          <span className="ml-3 text-sm text-slate-400">(Classifica aggregata tutti i giochi)</span>
        </div>

        {generalRatings.length === 0 ? (
          <div className="text-center py-12">
            <Star className="w-16 h-16 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400">Nessun ELO Generale disponibile</p>
            <p className="text-sm text-slate-500 mt-2">
              Gioca qualche partita per vedere l'ELO Generale calcolato automaticamente
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {generalRatings.map((rating, index) => {
              const isMyPlayer = rating.player_id === myPlayer?.id
              const badge = getRatingBadge(rating.rating ?? 0)
              const winRate = getWinRate(rating.wins ?? 0, rating.losses ?? 0, rating.draws ?? 0)

              return (
                <div
                  key={rating.id}
                  className={`flex items-center justify-between p-4 rounded-lg transition-all ${
                    isMyPlayer
                      ? 'bg-yellow-500/10 border-2 border-yellow-500/50'
                      : 'bg-slate-700'
                  }`}
                >
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-slate-600">
                      <span className="text-white font-bold">
                        {index + 1}
                      </span>
                    </div>

                    {rating.players?.avatar_url ? (
                      <img
                        src={getPlayerImageUrl(supabase, rating.players?.avatar_url) ?? undefined}
                        alt={rating.players?.alias || rating.players?.name || 'Unknown'}
                        className="w-12 h-12 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 bg-slate-600 rounded-full flex items-center justify-center">
                        <span className="text-white font-bold text-lg">
                          {(rating.players?.alias || rating.players?.name || '?').charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}

                    <div>
                      <div className="flex items-center space-x-2">
                        <p className="text-white font-medium">
                          {rating.players?.alias || rating.players?.name || 'Unknown'}
                        </p>
                        {isMyPlayer && (
                          <span className="px-2 py-1 text-xs rounded-full bg-yellow-500/20 text-yellow-400">
                            Tu
                          </span>
                        )}
                      </div>
                      <div className="flex items-center space-x-3 mt-1">
                        <span className={`text-xs px-2 py-1 rounded-full ${badge.color}`}>
                          {badge.label}
                        </span>
                        <span className="text-xs text-slate-400">
                          {rating.games_played} partite totali
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-6">
                    <div className="text-right">
                      <p className={`text-3xl font-bold ${getRatingColor(rating.rating ?? 0)}`}>
                        {rating.rating}
                      </p>
                      <p className="text-xs text-slate-400">ELO Generale</p>
                    </div>

                    <div className="text-right hidden md:block">
                      <p className="text-white font-medium">{winRate}%</p>
                      <p className="text-xs text-slate-400">Win Rate</p>
                    </div>

                    <div className="flex items-center space-x-4 text-sm">
                      <div className="text-center">
                        <p className="text-emerald-400 font-bold">{rating.wins}</p>
                        <p className="text-xs text-slate-400">V</p>
                      </div>
                      <div className="text-center">
                        <p className="text-slate-400 font-bold">{rating.draws}</p>
                        <p className="text-xs text-slate-400">P</p>
                      </div>
                      <div className="text-center">
                        <p className="text-red-400 font-bold">{rating.losses}</p>
                        <p className="text-xs text-slate-400">S</p>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Selezione Gioco */}
      <div className="bg-slate-800 rounded-xl p-6 shadow-md">
        <h2 className="text-xl font-bold text-white mb-4 flex items-center">
          <Gamepad2 className="w-6 h-6 mr-2 text-emerald-500" />
          Seleziona un Gioco
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {games.map((game) => (
            <button
              key={game.id}
              onClick={() => setSelectedGame(game)}
              className={`p-4 rounded-lg transition-all duration-200 ${
                selectedGame?.id === game.id
                  ? 'bg-emerald-500/20 border-2 border-emerald-500'
                  : 'bg-slate-700 border-2 border-transparent hover:bg-slate-600'
              }`}
            >
              <div className="flex flex-col items-center">
                {game.image_url && (
                  <img
                    src={game.image_url}
                    alt={game.name}
                    className="w-16 h-16 object-cover rounded mb-2"
                  />
                )}
                <p className="text-white text-sm font-medium text-center line-clamp-2">
                  {game.name}
                </p>
                <p className="text-slate-400 text-xs mt-1">{game.playCount} partite</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Rating ELO per Gioco Selezionato */}
      {selectedGame && (
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center">
              {selectedGame.image_url && (
                <img
                  src={selectedGame.image_url}
                  alt={selectedGame.name}
                  className="w-12 h-12 object-cover rounded mr-4"
                />
              )}
              <div>
                <h2 className="text-xl font-bold text-white">{selectedGame.name}</h2>
                <p className="text-sm text-slate-400">
                  {ratings.length} giocatori con rating ELO
                </p>
              </div>
            </div>
          </div>

          {ratings.length === 0 ? (
            <div className="text-center py-12">
              <Trophy className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">Nessun rating ELO disponibile per questo gioco</p>
              <p className="text-sm text-slate-500 mt-2">
                Gioca qualche partita per vedere gli ELO calcolati automaticamente
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {ratings.map((rating, index) => {
                const isMyPlayer = rating.player_id === myPlayer?.id
                const badge = getRatingBadge(rating.rating ?? 0)
                const winRate = getWinRate(rating.wins ?? 0, rating.losses ?? 0, rating.draws ?? 0)

                return (
                  <div
                    key={rating.id}
                    className={`flex items-center justify-between p-4 rounded-lg transition-all ${
                      isMyPlayer
                        ? 'bg-emerald-500/10 border-2 border-emerald-500/50'
                        : 'bg-slate-700'
                    }`}
                  >
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center justify-center w-10 h-10 rounded-full bg-slate-600">
                        <span className="text-white font-bold">
                          {index + 1}
                        </span>
                      </div>

                      {rating.players?.avatar_url ? (
                        <img
                          src={getPlayerImageUrl(supabase, rating.players?.avatar_url) ?? undefined}
                          alt={rating.players?.alias || rating.players?.name || 'Unknown'}
                          className="w-12 h-12 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 bg-slate-600 rounded-full flex items-center justify-center">
                          <span className="text-white font-bold text-lg">
                            {(rating.players?.alias || rating.players?.name || '?').charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}

                      <div>
                        <div className="flex items-center space-x-2">
                          <p className="text-white font-medium">
                            {rating.players?.alias || rating.players?.name || 'Unknown'}
                          </p>
                          {isMyPlayer && (
                            <span className="px-2 py-1 text-xs rounded-full bg-emerald-500/20 text-emerald-400">
                              Tu
                            </span>
                          )}
                        </div>
                        <div className="flex items-center space-x-3 mt-1">
                          <span className={`text-xs px-2 py-1 rounded-full ${badge.color}`}>
                            {badge.label}
                          </span>
                          <span className="text-xs text-slate-400">
                            {rating.games_played} partite
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-6">
                      <div className="text-right">
                        <p className={`text-3xl font-bold ${getRatingColor(rating.rating ?? 0)}`}>
                          {rating.rating}
                        </p>
                        <p className="text-xs text-slate-400">ELO</p>
                      </div>

                      <div className="text-right hidden md:block">
                        <p className="text-white font-medium">{winRate}%</p>
                        <p className="text-xs text-slate-400">Win Rate</p>
                      </div>

                      <div className="flex items-center space-x-4 text-sm">
                        <div className="text-center">
                          <p className="text-emerald-400 font-bold">{rating.wins}</p>
                          <p className="text-xs text-slate-400">V</p>
                        </div>
                        <div className="text-center">
                          <p className="text-slate-400 font-bold">{rating.draws}</p>
                          <p className="text-xs text-slate-400">P</p>
                        </div>
                        <div className="text-center">
                          <p className="text-red-400 font-bold">{rating.losses}</p>
                          <p className="text-xs text-slate-400">S</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Spiegazione del sistema ELO */}
      <div className="bg-slate-800 rounded-xl p-6 shadow-md">
        <h2 className="text-xl font-bold text-white mb-4 flex items-center">
          <Award className="w-6 h-6 mr-2 text-emerald-500" />
          Come Funziona il Sistema ELO
        </h2>
        <div className="space-y-4 text-slate-300">
          <div>
            <h3 className="text-white font-medium mb-2">🎯 Rating Iniziale</h3>
            <p className="text-sm">
              Ogni giocatore inizia con un rating di 1000 punti per ogni gioco.
            </p>
          </div>
          <div>
            <h3 className="text-white font-medium mb-2">⚡ Fattore K (K-Factor)</h3>
            <p className="text-sm">
              Il fattore K determina quanto velocemente cambia il rating:
            </p>
            <ul className="text-sm mt-2 space-y-1 ml-4 list-disc">
              <li><strong className="text-emerald-400">K=48</strong> per nuovi giocatori (&lt;10 partite)</li>
              <li><strong className="text-yellow-400">K=32</strong> per giocatori esperti (10-30 partite)</li>
              <li><strong className="text-orange-400">K=24</strong> per giocatori molto esperti (≥30 partite)</li>
            </ul>
          </div>
          <div>
            <h3 className="text-white font-medium mb-2">📊 Calcolo del Nuovo Rating</h3>
            <p className="text-sm">
              Nuovo Rating = Rating Attuale + K × (Risultato Reale - Risultato Atteso)
            </p>
            <p className="text-sm mt-2">
              <strong>Per 2 giocatori:</strong> Usa il metodo ELO classico, confrontando direttamente i rating dei due giocatori.
            </p>
            <p className="text-sm mt-2">
              <strong>Per 3+ giocatori:</strong> Usa il metodo pairwise (all-pairs), calcolando il risultato atteso contro ogni altro giocatore e facendo la media.
            </p>
          </div>
          <div>
            <h3 className="text-white font-medium mb-2">🏆 Livelli di Rating</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
              <div className="flex items-center space-x-2">
                <span className="w-3 h-3 rounded-full bg-purple-400"></span>
                <span className="text-sm">1500+ Maestro</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="w-3 h-3 rounded-full bg-orange-400"></span>
                <span className="text-sm">1100-1499 Esperto</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="w-3 h-3 rounded-full bg-emerald-400"></span>
                <span className="text-sm">1050-1099 Intermedio</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="w-3 h-3 rounded-full bg-slate-400"></span>
                <span className="text-sm">&lt;1050 Principiante</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ELO
