import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Trophy, Calendar, Gamepad2 } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts'

const Dashboard = () => {
  const { user } = useAuth()
  const [stats, setStats] = useState({
    totalPlays: 0,
    topPlayedGames: [],
    recentPlays: [],
    playsByMonth: []
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchDashboardData()
  }, [])

  const fetchDashboardData = async () => {
    try {
      // Fetch total plays (public data)
      const { count: totalPlays } = await supabase
        .from('plays')
        .select('*', { count: 'exact', head: true })

      // Fetch most played games (top 3) (public data)
      const { data: playsData } = await supabase
        .from('plays')
        .select('game_id, games(*)')

      if (playsData) {
        const gameCounts = playsData.reduce((acc, play) => {
          acc[play.game_id] = (acc[play.game_id] || 0) + 1
          return acc
        }, {})

        const topPlayedIds = Object.entries(gameCounts).sort((a, b) => b[1] - a[1]).slice(0, 3)
        const topPlayedGames = topPlayedIds.map(([gameId, count]) => ({
          ...playsData.find(p => p.game_id === gameId)?.games,
          playCount: count
        }))

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

        const playsByMonth = []
        if (monthlyPlays) {
          const monthNames = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']

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
          recentPlays: recentPlays || [],
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
            {stats.recentPlays.map((play) => (
              <div
                key={play.id}
                className="flex items-center justify-between p-4 bg-slate-700 rounded-lg hover:bg-slate-600 transition cursor-pointer"
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
                  {play.play_scores?.length > 0 && (
                    <p className="text-sm text-slate-400">
                      {play.play_scores.filter(s => s.winner).length > 0 && (
                        <span className="text-emerald-500">
                          {play.play_scores.find(s => s.winner)?.players?.alias || play.play_scores.find(s => s.winner)?.players?.name}
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default Dashboard
