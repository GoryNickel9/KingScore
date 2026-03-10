import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { TrendingUp, Trophy, Users, Gamepad2, Star, ChevronDown, ChevronUp } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend
} from 'recharts'
import { getELOHistoryForGame, getGeneralELOHistory } from '../utils/eloCalculator'
import { getPlayerImageUrl } from '../utils/imageUpload'

interface DbPlayer {
  id: string
  name: string
  alias?: string | null
  avatar_url?: string | null
}

interface DbGame {
  id: string
  name: string
  image_url?: string | null
  min_players?: number | null
  max_players?: number | null
}

interface DbPlayScore {
  id: string
  player_id: string
  score?: number | null
  winner: boolean
  position?: number | null
  players?: DbPlayer
}

interface DbPlay {
  id: string
  game_id: string
  played_at: string
  duration_minutes?: number | null
  games?: DbGame
  play_scores?: DbPlayScore[]
  user_id?: string
}

interface WinRateEntry {
  gameId: string
  gameName: string
  winRate: number
  totalPlays: number
}

interface FrequentPlayer {
  playerId: string
  playerName: string
  playerOriginalName: string | null
  playerAvatarUrl: string | null
  playCount: number
}

interface PlayerStats {
  playerId: string
  playerName: string
  playerAvatarUrl: string | null
  totalScore: number
  playCount: number
  avgScore?: number | string
}

interface GameStats {
  gameId: string
  gameName: string
  gameImage: string | null
  totalPlays: number
  totalDuration: number
  allScores: number[]
  players: Record<string, PlayerStats>
  avgScore?: number | string
  avgDuration?: number
}

interface ComputedGameStats extends Omit<GameStats, 'players'> {
  avgScore: number | string
  avgDuration: number
  players: PlayerStats[]
}

interface StatsState {
  winRateByGame: WinRateEntry[]
  mostFrequentPlayers: FrequentPlayer[]
  gameOfTheMonth: DbGame | null
  gameOfTheMonthTrend: number
  allGamesStats: ComputedGameStats[]
}

interface EloHistoryEntry {
  playId?: string
  playerName: string
  rating: number
  date: string
}

interface ChartPoint {
  date: number
  [player: string]: number | null
}

interface PreparedChartData {
  chartData: ChartPoint[]
  players: string[]
}

const Stats = () => {
  const { user } = useAuth()

  const [stats, setStats] = useState<StatsState>({
    winRateByGame: [],
    mostFrequentPlayers: [],
    gameOfTheMonth: null,
    gameOfTheMonthTrend: 0,
    allGamesStats: []
  })

  const [loading, setLoading] = useState<boolean>(true)
  const [expandedGames, setExpandedGames] = useState<Record<string, boolean>>({})
  const [eloHistory, setEloHistory] = useState<Record<string, EloHistoryEntry[]>>({})
  const [loadingEloHistory, setLoadingEloHistory] = useState<Record<string, boolean>>({})
  const [generalEloHistory, setGeneralEloHistory] = useState<EloHistoryEntry[]>([])
  const [loadingGeneralEloHistory, setLoadingGeneralEloHistory] = useState<boolean>(false)

  useEffect(() => {
    fetchStats()
    fetchGeneralEloHistory()
  }, [])

  const toggleGameExpansion = async (gameId: string): Promise<void> => {
    const isExpanding = !expandedGames[gameId]

    setExpandedGames(prev => ({
      ...prev,
      [gameId]: isExpanding
    }))

    // Se stiamo espandendo e non abbiamo ancora lo storico ELO, recuperalo
    if (isExpanding && !eloHistory[gameId]) {
      try {
        setLoadingEloHistory(prev => ({ ...prev, [gameId]: true }))
        const history = await getELOHistoryForGame(supabase, gameId, user?.id)
        setEloHistory(prev => ({ ...prev, [gameId]: history as EloHistoryEntry[] }))
      } catch (error) {
        console.error('[Stats] Errore nel recupero dello storico ELO:', error)
      } finally {
        setLoadingEloHistory(prev => ({ ...prev, [gameId]: false }))
      }
    }
  }

  const fetchStats = async (): Promise<void> => {
    try {
      setLoading(true)

      // Fetch all plays with games and scores (public data)
      // NOTE: Supabase default limit is 1000 rows — override to avoid silently
      // truncating larger collections and returning incorrect play totals per game.
      const { data: playsData, error: playsError } = await supabase
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
        .limit(10000)

      if (playsError) {
        console.error('[Stats] Error fetching plays:', playsError)
        return
      }

      if (!playsData || playsData.length === 0) {
        console.warn('[Stats] No plays found in database')
        setStats({
          winRateByGame: [],
          mostFrequentPlayers: [],
          gameOfTheMonth: null,
          gameOfTheMonthTrend: 0,
          allGamesStats: []
        })
        return
      }

      const plays = playsData as DbPlay[]

      // Calculate Win Rate by Game (Top 10) - only for logged in users
      const gameWinRates: Record<string, { total: number; wins: number }> = {}
      const myPlayer = user ? await getMyPlayer() : null

      if (myPlayer) {
        plays.forEach(play => {
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
      }

      const winRateByGame: WinRateEntry[] = Object.entries(gameWinRates)
        .map(([gameId, data]) => {
          const game = plays.find(p => p.game_id === gameId)?.games
          return {
            gameId,
            gameName: game?.name || 'Unknown',
            winRate: data.total > 0 ? Math.round((data.wins / data.total) * 100) : 0,
            totalPlays: data.total
          }
        })
        .sort((a, b) => b.totalPlays - a.totalPlays)
        .slice(0, 10)

      // Calculate Most Frequent Players
      const playerCounts: Record<string, number> = {}
      plays.forEach(play => {
        play.play_scores?.forEach(score => {
          const playerId = score.player_id
          playerCounts[playerId] = (playerCounts[playerId] || 0) + 1
        })
      })

      const mostFrequentPlayers: FrequentPlayer[] = Object.entries(playerCounts)
        .map(([playerId, count]) => {
          const player = plays
            .flatMap(p => p.play_scores || [])
            .find(s => s.player_id === playerId)?.players
          return {
            playerId,
            playerName: player?.alias || player?.name || 'Unknown',
            playerOriginalName: player?.name || null,
            playerAvatarUrl: player?.avatar_url || null,
            playCount: count
          }
        })
        .sort((a, b) => b.playCount - a.playCount)
        .slice(0, 5)

      // Calculate Game of the Month
      const now = new Date()
      const currentMonth = now.getMonth()
      const currentYear = now.getFullYear()
      const firstDayOfMonth = new Date(currentYear, currentMonth, 1)
      const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0)

      const monthPlays = plays.filter(play => {
        const playDate = new Date(play.played_at)
        return playDate >= firstDayOfMonth && playDate <= lastDayOfMonth
      })

      const gameCountsThisMonth: Record<string, number> = {}
      monthPlays.forEach(play => {
        const gameId = play.game_id
        gameCountsThisMonth[gameId] = (gameCountsThisMonth[gameId] || 0) + 1
      })

      const gameOfTheMonthId = Object.entries(gameCountsThisMonth)
        .sort((a, b) => b[1] - a[1])[0]?.[0]

      const gameOfTheMonthData = gameOfTheMonthId
        ? plays.find(p => p.game_id === gameOfTheMonthId)?.games || null
        : null

      // Calculate Game of the Month Trend
      const previousMonth = new Date(currentYear, currentMonth - 1, 1)
      const lastDayOfPreviousMonth = new Date(currentYear, currentMonth, 0)

      const previousMonthPlays = plays.filter(play => {
        const playDate = new Date(play.played_at)
        return playDate >= previousMonth && playDate <= lastDayOfPreviousMonth
      })

      const gameCountsPreviousMonth: Record<string, number> = {}
      previousMonthPlays.forEach(play => {
        const gameId = play.game_id
        gameCountsPreviousMonth[gameId] = (gameCountsPreviousMonth[gameId] || 0) + 1
      })

      const gameOfPreviousMonthId = Object.entries(gameCountsPreviousMonth)
        .sort((a, b) => b[1] - a[1])[0]?.[0]

      let trend = 0
      if (gameOfTheMonthId && gameOfPreviousMonthId) {
        const currentCount = gameCountsThisMonth[gameOfTheMonthId] || 0
        const previousCount = gameCountsPreviousMonth[gameOfPreviousMonthId] || 0

        if (previousCount > 0) {
          trend = Math.round(((currentCount - previousCount) / previousCount) * 100)
        }
      }

      // Calculate stats for all games (NEW: per game statistics)
      const allGamesStats: Record<string, GameStats> = {}
      plays.forEach(play => {
        const gameId = play.game_id
        const game = play.games

        if (!allGamesStats[gameId]) {
          allGamesStats[gameId] = {
            gameId,
            gameName: game?.name || 'Unknown',
            gameImage: game?.image_url || null,
            totalPlays: 0,
            totalDuration: 0,
            allScores: [],
            players: {}
          }
        }

        allGamesStats[gameId].totalPlays++

        // Calculate average score per player
        play.play_scores?.forEach(score => {
          const playerId = score.player_id
          const player = score.players

          if (!allGamesStats[gameId].players[playerId]) {
            allGamesStats[gameId].players[playerId] = {
              playerId,
              playerName: player?.alias || player?.name || 'Unknown',
              playerAvatarUrl: player?.avatar_url || null,
              totalScore: 0,
              playCount: 0
            }
          }

          allGamesStats[gameId].players[playerId].totalScore += score.score || 0
          allGamesStats[gameId].players[playerId].playCount++

          // Add individual score to array for correct average calculation
          allGamesStats[gameId].allScores.push(score.score || 0)
        })

        // Calculate average duration
        allGamesStats[gameId].totalDuration += play.duration_minutes || 0
      })

      // Convert to array and calculate averages
      const gamesWithStats: ComputedGameStats[] = Object.values(allGamesStats).map(game => {
        // Calculate average score correctly: average of all individual scores
        const avgScore = game.allScores.length > 0
          ? parseFloat((game.allScores.reduce((sum, score) => sum + score, 0) / game.allScores.length).toFixed(2))
          : '0.00'

        const playersWithAvgScore: PlayerStats[] = Object.values(game.players).map(player => ({
          ...player,
          avgScore: player.playCount > 0 ? parseFloat((player.totalScore / player.playCount).toFixed(2)) : '0.00'
        })).sort((a, b) => (b.avgScore as number) - (a.avgScore as number))

        return {
          ...game,
          avgScore,
          avgDuration: game.totalPlays > 0 ? Math.round(game.totalDuration / game.totalPlays) : 0,
          players: playersWithAvgScore
        }
      }).sort((a, b) => b.totalPlays - a.totalPlays)

      setStats({
        winRateByGame,
        mostFrequentPlayers,
        gameOfTheMonth: gameOfTheMonthData,
        gameOfTheMonthTrend: trend,
        allGamesStats: gamesWithStats
      })
    } catch (error) {
      console.error('[Stats] Error fetching stats:', error)
    } finally {
      setLoading(false)
    }
  }

  const getMyPlayer = async (): Promise<{ id: string } | null> => {
    if (!user) {
      return null
    }

    const { data, error } = await supabase
      .from('players')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_me', true)
      .maybeSingle()

    if (error) {
      console.error('[Stats] Error fetching my player:', error)
      return null
    }

    return data
  }

  const fetchGeneralEloHistory = async (): Promise<void> => {
    try {
      setLoadingGeneralEloHistory(true)

      // Usa la funzione getGeneralELOHistory per calcolare lo storico completo
      const history = await getGeneralELOHistory(supabase, user?.id)

      setGeneralEloHistory(history as EloHistoryEntry[])
    } catch (error) {
      console.error('[Stats] Errore nel recupero dello storico ELO Generale:', error)
    } finally {
      setLoadingGeneralEloHistory(false)
    }
  }

  // Prepara i dati per il grafico ELO
  const prepareELOChartData = (history: EloHistoryEntry[]): PreparedChartData => {
    if (!history || history.length === 0) return { chartData: [], players: [] }

    const uniquePlayers = new Set<string>()

    // Ordina per data
    const sorted = [...history].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    // Raggruppa per play_id per mostrare un punto per ogni partita
    // (evita di collassare più partite dello stesso giorno in un singolo punto)
    const groupedByPlay: Record<string, Record<string, number | string>> = {}
    sorted.forEach(entry => {
      const playId = entry.playId || entry.date
      if (!groupedByPlay[playId]) {
        groupedByPlay[playId] = { playId }
      }
      groupedByPlay[playId][entry.playerName] = entry.rating
      uniquePlayers.add(entry.playerName)
    })

    const players = Array.from(uniquePlayers)
    const playEntries = Object.values(groupedByPlay)

    // Forward-fill: propaga l'ultimo valore noto per ogni giocatore
    const lastKnown: Record<string, number> = {}
    const chartData: ChartPoint[] = playEntries.map((entry, index) => {
      const point: ChartPoint = { date: index + 1 }
      players.forEach(player => {
        if (entry[player] !== undefined) {
          lastKnown[player] = entry[player] as number
        }
        point[player] = lastKnown[player] ?? null
      })
      return point
    })

    return { chartData, players }
  }

  // Genera colori per i giocatori
  const getPlayerColors = (players: string[]): Record<string, string> => {
    const colors = [
      '#10b981', // emerald-500
      '#3b82f6', // blue-500
      '#f59e0b', // amber-500
      '#ef4444', // red-500
      '#8b5cf6', // violet-500
      '#ec4899', // pink-500
      '#06b6d4', // cyan-500
      '#84cc16', // lime-500
      '#f97316', // orange-500
      '#6366f1', // indigo-500
    ]

    const playerColors: Record<string, string> = {}
    players.forEach((player, index) => {
      playerColors[player] = colors[index % colors.length]
    })

    return playerColors
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

  // Mostra un messaggio se non ci sono dati
  if (stats.allGamesStats.length === 0 && stats.mostFrequentPlayers.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Statistiche Avanzate</h1>
          <p className="mt-2 text-slate-400">Analisi dettagliata delle partite</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-8 shadow-md text-center">
          <Gamepad2 className="w-16 h-16 mx-auto mb-4 text-slate-500" />
          <h3 className="text-xl font-bold text-white mb-2">Nessuna statistica disponibile</h3>
          <p className="text-slate-400 mb-4">
            Non ci sono ancora partite nel database. Aggiungi delle partite per vedere le statistiche.
          </p>
          <div className="text-sm text-slate-500 bg-slate-700 rounded-lg p-4 inline-block">
            <p className="font-semibold mb-2">Informazioni di debug:</p>
            <p>Win Rate: {stats.winRateByGame?.length || 0} giochi</p>
            <p>Giocatori frequenti: {stats.mostFrequentPlayers?.length || 0}</p>
            <p>Gioco del mese: {stats.gameOfTheMonth?.name || 'Nessuno'}</p>
            <p>Statistiche giochi: {stats.allGamesStats?.length || 0}</p>
            <p>ELO Generale: {generalEloHistory?.length || 0} punti</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Statistiche Avanzate</h1>
        <p className="mt-2 text-slate-400">Analisi dettagliata delle partite</p>
      </div>

      {/* Win Rate by Game */}
      {stats.winRateByGame && stats.winRateByGame.length > 0 && (
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center">
            <Trophy className="w-6 h-6 mr-2 text-purple-500" />
            Win Rate per Gioco (Top 10)
          </h2>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
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
                  formatter={(value: number | undefined, name: string | undefined) => [name ?? '', `${value ?? 0}%`]}
                />
                <Bar dataKey="winRate" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ELO Generale Chart */}
      <div className="bg-slate-800 rounded-xl p-6 shadow-md">
        <h2 className="text-xl font-bold text-white mb-4 flex items-center">
          <Star className="w-6 h-6 mr-2 text-yellow-500" />
          ELO Generale - Evoluzione nel Tempo
        </h2>
        {loadingGeneralEloHistory ? (
          <div className="flex items-center justify-center h-64 bg-slate-700 rounded-lg">
            <div className="text-center">
              <svg className="animate-spin h-8 w-8 text-emerald-500 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <p className="mt-2 text-slate-400">Caricamento storico ELO Generale...</p>
            </div>
          </div>
        ) : generalEloHistory && generalEloHistory.length > 0 ? (
          (() => {
            const { chartData, players } = prepareELOChartData(generalEloHistory)
            const playerColors = getPlayerColors(players)

            return (
              <div className="h-80 bg-slate-700 rounded-lg p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                    <XAxis
                      dataKey="date"
                      stroke="#94a3b8"
                      tick={{ fontSize: 11 }}
                      label={{ value: 'Partita', position: 'insideBottomRight', offset: -5, fill: '#94a3b8', fontSize: 11 }}
                      height={30}
                    />
                    <YAxis
                      stroke="#94a3b8"
                      tick={{ fontSize: 12 }}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }}
                      itemStyle={{ color: '#e2e8f0' }}
                      labelStyle={{ color: '#94a3b8' }}
                      labelFormatter={(value) => `Partita ${value}`}
                    />
                    <Legend
                      wrapperStyle={{ paddingTop: '20px' }}
                      iconType="circle"
                    />
                    {players.map((player) => (
                      <Line
                        key={player}
                        type="monotone"
                        dataKey={player}
                        stroke={playerColors[player]}
                        strokeWidth={2}
                        name={player}
                        connectNulls={true}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )
          })()
        ) : (
          <div className="flex items-center justify-center h-64 bg-slate-700 rounded-lg">
            <div className="text-center">
              <Star className="w-12 h-12 text-slate-500 mx-auto mb-2" />
              <p className="text-slate-400">Nessun dato ELO Generale disponibile</p>
              <p className="text-xs text-slate-500 mt-1">
                Gioca qualche partita per vedere l'evoluzione dell'ELO Generale
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Most Frequent Players */}
      <div className="bg-slate-800 rounded-xl p-6 shadow-md">
        <h2 className="text-xl font-bold text-white mb-4 flex items-center">
          <Users className="w-6 h-6 mr-2 text-emerald-500" />
          Giocatori più Frequenti
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {stats.mostFrequentPlayers.map((player) => (
            <div key={player.playerId} className="bg-slate-700 rounded-lg p-4">
              <div className="flex items-center space-x-3 mb-3">
                {player.playerAvatarUrl ? (
                  <img
                    src={getPlayerImageUrl(player.playerAvatarUrl!) ?? undefined}
                    alt={player.playerName}
                    className="w-12 h-12 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center">
                    <span className="text-emerald-500 font-bold text-lg">
                      {player.playerName?.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
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

      {/* All Games Statistics */}
      <div className="bg-slate-800 rounded-xl p-6 shadow-md">
        <h2 className="text-xl font-bold text-white mb-4 flex items-center">
          <Gamepad2 className="w-6 h-6 mr-2 text-emerald-500" />
          Statistiche per Gioco
        </h2>
        {stats.allGamesStats && stats.allGamesStats.length > 0 ? (
          <div className="space-y-4">
            {stats.allGamesStats.map((game) => (
              <div key={game.gameId} className="border border-slate-700 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    {game.gameImage ? (
                      <img
                        src={game.gameImage}
                        alt={game.gameName}
                        className="w-16 h-16 object-cover rounded-lg"
                      />
                    ) : (
                      <div className="w-16 h-16 bg-slate-700 rounded-lg flex items-center justify-center">
                        <Gamepad2 className="w-8 h-8 text-slate-400" />
                      </div>
                    )}
                    <div>
                      <h3 className="text-white font-bold text-lg">{game.gameName}</h3>
                      <p className="text-sm text-slate-400">{game.totalPlays} partite totali</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <div>
                      <p className="text-xs text-slate-400">Punteggio medio</p>
                      <p className="text-xl font-bold text-emerald-500">{game.avgScore}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Durata media</p>
                      <p className="text-xl font-bold text-blue-500">{game.avgDuration} min</p>
                    </div>
                    <button
                      onClick={() => toggleGameExpansion(game.gameId)}
                      className="flex items-center space-x-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                    >
                      <span className="text-sm">Statistiche giocatori</span>
                      {expandedGames[game.gameId] ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Players statistics for this game - collapsible */}
                {expandedGames[game.gameId] && (
                  <div className="mt-4 pt-4 border-t border-slate-700 space-y-6">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-300 mb-3">Punteggio medio per giocatore</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {game.players.map((player) => (
                          <div key={player.playerId} className="bg-slate-700 rounded-lg p-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-3">
                                {player.playerAvatarUrl ? (
                                  <img
                                    src={getPlayerImageUrl(player.playerAvatarUrl!) ?? undefined}
                                    alt={player.playerName}
                                    className="w-10 h-10 rounded-full object-cover"
                                  />
                                ) : (
                                  <div className="w-10 h-10 bg-emerald-500/20 rounded-full flex items-center justify-center">
                                    <span className="text-emerald-500 font-bold text-sm">
                                      {player.playerName?.charAt(0).toUpperCase()}
                                    </span>
                                  </div>
                                )}
                                <div>
                                  <p className="text-white font-medium">{player.playerName}</p>
                                  <p className="text-xs text-slate-400">{player.playCount} partite</p>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-lg font-bold text-emerald-500">{player.avgScore}</p>
                                <p className="text-xs text-slate-400">media</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* ELO History Chart */}
                    <div>
                      <h4 className="text-sm font-semibold text-slate-300 mb-3">Evoluzione ELO nel tempo</h4>
                      {loadingEloHistory[game.gameId] ? (
                        <div className="flex items-center justify-center h-64 bg-slate-700 rounded-lg">
                          <div className="text-center">
                            <svg className="animate-spin h-8 w-8 text-emerald-500 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <p className="mt-2 text-slate-400">Caricamento storico ELO...</p>
                          </div>
                        </div>
                      ) : eloHistory[game.gameId] && eloHistory[game.gameId].length > 0 ? (
                        (() => {
                          const { chartData, players } = prepareELOChartData(eloHistory[game.gameId])
                          const playerColors = getPlayerColors(players)

                          return (
                            <div className="h-80 bg-slate-700 rounded-lg p-4">
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chartData}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                                  <XAxis
                                    dataKey="date"
                                    stroke="#94a3b8"
                                    tick={{ fontSize: 11 }}
                                    label={{ value: 'Partita', position: 'insideBottomRight', offset: -5, fill: '#94a3b8', fontSize: 11 }}
                                    height={30}
                                  />
                                  <YAxis
                                    stroke="#94a3b8"
                                    tick={{ fontSize: 12 }}
                                    domain={['auto', 'auto']}
                                  />
                                  <Tooltip
                                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }}
                                    itemStyle={{ color: '#e2e8f0' }}
                                    labelStyle={{ color: '#94a3b8' }}
                                    labelFormatter={(value) => `Partita ${value}`}
                                  />
                                  <Legend
                                    wrapperStyle={{ paddingTop: '20px' }}
                                    iconType="circle"
                                  />
                                  {players.map((player) => (
                                    <Line
                                      key={player}
                                      type="monotone"
                                      dataKey={player}
                                      stroke={playerColors[player]}
                                      strokeWidth={2}
                                      name={player}
                                      connectNulls={true}
                                      dot={{ r: 3 }}
                                      activeDot={{ r: 5 }}
                                    />
                                  ))}
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                          )
                        })()
                      ) : (
                        <div className="flex items-center justify-center h-64 bg-slate-700 rounded-lg">
                          <div className="text-center">
                            <TrendingUp className="w-12 h-12 text-slate-500 mx-auto mb-2" />
                            <p className="text-slate-400">Nessun dato ELO disponibile</p>
                            <p className="text-xs text-slate-500 mt-1">
                              Gioca qualche partita per vedere l'evoluzione degli ELO
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-slate-400">
            <Gamepad2 className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <p>Nessun gioco disponibile</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default Stats
