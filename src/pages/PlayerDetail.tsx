import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { ArrowLeft, Trophy, TrendingUp, Users, Calendar, Gamepad2 } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { getAvatarColor, getInitials } from '../utils/avatarHelpers'
import Spinner from '../components/Spinner'

interface DbGame {
  id: string
  name: string
  image_url?: string | null
}

interface DbPlayScoreNested {
  id: string
  player_id: string
  score?: number | null
  winner: boolean
}

interface DbPlayNested {
  id: string
  played_at: string
  games?: DbGame
  play_scores?: DbPlayScoreNested[]
}

interface DbPlayScore {
  id: string
  player_id: string
  score?: number | null
  winner: boolean
  plays?: DbPlayNested
}

interface DbPlayer {
  id: string
  name: string
  alias?: string | null
  avatar_url?: string | null
  color?: string | null
  is_me?: boolean
}

interface WinHistoryPoint {
  play: number
  won: number
  date: string
}

interface MostPlayedGame extends DbGame {
  count: number
}

interface PlayerStats {
  totalPlays: number
  winRate: number
  winRateVsMe: number
  mostPlayedGames: MostPlayedGame[]
  recentPlays: DbPlayScore[]
  winHistory: WinHistoryPoint[]
}

const PlayerDetail = () => {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()

  const [player, setPlayer] = useState<DbPlayer | null>(null)
  const [stats, setStats] = useState<PlayerStats>({
    totalPlays: 0,
    winRate: 0,
    winRateVsMe: 0,
    mostPlayedGames: [],
    recentPlays: [],
    winHistory: []
  })
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    fetchPlayerData()
  }, [id])

  const fetchPlayerData = async (): Promise<void> => {
    try {
      // Fetch player details
      const { data: playerData } = await supabase
        .from('players')
        .select('*')
        .eq('id', id)
        .single()

      if (playerData) {
        setPlayer(playerData as DbPlayer)
      }

      // Fetch my player ID
      const { data: myPlayer } = await supabase
        .from('players')
        .select('id')
        .eq('user_id', user!.id)
        .eq('is_me', true)
        .maybeSingle()

      // Fetch plays with this player
      const { data: playScores } = await supabase
        .from('play_scores')
        .select(`
          *,
          plays(
            *,
            games(*),
            play_scores(*)
          )
        `)
        .eq('player_id', id)

      if (playScores) {
        const scores = playScores as DbPlayScore[]
        const totalPlays = scores.length
        const wins = scores.filter(s => s.winner).length

        // Calculate win rate vs me
        let winsVsMe = 0
        let totalVsMe = 0
        const winHistory: WinHistoryPoint[] = []

        scores.forEach((score, index) => {
          const play = score.plays
          if (play) {
            // Check if I was in this play
            if (myPlayer && play.play_scores) {
              const myScore = play.play_scores.find(s => s.player_id === myPlayer.id)
              if (myScore) {
                totalVsMe++
                if (score.winner) winsVsMe++
              }
            }

            // Add to win history
            winHistory.push({
              play: index + 1,
              won: score.winner ? 1 : 0,
              date: new Date(play.played_at).toLocaleDateString('it-IT', {
                day: '2-digit',
                month: '2-digit'
              })
            })
          }
        })

        // Most played games
        const gameCounts: Record<string, number> = {}
        scores.forEach(score => {
          const game = score.plays?.games
          if (game) {
            gameCounts[game.id] = (gameCounts[game.id] || 0) + 1
          }
        })

        const mostPlayedGames: MostPlayedGame[] = Object.entries(gameCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([gameId, count]) => {
            const game = scores.find(s => s.plays?.games?.id === gameId)?.plays?.games
            return { ...game, count } as MostPlayedGame
          })

        // Recent plays
        const recentPlays = scores
          .sort((a, b) => new Date(b.plays?.played_at ?? '').getTime() - new Date(a.plays?.played_at ?? '').getTime())
          .slice(0, 10)

        setStats({
          totalPlays,
          winRate: totalPlays > 0 ? Math.round((wins / totalPlays) * 100) : 0,
          winRateVsMe: totalVsMe > 0 ? Math.round((winsVsMe / totalVsMe) * 100) : 0,
          mostPlayedGames,
          recentPlays,
          winHistory
        })
      }
    } catch (error) {
      console.error('Error fetching player data:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <Spinner />
  }

  if (!player) {
    return (
      <div className="text-center py-12">
        <Users className="w-16 h-16 mx-auto mb-4 text-slate-600" />
        <h2 className="text-xl font-semibold text-white mb-2">Giocatore non trovato</h2>
        <Link to="/players" className="text-emerald-500 hover:text-emerald-400">
          Torna ai giocatori
        </Link>
      </div>
    )
  }

  const avatarClass = player.color
    ? 'w-16 h-16 rounded-full flex items-center justify-center'
    : `w-16 h-16 rounded-full flex items-center justify-center ${getAvatarColor(player.alias || player.name)}`
  const avatarStyle = player.color ? { backgroundColor: player.color } : undefined

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-4">
        <Link
          to="/players"
          className="p-2 hover:bg-slate-800 rounded-lg transition"
        >
          <ArrowLeft className="w-5 h-5 text-slate-400" />
        </Link>
        <div className="flex items-center space-x-4">
          <div
            className={avatarClass}
            style={avatarStyle}
          >
            <span className="text-white text-xl font-bold">{getInitials(player.alias || player.name)}</span>
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">{player.alias || player.name}</h1>
            {player.alias && (
              <p className="text-slate-400 mt-1">{player.name}</p>
            )}
            <p className="text-slate-400 mt-1">Statistiche e dettagli</p>
            {player.is_me && (
              <span className="inline-flex items-center px-2 py-0.5 bg-emerald-500/20 text-emerald-500 text-xs rounded-full mt-1">
                Sei tu
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

        {!player.is_me && (
          <div className="bg-slate-800 rounded-xl p-6 shadow-md">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Win Rate Contro di Me</p>
                <p className="text-3xl font-bold text-white mt-1">{stats.winRateVsMe}%</p>
              </div>
              <div className="bg-blue-500/20 p-3 rounded-lg">
                <TrendingUp className="w-6 h-6 text-blue-500" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Win History Chart */}
      {stats.winHistory.length > 0 && (
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <h2 className="text-xl font-bold text-white mb-4">Chi Vince di Più nel Tempo</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stats.winHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                <XAxis 
                  dataKey="date" 
                  stroke="#94a3b8"
                  tick={{ fontSize: 12 }}
                />
                <YAxis stroke="#94a3b8" domain={[0, 1]} tickFormatter={(value: number) => value === 1 ? 'Vinto' : 'Perso'} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }}
                  itemStyle={{ color: '#e2e8f0' }}
                  formatter={(value: number | undefined) => value === 1 ? 'Vinto' : 'Perso'}
                />
                <Line 
                  type="stepAfter" 
                  dataKey="won" 
                  stroke="#10b981" 
                  strokeWidth={2}
                  dot={{ fill: '#10b981' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Most Played Games */}
      {stats.mostPlayedGames.length > 0 && (
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <h2 className="text-xl font-bold text-white mb-4">Giochi Più Giocati Insieme</h2>
          <div className="space-y-3">
            {stats.mostPlayedGames.map((game) => (
              <Link
                key={game.id}
                to={`/games/${game.id}`}
                className="flex items-center justify-between p-4 bg-slate-700 rounded-lg hover:bg-slate-600 transition"
              >
                <div className="flex items-center space-x-4">
                  {game.image_url ? (
                    <img
                      src={game.image_url}
                      alt={game.name}
                      className="w-12 h-12 object-cover rounded-lg"
                    />
                  ) : (
                    <div className="w-12 h-12 bg-slate-600 rounded-lg flex items-center justify-center">
                      <Gamepad2 className="w-6 h-6 text-slate-400" />
                    </div>
                  )}
                  <span className="text-white font-medium">{game.name}</span>
                </div>
                <div className="flex items-center text-emerald-500">
                  <Gamepad2 className="w-4 h-4 mr-1" />
                  <span className="font-medium">{game.count}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recent Plays */}
      {stats.recentPlays.length > 0 && (
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <h2 className="text-xl font-bold text-white mb-4">Storico Partite Insieme</h2>
          <div className="space-y-3">
            {stats.recentPlays.map((score) => {
              const play = score.plays
              if (!play) return null

              return (
                <Link
                  key={score.id}
                  to={`/plays/${play.id}`}
                  className="block p-4 bg-slate-700 rounded-lg hover:bg-slate-600 transition"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      {play.games?.image_url ? (
                        <img
                          src={play.games.image_url}
                          alt={play.games.name}
                          className="w-12 h-12 object-cover rounded-lg"
                        />
                      ) : (
                        <div className="w-12 h-12 bg-slate-600 rounded-lg flex items-center justify-center">
                          <Gamepad2 className="w-6 h-6 text-slate-400" />
                        </div>
                      )}
                      <div>
                        <p className="text-white font-medium">{play.games?.name || 'Gioco sconosciuto'}</p>
                        <p className="text-sm text-slate-400">
                          <Calendar className="w-3 h-3 inline mr-1" />
                          {new Date(play.played_at).toLocaleDateString('it-IT')}
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      {score.winner && (
                        <div className="flex items-center text-emerald-500">
                          <Trophy className="w-4 h-4 mr-1" />
                          <span className="text-sm font-medium">Vinto</span>
                        </div>
                      )}
                      {score.score !== null && (
                        <p className="text-sm text-slate-400">Punteggio: {score.score}</p>
                      )}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default PlayerDetail
