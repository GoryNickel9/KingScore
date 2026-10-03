import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { ArrowLeft, Users, TrendingUp, Calendar, Gamepad2, Trophy } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Spinner } from '../components/Spinner'
import { PlayCommentBadge } from '../components/PlayCommentBadge'
import { usePlayCommentCounts } from '../hooks/usePlayCommentCounts'
import { getWinnerNames } from '../utils/winners'
import type { DbGame, DbPlayWithScoresOnly } from '../types/rows'

interface ScoreHistoryPoint {
  play: number
  score: number
  date: string
}

interface GameStats {
  totalPlays: number
  winRate: number
  avgScore: number | string
  scoreHistory: ScoreHistoryPoint[]
}

const GameDetail = () => {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()

  const [game, setGame] = useState<DbGame | null>(null)
  const [plays, setPlays] = useState<DbPlayWithScoresOnly[]>([])
  const [stats, setStats] = useState<GameStats>({
    totalPlays: 0,
    winRate: 0,
    avgScore: 0,
    scoreHistory: []
  })
  const [loading, setLoading] = useState<boolean>(true)
  const commentCounts = usePlayCommentCounts(plays.map((play) => play.id))

  useEffect(() => {
    void fetchGameData()
  }, [id])

  const fetchGameData = async (): Promise<void> => {
    try {
      // Fetch game details
      const { data: gameData } = await supabase
        .from('games')
        .select('*')
        .eq('id', id!)
        .single()

      if (gameData) {
        setGame(gameData)
      }

      // Fetch plays for this game
      const { data: playsData } = await supabase
        .from('plays')
        .select(`
          *,
          play_scores(
            *,
            players(*)
          )
        `)
        .eq('user_id', user!.id)
        .eq('game_id', id!)
        .order('played_at', { ascending: true })

      if (playsData) {
        setPlays(playsData)

        // Calculate stats
        const { data: myPlayer } = await supabase
          .from('players')
          .select('id')
          .eq('user_id', user!.id)
          .eq('is_me', true)
          .maybeSingle()

        const totalPlays = playsData.length
        let wins = 0
        let totalScore = 0
        let scoreCount = 0
        const scoreHistory: ScoreHistoryPoint[] = []

        ;(playsData ?? []).forEach((play, index) => {
          // Check if I won
          if (myPlayer) {
            const myScore = play.play_scores?.find(s => s.player_id === myPlayer.id)
            if (myScore?.winner) wins++
            if (myScore?.score !== null && myScore?.score !== undefined) {
              totalScore += myScore.score
              scoreCount++
              scoreHistory.push({
                play: index + 1,
                score: myScore.score,
                date: new Date(play.played_at).toLocaleDateString('it-IT', {
                  day: '2-digit',
                  month: '2-digit'
                })
              })
            }
          }
        })

        setStats({
          totalPlays,
          winRate: totalPlays > 0 ? Math.round((wins / totalPlays) * 100) : 0,
          avgScore: scoreCount > 0 ? (totalScore / scoreCount).toFixed(1) : 0,
          scoreHistory
        })
      }
    } catch (error) {
      console.error('Error fetching game data:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <Spinner className="h-64" />
  }

  if (!game) {
    return (
      <div className="text-center py-12">
        <Gamepad2 className="w-16 h-16 mx-auto mb-4 text-slate-600" />
        <h2 className="text-xl font-semibold text-white mb-2">Gioco non trovato</h2>
        <Link to="/games" className="text-emerald-500 hover:text-emerald-400">
          Torna alla libreria
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-4">
        <Link
          to="/games"
          className="p-2 hover:bg-slate-800 rounded-lg transition"
        >
          <ArrowLeft className="w-5 h-5 text-slate-400" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-white">{game.name}</h1>
          <p className="text-slate-400 mt-1">Dettagli e statistiche</p>
        </div>
      </div>

      {/* Game Info Card */}
      <div className="bg-slate-800 rounded-xl p-6 shadow-md">
        <div className="flex items-start space-x-6">
          {game.image_url ? (
            <img
              src={game.image_url}
              alt={game.name}
              className="w-40 h-40 object-cover rounded-lg flex-shrink-0"
            />
          ) : (
            <div className="w-40 h-40 bg-slate-700 rounded-lg flex items-center justify-center flex-shrink-0">
              <Gamepad2 className="w-20 h-20 text-slate-500" />
            </div>
          )}

          <div className="flex-1">
            <h2 className="text-2xl font-bold text-white mb-4">{game.name}</h2>

            {game.min_players && game.max_players && (
              <div className="flex items-center text-slate-300 mb-2">
                <Users className="w-5 h-5 mr-2 text-emerald-500" />
                <span>{game.min_players}-{game.max_players} giocatori</span>
              </div>
            )}

            <div className="flex items-center text-slate-300">
              <TrendingUp className="w-5 h-5 mr-2 text-emerald-500" />
              <span>{stats.totalPlays} partite giocate</span>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Partite Totali</p>
              <p className="text-3xl font-bold text-white mt-1">{stats.totalPlays}</p>
            </div>
            <div className="bg-emerald-500/20 p-3 rounded-lg">
              <Gamepad2 className="w-6 h-6 text-emerald-500" />
            </div>
          </div>
        </div>

        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Win Rate</p>
              <p className="text-3xl font-bold text-white mt-1">{stats.winRate}%</p>
            </div>
            <div className="bg-purple-500/20 p-3 rounded-lg">
              <Trophy className="w-6 h-6 text-purple-500" />
            </div>
          </div>
        </div>

        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Punteggio Medio</p>
              <p className="text-3xl font-bold text-white mt-1">{stats.avgScore}</p>
            </div>
            <div className="bg-blue-500/20 p-3 rounded-lg">
              <TrendingUp className="w-6 h-6 text-blue-500" />
            </div>
          </div>
        </div>
      </div>

      {/* Score History Chart */}
      {stats.scoreHistory.length > 0 && (
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <h2 className="text-xl font-bold text-white mb-4">Andamento Punteggi</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stats.scoreHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                <XAxis 
                  dataKey="date" 
                  stroke="#94a3b8"
                  tick={{ fontSize: 12 }}
                />
                <YAxis stroke="#94a3b8" />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }}
                  itemStyle={{ color: '#e2e8f0' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="score" 
                  stroke="#10b981" 
                  strokeWidth={2}
                  dot={{ fill: '#10b981' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Recent Plays */}
      <div className="bg-slate-800 rounded-xl p-6 shadow-md">
        <h2 className="text-xl font-bold text-white mb-4">Partite Giocate</h2>

        {plays.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            <Gamepad2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>Nessuna partita registrata</p>
          </div>
        ) : (
          <div className="space-y-3">
            {plays.slice().reverse().map((play) => {
              const winnerNames = getWinnerNames(play.play_scores)
              return (
              <Link
                key={play.id}
                to={`/plays/${play.id}`}
                className="block p-4 bg-slate-700 rounded-lg hover:bg-slate-600 transition cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <Calendar className="w-5 h-5 text-emerald-500" />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-white font-medium">
                          {new Date(play.played_at).toLocaleDateString('it-IT', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })}
                        </p>
                        <PlayCommentBadge count={commentCounts[play.id] ?? 0} />
                      </div>
                    </div>
                  </div>

                  {play.play_scores && play.play_scores.length > 0 && (
                    <div className="text-right">
                      <p className="text-sm text-slate-400">
                        {play.play_scores.length} giocatori
                      </p>
                      {winnerNames.length > 0 && (
                        <p className="text-sm text-emerald-500">
                          {winnerNames.join(', ')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default GameDetail
