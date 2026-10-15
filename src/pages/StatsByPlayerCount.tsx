import { isVisibleInRankings } from '../utils/rankingVisibility'
import { useEffect, useState } from 'react'
import { getPlayerOutcome } from '../utils/elo/outcomes'
import { Navigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { TrendingUp, Trophy, Gamepad2, Star, ChevronDown, ChevronUp } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend
} from 'recharts'
import { fetchAllPages } from '../utils/pagination'
import { getPlayerImageUrl } from '../utils/imageUpload'
import { Spinner } from '../components/Spinner'
import {
  PLAYER_COUNT_BUCKETS,
  isPlayerCountBucket,
  matchesPlayerCount,
  getGeneralELODataByPlayerCount,
  getELOHistoryForGameByPlayerCount
} from '../utils/elo/playerCountElo'
import type { PlayerCountBucket, PlayerCountGeneralStanding } from '../utils/elo/playerCountElo'

interface WinRateEntry {
  gameId: string
  gameName: string
  winRate: number
  totalPlays: number
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
  allGamesStats: ComputedGameStats[]
}

interface EloHistoryEntry {
  playerId: string
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

// Struttura identica a Stats.tsx ma con i dati limitati alle partite del
// bucket (numero di giocatori) selezionato: Stats.tsx resta invariato.
const StatsByPlayerCount = () => {
  const { user } = useAuth()
  const { bucket: bucketParam } = useParams<{ bucket: string }>()

  const bucket: PlayerCountBucket | null = isPlayerCountBucket(bucketParam) ? bucketParam : null
  const bucketDef = bucket ? PLAYER_COUNT_BUCKETS[bucket] : null

  const [stats, setStats] = useState<StatsState>({
    winRateByGame: [],
    allGamesStats: []
  })

  const [loading, setLoading] = useState<boolean>(true)
  const [expandedGames, setExpandedGames] = useState<Record<string, boolean>>({})
  const [eloHistory, setEloHistory] = useState<Record<string, EloHistoryEntry[]>>({})
  const [loadingEloHistory, setLoadingEloHistory] = useState<Record<string, boolean>>({})
  const [generalEloHistory, setGeneralEloHistory] = useState<EloHistoryEntry[]>([])
  const [loadingGeneralEloHistory, setLoadingGeneralEloHistory] = useState<boolean>(false)
  // Classifica visiva ELO Generale del bucket (stessi dati del grafico sopra)
  const [generalStandings, setGeneralStandings] = useState<PlayerCountGeneralStanding[]>([])
  const [hiddenPlayerIds, setHiddenPlayerIds] = useState<Set<string>>(new Set())
  const [playerColorMap, setPlayerColorMap] = useState<Record<string, string>>({})
  const [playerAvatarMap, setPlayerAvatarMap] = useState<Record<string, string | null>>({})
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null)

  useEffect(() => {
    if (!bucket) return

    // Al cambio bucket azzera lo stato espanso/storici della pagina precedente
    setExpandedGames({})
    setEloHistory({})
    setLoadingEloHistory({})
    void fetchStats()
    void fetchGeneralEloHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket])

  const toggleGameExpansion = async (gameId: string): Promise<void> => {
    if (!bucket) return
    const isExpanding = !expandedGames[gameId]

    setExpandedGames(prev => ({
      ...prev,
      [gameId]: isExpanding
    }))

    // Se stiamo espandendo e non abbiamo ancora lo storico ELO, recuperalo
    if (isExpanding && !eloHistory[gameId]) {
      try {
        setLoadingEloHistory(prev => ({ ...prev, [gameId]: true }))
        const history = await getELOHistoryForGameByPlayerCount(supabase, gameId, user?.id, bucket)
        setEloHistory(prev => ({ ...prev, [gameId]: history as EloHistoryEntry[] }))
      } catch (error) {
        console.error('[StatsByPlayerCount] Errore nel recupero dello storico ELO:', error)
      } finally {
        setLoadingEloHistory(prev => ({ ...prev, [gameId]: false }))
      }
    }
  }

  const fetchStats = async (): Promise<void> => {
    if (!bucket) return
    try {
      setLoading(true)

      // Fetch all plays with games and scores (public data)
      // Lettura paginata: PostgREST tronca in silenzio oltre db-max-rows
      // (1000 righe) qualunque limit richiesto.
      const playsData = await fetchAllPages((from, to) =>
        supabase
          .from('plays')
          .select(`
            *,
            games(*),
            play_scores(
              *,
              players(*)
            )
          `, { count: 'exact' })
          .order('played_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to)
      )

      // Filtro centrale della pagina: solo partite con il numero di giocatori del bucket
      const plays = playsData.filter(play =>
        matchesPlayerCount(play.play_scores?.length ?? 0, bucket)
      )

      const hiddenIds = new Set(playsData.flatMap(play =>
        (play.play_scores ?? []).filter(score => !isVisibleInRankings(score.players?.name))
          .map(score => score.player_id ?? '')
      ))
      setHiddenPlayerIds(hiddenIds)

      if (plays.length === 0) {
        console.warn(`[StatsByPlayerCount] No plays found for bucket ${bucket}`)
        setStats({
          winRateByGame: [],
          allGamesStats: []
        })
        return
      }

      // Calculate Win Rate by Game (Top 10) - only for logged in users
      const gameWinRates: Record<string, { total: number; wins: number }> = {}
      const myPlayer = user ? await getMyPlayer() : null
      setMyPlayerId(myPlayer?.id ?? null)

      // Mappa playerId → avatar per la classifica ELO del bucket
      const avatarMap: Record<string, string | null> = {}
      plays.forEach(play => {
        play.play_scores?.forEach(score => {
          if (score.player_id && !(score.player_id in avatarMap)) {
            avatarMap[score.player_id] = score.players?.avatar_url ?? null
          }
        })
      })
      setPlayerAvatarMap(avatarMap)

      if (myPlayer) {
        plays.forEach(play => {
          const gameId = play.game_id ?? ""
          const myScore = play.play_scores?.find(s => s.player_id === myPlayer?.id)

          if (!gameWinRates[gameId]) {
            gameWinRates[gameId] = { total: 0, wins: 0 }
          }

          gameWinRates[gameId].total++
          if (getPlayerOutcome(myScore, play.play_scores, play) === 'win') {
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

      // Calculate stats for all games (per game statistics)
      const allGamesStats: Record<string, GameStats> = {}
      plays.forEach(play => {
        const gameId = play.game_id ?? ""
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
          const playerId = score.player_id ?? ""
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

        const playersWithAvgScore: PlayerStats[] = Object.values(game.players).filter(player => !hiddenIds.has(player.playerId)).map(player => ({
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
        allGamesStats: gamesWithStats
      })

      // Build player display-name → color map from fetched play data
      const colorMap: Record<string, string> = {}
      plays.forEach(play => {
        play.play_scores?.forEach(score => {
          const player = score.players
          if (player?.color) {
            const displayName = player.alias || player.name
            colorMap[displayName] = player.color
          }
        })
      })
      setPlayerColorMap(colorMap)
    } catch (error) {
      console.error('[StatsByPlayerCount] Error fetching stats:', error)
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
      console.error('[StatsByPlayerCount] Error fetching my player:', error)
      return null
    }

    return data
  }

  const fetchGeneralEloHistory = async (): Promise<void> => {
    if (!bucket) return
    try {
      setLoadingGeneralEloHistory(true)

      // Storico ELO Generale e classifica simulati solo sulle partite del bucket
      const { history, standings } = await getGeneralELODataByPlayerCount(supabase, user?.id, bucket)

      setGeneralEloHistory(history as EloHistoryEntry[])
      setGeneralStandings(standings)
    } catch (error) {
      console.error('[StatsByPlayerCount] Errore nel recupero dello storico ELO Generale:', error)
    } finally {
      setLoadingGeneralEloHistory(false)
    }
  }

  // Prepara i dati per il grafico ELO
  const prepareELOChartData = (history: EloHistoryEntry[]): PreparedChartData => {
    if (!history || history.length === 0) return { chartData: [], players: [] }

    const uniquePlayers = new Set<string>()

    // Ordina per data
    const sorted = history.filter(entry => !hiddenPlayerIds.has(entry.playerId) && isVisibleInRankings(entry.playerName))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

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
    let fallbackIndex = 0
    players.forEach((player) => {
      if (playerColorMap[player]) {
        playerColors[player] = playerColorMap[player]
      } else {
        playerColors[player] = colors[fallbackIndex % colors.length]
        fallbackIndex++
      }
    })

    return playerColors
  }

  const visibleStandings = generalStandings.filter(standing =>
    !hiddenPlayerIds.has(standing.playerId) && isVisibleInRankings(standing.playerName)
  )

  // Helper classifica: stessi criteri visivi della pagina Rating ELO
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

  if (!bucket || !bucketDef) {
    return <Navigate to="/stats" replace />
  }

  if (loading) {
    return <Spinner className="h-64" />
  }

  // Mostra un messaggio se non ci sono dati
  if (stats.allGamesStats.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-white">{bucketDef.label}</h1>
          <p className="mt-2 text-slate-400">{bucketDef.description}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-8 shadow-md text-center">
          <Gamepad2 className="w-16 h-16 mx-auto mb-4 text-slate-500" />
          <h3 className="text-xl font-bold text-white mb-2">Nessuna statistica disponibile</h3>
          <p className="text-slate-400 mb-4">
            Non ci sono ancora partite a {bucketDef.maxPlayers === null ? '5 o più' : bucketDef.maxPlayers} giocatori nel database. Aggiungi delle partite per vedere le statistiche.
          </p>
          <div className="text-sm text-slate-500 bg-slate-700 rounded-lg p-4 inline-block">
            <p className="font-semibold mb-2">Informazioni di debug:</p>
            <p>Win Rate: {stats.winRateByGame?.length || 0} giochi</p>
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
        <h1 className="text-3xl font-bold text-white">{bucketDef.label}</h1>
        <p className="mt-2 text-slate-400">{bucketDef.description}</p>
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
          {bucketDef.eloLabel}
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
                Gioca qualche partita a {bucketDef.maxPlayers === null ? '5 o più' : bucketDef.maxPlayers} giocatori per vedere l'evoluzione dell'ELO Generale
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ELO Generale - Classifica visiva (come in Rating ELO) */}
      <div className="bg-slate-800 rounded-xl p-6 shadow-md">
        <div className="flex items-center mb-6">
          <Star className="w-6 h-6 mr-2 text-yellow-500" />
          <h2 className="text-xl font-bold text-white">{bucketDef.eloLabel}</h2>
          <span className="ml-3 text-sm text-slate-400">
            (Classifica aggregata · {bucketDef.description.toLowerCase()})
          </span>
        </div>

        {visibleStandings.length === 0 ? (
          <div className="text-center py-12">
            <Star className="w-16 h-16 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400">Nessun ELO Generale disponibile</p>
            <p className="text-sm text-slate-500 mt-2">
              Gioca qualche partita a {bucketDef.maxPlayers === null ? '5 o più' : bucketDef.maxPlayers} giocatori per vedere la classifica
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {visibleStandings.map((standing, index) => {
              const isMyPlayer = standing.playerId === myPlayerId
              const badge = getRatingBadge(standing.rating)
              const winRate = getWinRate(standing.wins, standing.losses, standing.draws)
              const avatarUrl = playerAvatarMap[standing.playerId] ?? null

              return (
                <div
                  key={standing.playerId}
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

                    {avatarUrl ? (
                      <img
                        src={getPlayerImageUrl(supabase, avatarUrl) ?? undefined}
                        alt={standing.playerName}
                        className="w-12 h-12 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 bg-slate-600 rounded-full flex items-center justify-center">
                        <span className="text-white font-bold text-lg">
                          {standing.playerName.charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}

                    <div>
                      <div className="flex items-center space-x-2">
                        <p className="text-white font-medium">
                          {standing.playerName}
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
                          {standing.gamesPlayed} partite totali
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-6">
                    <div className="text-right">
                      <p className={`text-3xl font-bold ${getRatingColor(standing.rating)}`}>
                        {standing.rating}
                      </p>
                      <p className="text-xs text-slate-400">ELO Generale</p>
                    </div>

                    <div className="text-right hidden md:block">
                      <p className="text-white font-medium">{winRate}%</p>
                      <p className="text-xs text-slate-400">Win Rate</p>
                    </div>

                    <div className="flex items-center space-x-4 text-sm">
                      <div className="text-center">
                        <p className="text-emerald-400 font-bold">{standing.wins}</p>
                        <p className="text-xs text-slate-400">V</p>
                      </div>
                      <div className="text-center">
                        <p className="text-slate-400 font-bold">{standing.draws}</p>
                        <p className="text-xs text-slate-400">P</p>
                      </div>
                      <div className="text-center">
                        <p className="text-red-400 font-bold">{standing.losses}</p>
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
                                    src={getPlayerImageUrl(supabase, player.playerAvatarUrl!) ?? undefined}
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
                              Gioca qualche partita a {bucketDef.maxPlayers === null ? '5 o più' : bucketDef.maxPlayers} giocatori per vedere l'evoluzione degli ELO
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

export default StatsByPlayerCount
