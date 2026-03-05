import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { ArrowLeft, Calendar, MapPin, Clock, Edit, Trash2, Trophy, Gamepad2, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react'
import toast from 'react-hot-toast'
import { getELOHistoryForGame, getGeneralELO, getGeneralELOHistory } from '../utils/eloCalculator'

interface DbPlayer {
  id: string
  name: string
  alias?: string | null
  is_me?: boolean
}

interface DbPlayScore {
  id: string
  player_id: string
  score?: number | null
  winner: boolean
  position?: number | null
  players?: DbPlayer
}

interface DbGame {
  id: string
  name: string
  image_url?: string | null
}

interface DbPlay {
  id: string
  game_id: string
  played_at: string
  location?: string | null
  duration_minutes?: number | null
  source?: string
  notes?: string | null
  user_id?: string
  games?: DbGame
  play_scores?: DbPlayScore[]
}

interface EloHistoryEntry {
  playId: string
  playerId: string
  rating: number
  ratingChange: number
}

interface PlayerEloResult {
  currentRating: number
  ratingChange: number
}

const PlayDetail = () => {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [play, setPlay] = useState<DbPlay | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false)
  const [eloHistory, setEloHistory] = useState<EloHistoryEntry[]>([])
  const [loadingElo, setLoadingElo] = useState<boolean>(false)
  const [_generalELOs, setGeneralELOs] = useState<Record<string, unknown>>({})
  const [generalELOHistory, setGeneralELOHistory] = useState<EloHistoryEntry[]>([])

  useEffect(() => {
    fetchPlay()
  }, [id])

  const fetchPlay = async (): Promise<void> => {
    try {
      const { data } = await supabase
        .from('plays')
        .select(`
          *,
          games(*),
          play_scores(
            *,
            players(*)
          )
        `)
        .eq('id', id)
        .single()

      if (data) {
        setPlay(data as DbPlay)

        // Recupera lo storico ELO per questo gioco usando l'user_id del proprietario della partita
        if (data.game_id && data.user_id) {
          try {
            setLoadingElo(true)
            const history = await getELOHistoryForGame(supabase, data.game_id, data.user_id)
            setEloHistory(history as EloHistoryEntry[])
          } catch (error) {
            console.error('Error fetching ELO history:', error)
          } finally {
            setLoadingElo(false)
          }
        }

        // Recupera gli ELO Generali per ogni giocatore
        if (data.play_scores && data.play_scores.length > 0) {
          const eloPromises = (data.play_scores as DbPlayScore[]).map(async (score) => {
            try {
              const generalELO = await getGeneralELO(supabase, score.player_id)
              return { playerId: score.player_id, generalELO }
            } catch (error) {
              console.error(`Error fetching general ELO for player ${score.player_id}:`, error)
              return { playerId: score.player_id, generalELO: null }
            }
          })

          const eloResults = await Promise.all(eloPromises)
          const eloMap: Record<string, unknown> = {}
          eloResults.forEach(result => {
            eloMap[result.playerId] = result.generalELO
          })
          setGeneralELOs(eloMap)
        }

        // Recupera lo storico dell'ELO Generale usando l'user_id del proprietario della partita
        if (data.user_id) {
          try {
            const history = await getGeneralELOHistory(supabase, data.user_id)
            setGeneralELOHistory(history as EloHistoryEntry[])
          } catch (error) {
            console.error('Error fetching general ELO history:', error)
          }
        }
      } else {
        toast.error('Partita non trovata')
        navigate('/plays')
      }
    } catch (error) {
      console.error('Error fetching play:', error)
      toast.error('Errore durante il caricamento della partita')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (): Promise<void> => {
    try {
      const { error } = await supabase
        .from('plays')
        .delete()
        .eq('id', id)

      if (error) throw error

      toast.success('Partita eliminata con successo!')
      navigate('/plays')
    } catch (error) {
      console.error('Error deleting play:', error)
      toast.error("Errore durante l'eliminazione della partita")
    }
  }

  // Ottieni l'ELO attuale e l'ELO guadagnato per un giocatore in questa partita
  const getPlayerELO = (playerId: string): PlayerEloResult | null => {
    const eloEntry = eloHistory.find(entry =>
      entry.playId === play?.id && entry.playerId === playerId
    )

    if (!eloEntry) return null

    return {
      currentRating: eloEntry.rating,
      ratingChange: eloEntry.ratingChange
    }
  }

  // Ottieni l'ELO Generale e la variazione per un giocatore in questa partita
  const getPlayerGeneralELO = (playerId: string): PlayerEloResult | null => {
    const eloEntry = generalELOHistory.find(entry =>
      entry.playId === play?.id && entry.playerId === playerId
    )

    if (!eloEntry) return null

    return {
      currentRating: eloEntry.rating,
      ratingChange: eloEntry.ratingChange
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <svg className="animate-spin h-12 w-12 text-emerald-500 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="mt-4 text-slate-400">Caricamento...</p>
        </div>
      </div>
    )
  }

  if (!play) {
    return (
      <div className="text-center py-12">
        <Gamepad2 className="w-16 h-16 mx-auto mb-4 text-slate-600" />
        <h2 className="text-xl font-semibold text-white mb-2">Partita non trovata</h2>
        <Link to="/plays" className="text-emerald-500 hover:text-emerald-400">
          Torna allo storico
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link
            to="/plays"
            className="p-2 hover:bg-slate-800 rounded-lg transition"
          >
            <ArrowLeft className="w-5 h-5 text-slate-400" />
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-white">
              {play.games?.name || 'Gioco sconosciuto'}
            </h1>
            <p className="text-slate-400 mt-1">
              {new Date(play.played_at).toLocaleDateString('it-IT', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </p>
          </div>
        </div>

        {user && play.user_id === user.id && (
          <div className="flex space-x-2">
            <Link
              to={`/plays/${id}/edit`}
              className="flex items-center px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition"
            >
              <Edit className="w-4 h-4 mr-2" />
              Modifica
            </Link>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="flex items-center px-4 py-2 bg-red-500/20 text-red-500 rounded-lg hover:bg-red-500/30 transition"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Elimina
            </button>
          </div>
        )}
      </div>

      {/* Game Info Card */}
      <div className="bg-slate-800 rounded-xl p-6 shadow-md">
        <div className="flex items-start space-x-6">
          {play.games?.image_url ? (
            <img
              src={play.games.image_url}
              alt={play.games.name}
              className="w-32 h-32 object-cover rounded-lg flex-shrink-0"
            />
          ) : (
            <div className="w-32 h-32 bg-slate-700 rounded-lg flex items-center justify-center flex-shrink-0">
              <Gamepad2 className="w-16 h-16 text-slate-500" />
            </div>
          )}

          <div className="flex-1">
            <h2 className="text-2xl font-bold text-white mb-4">
              {play.games?.name || 'Gioco sconosciuto'}
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center text-slate-300">
                <Calendar className="w-5 h-5 mr-2 text-emerald-500" />
                <span>{new Date(play.played_at).toLocaleDateString('it-IT')}</span>
              </div>

              {play.location && (
                <div className="flex items-center text-slate-300">
                  <MapPin className="w-5 h-5 mr-2 text-emerald-500" />
                  <span>{play.location}</span>
                </div>
              )}

              {play.duration_minutes && (
                <div className="flex items-center text-slate-300">
                  <Clock className="w-5 h-5 mr-2 text-emerald-500" />
                  <span>{play.duration_minutes} minuti</span>
                </div>
              )}
            </div>

            <div className="mt-4">
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                play.source === 'online' ? 'bg-blue-500/20 text-blue-500' :
                play.source === 'offline' ? 'bg-orange-500/20 text-orange-500' :
                'bg-slate-700 text-slate-300'
              }`}>
                {play.source === 'online' ? 'Online' : play.source === 'offline' ? 'IRL' : play.source?.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        {play.notes && (
          <div className="mt-6 pt-6 border-t border-slate-700">
            <h3 className="text-sm font-medium text-slate-400 mb-2">Note</h3>
            <p className="text-white">{play.notes}</p>
          </div>
        )}
      </div>

      {/* Scores Table */}
      <div className="bg-slate-800 rounded-xl p-6 shadow-md">
        <h2 className="text-xl font-bold text-white mb-4">Punteggi</h2>

        {play.play_scores && play.play_scores.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Posizione</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Giocatore</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Punteggio</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Vincitore</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">ELO</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">ELO Generale</th>
                </tr>
              </thead>
              <tbody>
                {play.play_scores
                  .slice()
                  .sort((a, b) => {
                    if (a.winner) return -1
                    if (b.winner) return 1
                    if (a.score !== null && a.score !== undefined && b.score !== null && b.score !== undefined) {
                      return b.score - a.score
                    }
                    return 0
                  })
                  .map((score, index) => (
                    <tr
                      key={score.id}
                      className={`border-b border-slate-700 ${
                        score.winner ? 'bg-emerald-500/10' : ''
                      }`}
                    >
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${
                          index === 0 ? 'bg-yellow-500 text-white' :
                          index === 1 ? 'bg-slate-400 text-white' :
                          index === 2 ? 'bg-orange-600 text-white' :
                          'bg-slate-700 text-slate-300'
                        }`}>
                          {index + 1}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center">
                          <span className="text-white font-medium">
                            {score.players?.alias || score.players?.name || 'Sconosciuto'}
                          </span>
                          {score.players?.alias && score.players?.name && score.players.alias !== score.players.name && (
                            <span className="ml-2 text-xs text-slate-400">
                              ({score.players.name})
                            </span>
                          )}
                          {score.players?.is_me && (
                            <span className="ml-2 px-2 py-0.5 bg-emerald-500/20 text-emerald-500 text-xs rounded-full">
                              Sei tu
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-white">
                        {score.score !== null && score.score !== undefined ? score.score : '-'}
                      </td>
                      <td className="py-3 px-4">
                        {score.winner && (
                          <div className="flex items-center text-emerald-500">
                            <Trophy className="w-4 h-4 mr-1" />
                            <span className="text-sm font-medium">Vincitore</span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {loadingElo ? (
                          <span className="text-slate-400">Caricamento...</span>
                        ) : (() => {
                          const playerELO = getPlayerELO(score.player_id)
                          if (!playerELO) return <span className="text-slate-400">-</span>

                          const { currentRating, ratingChange } = playerELO
                          const isPositive = ratingChange > 0
                          const isNegative = ratingChange < 0

                          return (
                            <div className="flex items-center">
                              <span className="text-white font-medium">{currentRating}</span>
                              {ratingChange !== 0 && (
                                <span className={`ml-2 text-sm font-medium flex items-center ${
                                  isPositive ? 'text-emerald-500' :
                                  isNegative ? 'text-red-500' :
                                  'text-slate-400'
                                }`}>
                                  {isPositive && <TrendingUp className="w-3 h-3 mr-1" />}
                                  {isNegative && <TrendingDown className="w-3 h-3 mr-1" />}
                                  {ratingChange > 0 ? '+' : ''}{ratingChange}
                                </span>
                              )}
                            </div>
                          )
                        })()}
                      </td>
                      <td className="py-3 px-4">
                        {(() => {
                          const playerGeneralELO = getPlayerGeneralELO(score.player_id)
                          if (!playerGeneralELO) return <span className="text-slate-400">-</span>

                          const { currentRating, ratingChange } = playerGeneralELO
                          const isPositive = ratingChange > 0
                          const isNegative = ratingChange < 0

                          return (
                            <div className="flex items-center">
                              <span className="text-white font-medium">{currentRating}</span>
                              {ratingChange !== 0 && (
                                <span className={`ml-2 text-sm font-medium flex items-center ${
                                  isPositive ? 'text-emerald-500' :
                                  isNegative ? 'text-red-500' :
                                  'text-slate-400'
                                }`}>
                                  {isPositive && <TrendingUp className="w-3 h-3 mr-1" />}
                                  {isNegative && <TrendingDown className="w-3 h-3 mr-1" />}
                                  {ratingChange > 0 ? '+' : ''}{ratingChange}
                                </span>
                              )}
                            </div>
                          )
                        })()}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-slate-400 text-center py-8">
            Nessun punteggio registrato per questa partita
          </p>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-center mb-4">
              <div className="bg-red-500/20 p-3 rounded-full mr-4">
                <AlertTriangle className="w-6 h-6 text-red-500" />
              </div>
              <h3 className="text-xl font-bold text-white">Conferma Eliminazione</h3>
            </div>

            <p className="text-slate-300 mb-6">
              Sei sicuro di voler eliminare questa partita? Questa azione non può essere annullata.
            </p>

            <div className="flex space-x-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition"
              >
                Annulla
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition"
              >
                Elimina
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default PlayDetail
