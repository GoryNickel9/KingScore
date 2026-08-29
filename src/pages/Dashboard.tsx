import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Trophy, Gamepad2, CalendarDays, Medal } from 'lucide-react'
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts'
import { Spinner } from '../components/Spinner'
import { getWinnerNames } from '../utils/winners'
import { getAvatarColor, getInitials } from '../utils/avatarHelpers'
import { getPlayerImageUrl } from '../utils/imageUpload'
import type { DbGame, DbPlayWithScores, DbPlayer } from '../types/rows'

interface TopGame extends DbGame {
  playCount: number
}

interface PlayRowWithGame {
  game_id: string | null
  played_at: string
  games: DbGame | null
}const computeTopGames = (plays: PlayRowWithGame[]): TopGame[] => {
  const gameCounts = plays.reduce<Record<string, number>>((acc, play) => {
    if (!play.game_id) return acc
    acc[play.game_id] = (acc[play.game_id] || 0) + 1
    return acc
  }, {})

  return Object.entries(gameCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([gameId, playCount]) => {
      const game = plays.find(p => p.game_id === gameId)?.games
      return game ? { ...game, playCount } : null
    })
    .filter((game): game is TopGame => game !== null)
}

interface MonthData {
  month: string
  plays: number
}

interface TopPlayer {
  id: string
  name: string
  avatarUrl: string | null
  playCount: number
  wins: number
  winRate: number
}

interface ScoreRowWithPlayer {
  player_id: string | null
  winner: boolean | null
  players: DbPlayer | null
  plays: { played_at: string } | null
}

const computeTopPlayers = (scores: ScoreRowWithPlayer[]): TopPlayer[] => {
  const perPlayer = scores.reduce<Map<string, { player: DbPlayer | null; total: number; wins: number }>>((acc, score) => {
    if (!score.player_id) return acc
    const entry = acc.get(score.player_id) ?? { player: score.players, total: 0, wins: 0 }
    entry.total++
    if (score.winner) entry.wins++
    acc.set(score.player_id, entry)
    return acc
  }, new Map())

  return Array.from(perPlayer.entries())
    .map(([id, { player, total, wins }]) => ({
      id,
      name: player?.alias || player?.name || 'Sconosciuto',
      avatarUrl: player?.avatar_url ? getPlayerImageUrl(supabase, player.avatar_url) : null,
      playCount: total,
      wins,
      winRate: total > 0 ? Math.round((wins / total) * 100) : 0
    }))
    .sort((a, b) => b.winRate - a.winRate || b.wins - a.wins)
    .slice(0, 3)
}

interface DashboardStats {
  totalPlays: number
  topPlayedGames: TopGame[]
  monthTopGames: TopGame[]
  topPlayers: TopPlayer[]
  recentPlays: DbPlayWithScores[]
  playsByMonth: MonthData[]
}

const Dashboard = () => {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [stats, setStats] = useState<DashboardStats>({
    totalPlays: 0,
    topPlayedGames: [],
    monthTopGames: [],
    topPlayers: [],
    recentPlays: [],
    playsByMonth: []
  })
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    void fetchDashboardData()
  }, [])

  const fetchDashboardData = async (): Promise<void> => {
    try {
      // Fetch total plays (public data)
      const { count: totalPlays } = await supabase
        .from('plays')
        .select('*', { count: 'exact', head: true })

      // Fetch plays with game info (public data)
      const { data: playsData } = await supabase
        .from('plays')
        .select('game_id, played_at, games(*)')

      if (playsData) {
        const topPlayedGames = computeTopGames(playsData)

        // Top 3 del mese corrente
        const now = new Date()
        const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
        const monthTopGames = computeTopGames(
          playsData.filter(play => play.played_at.startsWith(monthKey))
        )

        // Fetch play scores with player info e data partita per la classifica
        // win rate del mese corrente (public data)
        const { data: scoresData } = await supabase
          .from('play_scores')
          .select('player_id, winner, players(*), plays(played_at)')

        const monthScores = (scoresData ?? []).filter(
          score => score.plays?.played_at.startsWith(monthKey)
        )
        const topPlayers = computeTopPlayers(monthScores)

        // Fetch recent plays with game info (public data)
        const { data: recentPlays } = await supabase
          .from('plays')
          .select(`
            *,
            games(*),
            play_scores(
              *,
              players(*)
            )
          `)
          .order('played_at', { ascending: false })
          .limit(5)

        // Fetch plays by month (last 12 months) - public data
        const twelveMonthsAgo = new Date()
        twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)

        const { data: monthlyPlays } = await supabase
          .from('plays')
          .select('played_at')
          .gte('played_at', twelveMonthsAgo.toISOString())
          .order('played_at', { ascending: true })
          .limit(10000) // oltre il cap predefinito di 1000 il risultato verrebbe troncato in silenzio

        const playsByMonth: MonthData[] = []
        if (monthlyPlays) {
          const monthNames = ['Gen', 'Feb', 'Mar', 'apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']

          for (let i = 11; i >= 0; i--) {
            const date = new Date()
            date.setMonth(date.getMonth() - i)
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
            const count = monthlyPlays.filter(p => p.played_at.startsWith(monthKey)).length

            playsByMonth.push({
              month: monthNames[date.getMonth()],
              plays: count
            })
          }
        }

        setStats({
          totalPlays: totalPlays || 0,
          topPlayedGames,
          monthTopGames,
          topPlayers,
          recentPlays: recentPlays ?? [],
          playsByMonth
        })
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <Spinner className="h-64" />
  }

  const userName = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Giocatore'

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div>
        <h1 className="text-3xl font-bold text-white">
          {user ? `Benvenuto, ${userName}!` : 'Benvenuto!'}
        </h1>
        <p className="mt-2 text-slate-400">
          {user ? 'Ecco un riepilogo delle statistiche' : 'Ecco le statistiche pubbliche'}
        </p>
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
              <p className="text-sm text-slate-400">Giochi Preferiti</p>
              <p className="text-lg font-bold text-white mt-1 truncate">
                {stats.topPlayedGames.length > 0 ? stats.topPlayedGames[0]?.name || 'N/A' : 'N/A'}
              </p>
            </div>
            <div className="bg-purple-500/20 p-3 rounded-lg">
              <Trophy className="w-6 h-6 text-purple-500" />
            </div>
          </div>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Plays by Month Chart */}
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <h2 className="text-xl font-bold text-white mb-4">Partite per Mese</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stats.playsByMonth}>
                <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                <XAxis dataKey="month" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }}
                  itemStyle={{ color: '#e2e8f0' }}
                />
                <Line type="monotone" dataKey="plays" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Most Played Games - Top 3 */}
        {stats.topPlayedGames.length > 0 && (
          <div className="bg-slate-800 rounded-xl p-6 shadow-md">
            <h2 className="text-xl font-bold text-white mb-4">Giochi Preferiti (Top 3)</h2>
            <div className="space-y-4">
              {stats.topPlayedGames.map((game, index) => (
                <div key={game.id} className="flex items-center space-x-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-purple-500/20 rounded-full flex items-center justify-center">
                    <span className="text-purple-500 font-bold">{index + 1}</span>
                  </div>
                  {game.image_url ? (
                    <img
                      src={game.image_url}
                      alt={game.name}
                      className="w-16 h-16 object-cover rounded-lg"
                    />
                  ) : (
                    <div className="w-16 h-16 bg-slate-700 rounded-lg flex items-center justify-center">
                      <Gamepad2 className="w-8 h-8 text-slate-500" />
                    </div>
                  )}
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-white">{game.name}</h3>
                    {game.min_players && game.max_players && (
                      <p className="text-slate-400 text-sm">
                        {game.min_players}-{game.max_players} giocatori
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-emerald-500">{game.playCount}</p>
                    <p className="text-xs text-slate-400">partite</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Most Played Games This Month - Top 3 */}
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <h2 className="text-xl font-bold text-white mb-4">Giochi del mese</h2>
          {stats.monthTopGames.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <CalendarDays className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Nessuna partita giocata questo mese</p>
            </div>
          ) : (
            <div className="space-y-4">
              {stats.monthTopGames.map((game, index) => (
                <div key={game.id} className="flex items-center space-x-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-amber-500/20 rounded-full flex items-center justify-center">
                    <span className="text-amber-500 font-bold">{index + 1}</span>
                  </div>
                  {game.image_url ? (
                    <img
                      src={game.image_url}
                      alt={game.name}
                      className="w-16 h-16 object-cover rounded-lg"
                    />
                  ) : (
                    <div className="w-16 h-16 bg-slate-700 rounded-lg flex items-center justify-center">
                      <Gamepad2 className="w-8 h-8 text-slate-500" />
                    </div>
                  )}
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-white">{game.name}</h3>
                    {game.min_players && game.max_players && (
                      <p className="text-slate-400 text-sm">
                        {game.min_players}-{game.max_players} giocatori
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-amber-500">{game.playCount}</p>
                    <p className="text-xs text-slate-400">partite</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Players by Win Rate - current month */}
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <h2 className="text-xl font-bold text-white mb-4">Vittorie del mese</h2>
          {stats.topPlayers.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <Medal className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Nessuna partita giocata questo mese</p>
            </div>
          ) : (
            <div className="space-y-4">
              {stats.topPlayers.map((player, index) => (
                <div key={player.id} className="flex items-center space-x-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-sky-500/20 rounded-full flex items-center justify-center">
                    <span className="text-sky-500 font-bold">{index + 1}</span>
                  </div>
                  {player.avatarUrl ? (
                    <img
                      src={player.avatarUrl}
                      alt={player.name}
                      className="w-16 h-16 object-cover rounded-lg"
                    />
                  ) : (
                    <div className={`w-16 h-16 rounded-lg flex items-center justify-center text-white font-bold ${getAvatarColor(player.name)}`}>
                      {getInitials(player.name)}
                    </div>
                  )}
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-white">{player.name}</h3>
                    <p className="text-slate-400 text-sm">
                      {player.playCount} {player.playCount === 1 ? 'partita' : 'partite'} • {player.wins} {player.wins === 1 ? 'vittoria' : 'vittorie'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-sky-500">{player.winRate}%</p>
                    <p className="text-xs text-slate-400">win rate</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Plays */}
      <div className="bg-slate-800 rounded-xl p-6 shadow-md">
        <h2 className="text-xl font-bold text-white mb-4">Ultime Partite</h2>
        {stats.recentPlays.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            <Gamepad2 className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <p>Nessuna partita registrata</p>
            <p className="text-sm mt-2">Inizia aggiungendo la tua prima partita!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {stats.recentPlays.map((play) => {
              const winnerNames = getWinnerNames(play.play_scores)
              return (
              <div
                key={play.id}
                className="flex items-center justify-between p-4 bg-slate-700 rounded-lg hover:bg-slate-600 transition cursor-pointer"
                onClick={() => navigate(`/plays/${play.id}`)}
              >
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
                    <h3 className="font-semibold text-white">{play.games?.name || 'Sconosciuto'}</h3>
                    <p className="text-sm text-slate-400">
                      {new Date(play.played_at).toLocaleDateString('it-IT')}
                      {play.location && ` • ${play.location}`}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  {winnerNames.length > 0 && (
                    <p className="text-sm text-emerald-500">
                      {winnerNames.join(', ')}
                    </p>
                  )}
                </div>
              </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default Dashboard
