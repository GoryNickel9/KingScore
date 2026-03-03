import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { TrendingUp, Trophy, Calendar, Users, Gamepad2, Flame, Award } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line
} from 'recharts'
import { ActivityCalendar } from 'react-activity-calendar'

const Stats = () => {
  const { user } = useAuth()
  
  const [stats, setStats] = useState({
    hIndex: 0,
    streak: 0,
    winRateByGame: [],
    playsByDayOfWeek: [],
    mostFrequentPlayers: [],
    playActivity: [],
    topGamesByHours: [],
    gameOfTheMonth: null,
    gameOfTheMonthTrend: 0
  })
  
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      setLoading(true)

      // Fetch all plays with games and scores
      const { data: playsData } = await supabase
        .from('plays')
        .select(`
          *,
          games(*),
          play_scores(
            *,
            players(*)
          )
        `)
        .eq('user_id', user.id)
        .order('played_at', { ascending: false })

      if (!playsData) return

      // Calculate H-Index
      const gameCounts = {}
      playsData.forEach(play => {
        const gameId = play.game_id
        gameCounts[gameId] = (gameCounts[gameId] || 0) + 1
      })

      const sortedCounts = Object.values(gameCounts).sort((a, b) => b - a)
      let hIndex = 0
      for (let i = 0; i < sortedCounts.length; i++) {
        if (sortedCounts[i] >= i + 1) {
          hIndex = i + 1
        }
      }

      // Calculate Streak
      const sortedPlays = [...playsData].sort((a, b) => 
        new Date(b.played_at) - new Date(a.played_at)
      )

      let streak = 0
      let currentStreak = 0
      let previousDate = null

      sortedPlays.forEach(play => {
        const playDate = new Date(play.played_at)
        const playDateString = playDate.toDateString()

        if (previousDate !== playDateString) {
          currentStreak = 1
        } else {
          const dayDiff = (playDate - previousDate) / (1000 * 60 * 60 * 24)
          if (dayDiff === 1) {
            currentStreak++
          } else {
            currentStreak = 1
          }
        }

        if (currentStreak > streak) {
          streak = currentStreak
        }

        previousDate = playDateString
      })

      // Calculate Win Rate by Game (Top 10)
      const gameWinRates = {}
      const myPlayer = await getMyPlayer()

      playsData.forEach(play => {
        const gameId = play.game_id
        const myScore = play.play_scores?.find(s => s.player_id === myPlayer?.id)
        
        if (!gameWinRates[gameId]) {
          gameWinRates[gameId] = { total: 0, wins: 0 }
        }

        gameWinRates[gameId].total++
        if (myScore?.winner) {
          gameWinRates[gameId].wins++
        }
      })

      const winRateByGame = Object.entries(gameWinRates)
        .map(([gameId, data]) => {
          const game = playsData.find(p => p.game_id === gameId)?.games
          return {
            gameId,
            gameName: game?.name || 'Unknown',
            winRate: data.total > 0 ? Math.round((data.wins / data.total) * 100) : 0,
            totalPlays: data.total
          }
        })
        .sort((a, b) => b.totalPlays - a.totalPlays)
        .slice(0, 10)

      // Calculate Plays by Day of Week
      const dayOfWeek = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']
      const playsByDay = [0, 0, 0, 0, 0, 0, 0]
      
      playsData.forEach(play => {
        const dayIndex = new Date(play.played_at).getDay()
        playsByDay[dayIndex]++
      })

      const playsByDayOfWeek = dayOfWeek.map((day, index) => ({
        day,
        plays: playsByDay[index]
      }))

      // Calculate Most Frequent Players
      const playerCounts = {}
      playsData.forEach(play => {
        play.play_scores?.forEach(score => {
          const playerId = score.player_id
          playerCounts[playerId] = (playerCounts[playerId] || 0) + 1
        })
      })

      const mostFrequentPlayers = Object.entries(playerCounts)
        .map(([playerId, count]) => {
          const player = playsData
            .flatMap(p => p.play_scores || [])
            .find(s => s.player_id === playerId)?.players
          return {
            playerId,
            playerName: player?.alias || player?.name || 'Unknown',
            playerOriginalName: player?.name || null,
            playCount: count
          }
        })
        .sort((a, b) => b.playCount - a.playCount)
        .slice(0, 5)

      // Calculate Play Activity for Heatmap
      const activityByDate = {}
      playsData.forEach(play => {
        const date = new Date(play.played_at)
        const dateKey = date.toISOString().split('T')[0]
        activityByDate[dateKey] = (activityByDate[dateKey] || 0) + 1
      })

      const playActivity = Object.entries(activityByDate)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => new Date(a.date) - new Date(b.date))

      // Calculate Top 5 Games by Hours
      const gamesByHours = {}
      playsData.forEach(play => {
        const gameId = play.game_id
        const hours = play.duration_minutes ? play.duration_minutes / 60 : 0
        
        if (!gamesByHours[gameId]) {
          gamesByHours[gameId] = { totalHours: 0, playCount: 0 }
        }

        gamesByHours[gameId].totalHours += hours
        gamesByHours[gameId].playCount++
      })

      const topGamesByHours = Object.entries(gamesByHours)
        .map(([gameId, data]) => {
          const game = playsData.find(p => p.game_id === gameId)?.games
          return {
            gameId,
            gameName: game?.name || 'Unknown',
            totalHours: data.totalHours.toFixed(1),
            playCount: data.playCount
          }
        })
        .sort((a, b) => b.totalHours - a.totalHours)
        .slice(0, 5)

      // Calculate Game of the Month
      const now = new Date()
      const currentMonth = now.getMonth()
      const currentYear = now.getFullYear()
      const firstDayOfMonth = new Date(currentYear, currentMonth, 1)
      const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0)

      const monthPlays = playsData.filter(play => {
        const playDate = new Date(play.played_at)
        return playDate >= firstDayOfMonth && playDate <= lastDayOfMonth
      })

      const gameCountsThisMonth = {}
      monthPlays.forEach(play => {
        const gameId = play.game_id
        gameCountsThisMonth[gameId] = (gameCountsThisMonth[gameId] || 0) + 1
      })

      const gameOfTheMonth = Object.entries(gameCountsThisMonth)
        .sort((a, b) => b[1] - a[1])
        [0]?.[0]

      const gameOfTheMonthData = gameOfTheMonth 
        ? playsData.find(p => p.game_id === gameOfTheMonth[0])?.games
        : null

      // Calculate Game of the Month Trend
      const previousMonth = new Date(currentYear, currentMonth - 1, 1)
      const lastDayOfPreviousMonth = new Date(currentYear, currentMonth, 0)

      const previousMonthPlays = playsData.filter(play => {
        const playDate = new Date(play.played_at)
        return playDate >= previousMonth && playDate <= lastDayOfPreviousMonth
      })

      const gameCountsPreviousMonth = {}
      previousMonthPlays.forEach(play => {
        const gameId = play.game_id
        gameCountsPreviousMonth[gameId] = (gameCountsPreviousMonth[gameId] || 0) + 1
      })

      const gameOfPreviousMonth = Object.entries(gameCountsPreviousMonth)
        .sort((a, b) => b[1] - a[1])
        [0]?.[0]

      const gameOfPreviousMonthData = gameOfPreviousMonth
        ? playsData.find(p => p.game_id === gameOfPreviousMonth[0])?.games
        : null

      let trend = 0
      if (gameOfTheMonth && gameOfPreviousMonth) {
        const currentCount = gameCountsThisMonth[gameOfTheMonth[0]] || 0
        const previousCount = gameCountsPreviousMonth[gameOfPreviousMonth[0]] || 0
        
        if (previousCount > 0) {
          trend = Math.round(((currentCount - previousCount) / previousCount) * 100)
        }
      }

      setStats({
        hIndex,
        streak,
        winRateByGame,
        playsByDayOfWeek,
        mostFrequentPlayers,
        playActivity,
        topGamesByHours,
        gameOfTheMonth: gameOfTheMonthData,
        gameOfTheMonthTrend: trend
      })
    } catch (error) {
      console.error('Error fetching stats:', error)
    } finally {
      setLoading(false)
    }
  }

  const getMyPlayer = async () => {
    const { data, error } = await supabase
      .from('players')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_me', true)
      .maybeSingle()

    if (error) {
      console.error('Error fetching my player:', error)
      return null
    }

    return data
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <svg className="animate-spin h-12 w-12 text-emerald-500 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="mt-4 text-slate-400">Caricamento statistiche...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Statistiche Avanzate</h1>
        <p className="mt-2 text-slate-400">Analisi dettagliata delle tue partite</p>
      </div>

      {/* H-Index */}
      <div className="bg-slate-800 rounded-xl p-6 shadow-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white flex items-center">
            <Award className="w-6 h-6 mr-2 text-emerald-500" />
            H-Index
          </h2>
          <div className="text-right">
            <span className="text-4xl font-bold text-emerald-500">{stats.hIndex}</span>
          </div>
        </div>
        <p className="text-sm text-slate-400">
          Hai giocato almeno {stats.hIndex} partite a {stats.hIndex} giochi diversi
        </p>
      </div>

      {/* Streak */}
      <div className="bg-slate-800 rounded-xl p-6 shadow-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white flex items-center">
            <Flame className="w-6 h-6 mr-2 text-orange-500" />
            Streak Attuale
          </h2>
          <div className="text-right">
            <span className="text-4xl font-bold text-orange-500">{stats.streak}</span>
            <span className="text-xl text-slate-400 ml-1">giorni</span>
          </div>
        </div>
        <p className="text-sm text-slate-400">
          {stats.streak > 0 
            ? 'Hai giocato per ' + stats.streak + ' giorni consecutivi!'
            : 'Nessuna streak attiva'}
        </p>
      </div>

      {/* Win Rate by Game */}
      <div className="bg-slate-800 rounded-xl p-6 shadow-md">
        <h2 className="text-xl font-bold text-white mb-4 flex items-center">
          <Trophy className="w-6 h-6 mr-2 text-purple-500" />
          Win Rate per Gioco (Top 10)
        </h2>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={undefined}>
            <BarChart data={stats.winRateByGame} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
              <XAxis 
                dataKey="gameName" 
                stroke="#94a3b8" 
                tick={{ fontSize: 12 }}
                width={100}
              />
              <YAxis stroke="#94a3b8" />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }}
                itemStyle={{ color: '#e2e8f0' }}
                formatter={(value, name) => [name, `${value}%`]}
              />
              <Bar dataKey="winRate" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Plays by Day of Week */}
      <div className="bg-slate-800 rounded-xl p-6 shadow-md">
        <h2 className="text-xl font-bold text-white mb-4 flex items-center">
          <Calendar className="w-6 h-6 mr-2 text-blue-500" />
          Partite per Giorno della Settimana
        </h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={undefined}>
            <BarChart data={stats.playsByDayOfWeek}>
              <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
              <XAxis dataKey="day" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }}
                itemStyle={{ color: '#e2e8f0' }}
              />
              <Bar dataKey="plays" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Most Frequent Players */}
      <div className="bg-slate-800 rounded-xl p-6 shadow-md">
        <h2 className="text-xl font-bold text-white mb-4 flex items-center">
          <Users className="w-6 h-6 mr-2 text-emerald-500" />
          Giocatori più Frequenti
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {stats.mostFrequentPlayers.map((player, index) => (
            <div key={player.playerId} className="bg-slate-700 rounded-lg p-4">
              <div className="flex items-center space-x-3 mb-3">
                <div className="w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center">
                  <span className="text-emerald-500 font-bold text-lg">
                    {player.playerName?.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <p className="text-white font-medium">{player.playerName}</p>
                  {player.playerOriginalName && player.playerName !== player.playerOriginalName && (
                    <p className="text-xs text-slate-400">{player.playerOriginalName}</p>
                  )}
                  <p className="text-sm text-slate-400">{player.playCount} partite</p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-600">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Partite totali</span>
                  <span className="text-white font-medium">{player.playCount}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Activity Heatmap */}
      <div className="bg-slate-800 rounded-xl p-6 shadow-md">
        <h2 className="text-xl font-bold text-white mb-4 flex items-center">
          <Gamepad2 className="w-6 h-6 mr-2 text-emerald-500" />
          Attività Giornaliera
        </h2>
        <div className="overflow-x-auto">
          <ActivityCalendar
            data={stats.playActivity}
            theme="dark"
            colorScheme="emerald"
            blockSize={14}
            fontSize={12}
            hideColorLegend
            hideMonthLabels
            labels={{
              months: ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'],
              weekdays: ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'],
              totalCount: `${stats.playActivity.length} partite nell'ultimo anno`,
            }}
          />
        </div>
      </div>

      {/* Top 5 Games by Hours */}
      <div className="bg-slate-800 rounded-xl p-6 shadow-md">
        <h2 className="text-xl font-bold text-white mb-4 flex items-center">
          <TrendingUp className="w-6 h-6 mr-2 text-blue-500" />
          Top 5 Giochi per Ore Totali
        </h2>
        <div className="space-y-3">
          {stats.topGamesByHours.map((game, index) => (
            <div key={game.gameId} className="flex items-center justify-between p-4 bg-slate-700 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-slate-600 rounded flex items-center justify-center">
                  <Gamepad2 className="w-5 h-5 text-slate-400" />
                </div>
                <div className="flex-1">
                  <p className="text-white font-medium">{game.gameName}</p>
                  <p className="text-sm text-slate-400">{game.playCount} partite</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-blue-500">{game.totalHours}h</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Game of the Month */}
      {stats.gameOfTheMonth && (
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center">
            <Trophy className="w-6 h-6 mr-2 text-emerald-500" />
            Gioco del Mese
          </h2>
          <div className="flex items-start space-x-4">
            {stats.gameOfTheMonth.image_url ? (
              <img 
                src={stats.gameOfTheMonth.image_url} 
                alt={stats.gameOfTheMonth.name} 
                className="w-20 h-20 object-cover rounded-lg" 
              />
            ) : (
              <div className="w-20 h-20 bg-slate-700 rounded-lg flex items-center justify-center">
                <Gamepad2 className="w-10 h-10 text-slate-400" />
              </div>
            )}
            <div className="flex-1">
              <p className="text-white font-medium text-lg">{stats.gameOfTheMonth.name}</p>
              <p className="text-sm text-slate-400 mt-1">
                {stats.gameOfTheMonth.min_players && stats.gameOfTheMonth.max_players && (
                  <span>{stats.gameOfTheMonth.min_players}-{stats.gameOfTheMonth.max_players} giocatori</span>
                )}
              </p>
            </div>
            <div className="text-right">
              {stats.gameOfTheMonthTrend > 0 ? (
                <div className="flex items-center text-emerald-500">
                  <TrendingUp className="w-5 h-5 mr-1" />
                  <span className="text-sm font-medium">+{stats.gameOfTheMonthTrend}%</span>
                </div>
              ) : stats.gameOfTheMonthTrend < 0 ? (
                <div className="flex items-center text-red-500">
                  <TrendingUp className="w-5 h-5 mr-1 rotate-180" />
                  <span className="text-sm font-medium">{stats.gameOfTheMonthTrend}%</span>
                </div>
              ) : (
                <span className="text-slate-400">Nessun dato</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Stats
