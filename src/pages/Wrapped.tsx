import { useState, useEffect, useRef } from 'react'
import { isVisibleInRankings } from '../utils/rankingVisibility'
import { getPlayerOutcome } from '../utils/elo/outcomes'
import { supabase } from '../lib/supabase'
import Spinner from '../components/Spinner'
import { Trophy, Calendar, TrendingUp, Award, Clock, Sparkles } from 'lucide-react'
import { BarChart, Bar, LineChart, Line, Legend, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { fetchAllPages } from '../utils/pagination'
import type { DbGame, DbPlayer, DbPlayWithScores } from '../types/rows'
import { useAuth } from '../contexts/AuthContext'
import { atomicEloReadsEnabled, readGlobalEloYear, eloReadStatus } from '../utils/elo/readClient'
import type { EloRead } from '../utils/elo/readModel'

interface EloEntry {
  players?: { name: string } | null
  player_id: string
  player_name: string
  rating: number
  rating_change: number
  date: string
}

interface PlayerEloSummary {
  player_id: string
  player_name: string
  startRating: number
  endRating: number
  change: number
}

type EloChartPoint = Record<string, string | number>

const ELO_LINE_COLORS = ['#10b981', '#38bdf8', '#f59e0b', '#f43f5e', '#a855f7', '#fb923c', '#84cc16', '#06b6d4']

function formatChartDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const months = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']
  return `${d.getDate()} ${months[d.getMonth()]}`
}

function eloChangeSkyClass(change: number): string {
  if (change > 0) return 'text-emerald-300'
  if (change < 0) return 'text-red-300'
  return 'text-white'
}

function eloChangeClass(change: number): string {
  if (change > 0) return 'text-emerald-400'
  if (change < 0) return 'text-red-400'
  return 'text-slate-400'
}

interface WrappedStats {
  totalPlays: number
  totalHours: number
  uniqueGames: number
  topGame: { game: DbGame; count: number; winRate?: number } | null
  topMonth: { month: number; count: number; hours: number; uniqueGames: number } | null
  monthlyData: { month: string; partite: number }[]
  wins?: number
  winRate?: number
  bestGame?: { game: DbGame; wins: number } | null
  longestGame?: { play: DbPlayWithScores; duration: number } | null
  busiestDay?: { date: string; count: number } | null
}

const MONTHS = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
]

const Wrapped = () => {
  const { user } = useAuth()
  const currentUserId = user?.id
  const isAdmin = user?.app_metadata?.role === 'admin'
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear())
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>('')
  const [players, setPlayers] = useState<DbPlayer[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<WrappedStats | null>(null)
  const [availableYears, setAvailableYears] = useState<number[]>([])
  const [eloRanking, setEloRanking] = useState<PlayerEloSummary[]>([])
  const [playerEloDetail, setPlayerEloDetail] = useState<PlayerEloSummary | null>(null)
  const [eloChartData, setEloChartData] = useState<EloChartPoint[]>([])
  const [eloPlayerNames, setEloPlayerNames] = useState<string[]>([])
  const [publication, setPublication] = useState<EloRead | null>(null)
  const [publicationFailed, setPublicationFailed] = useState(false)
  const loadGeneration = useRef({ value: 0 })

  useEffect(() => {
    void loadInitialData()
  }, [])

  useEffect(() => {
    const generation = loadGeneration.current
    if (availableYears.length > 0) {
      void loadStats()
    }
    return () => { generation.value++ }
  }, [selectedYear, selectedPlayerId, availableYears])

  useEffect(() => {
    if (!currentUserId || isAdmin) return
    const linkedPlayer = players.find((player) => player.account_user_id === currentUserId)
    if (linkedPlayer) setSelectedPlayerId((current) => current || linkedPlayer.id)
  }, [currentUserId, isAdmin, players])

  const loadInitialData = async () => {
    setLoading(true)
    
    // Carica anni disponibili
    const { data: playsData } = await supabase
      .from('plays')
      .select('played_at')
      .order('played_at', { ascending: true })
    
    if (playsData) {
      const years = [...new Set(playsData.map(p => new Date(p.played_at).getFullYear()))]
      setAvailableYears(years.sort((a, b) => b - a))
    }

    // Carica giocatori
    const { data: playersData } = await supabase
      .from('players')
      .select('*')
      .order('name', { ascending: true })
    
    if (playersData) {
      setPlayers(playersData)
    }

    setLoading(false)
  }

  const loadStats = async () => {
    const generation = ++loadGeneration.current.value
    setLoading(true)
    setPublication(null)
    setPublicationFailed(false)
    setEloRanking([])
    setPlayerEloDetail(null)
    setEloChartData([])
    setEloPlayerNames([])

    // Carica partite dell'anno (paginata: cap PostgREST di 1000 righe)
    const plays = await fetchAllPages<DbPlayWithScores>((from, to) =>
      supabase
        .from('plays')
        .select(`
          *,
          games(*),
          play_scores(*, players(*))
        `, { count: 'exact' })
          .gte('played_at', `${selectedYear}-01-01`)
          .lte('played_at', `${selectedYear}-12-31`)
          .order('played_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
    )

    if (generation !== loadGeneration.current.value) return
    if (plays.length === 0) {
      setStats(null)
      await loadEloStats(generation)
      if (generation === loadGeneration.current.value) setLoading(false)
      return
    }

    // Filtra partite per giocatore se selezionato
    let filteredPlays: DbPlayWithScores[] = plays
    if (selectedPlayerId) {
      filteredPlays = plays.filter(play =>
        play.play_scores?.some((score) => score.player_id === selectedPlayerId)
      )
    }

    // Calcola statistiche
    const calculatedStats = calculateStats(filteredPlays, selectedPlayerId)
    setStats(calculatedStats)

    // Carica ELO Generale per l'anno
    await loadEloStats(generation)

    if (generation === loadGeneration.current.value) setLoading(false)
  }

  const loadEloStats = async (generation: number) => {
    // Lettura paginata: elo_history per un anno supera il cap PostgREST di
    // 1000 righe e verrebbe troncata in silenzio (rating finali e grafico
    // dell'anno calcolati su dati parziali).
    let eloData: EloEntry[] = []
    try {
      if (atomicEloReadsEnabled) {
        const { read, history } = await readGlobalEloYear(supabase, selectedYear)
        if (generation !== loadGeneration.current.value) return
        setPublication(read)
        eloData = (history ?? []).map(point => ({ player_id: point.playerId, player_name: point.playerName, rating: point.rating, rating_change: point.ratingChange, date: point.date }))
      } else {
      eloData = await fetchAllPages<EloEntry>((from, to) =>
        supabase
          .from('elo_history')
          .select('player_id, player_name, rating, rating_change, date, players(name)', { count: 'exact' })
          .eq('is_general', true)
          .gte('date', `${selectedYear}-01-01`)
          .lte('date', `${selectedYear}-12-31T23:59:59`)
          .order('date', { ascending: true })
          .order('play_id', { ascending: true })
          .order('player_id', { ascending: true })
          .range(from, to)
      )
      }
    } catch (error) {
      if (generation !== loadGeneration.current.value) return
      if (atomicEloReadsEnabled) setPublicationFailed(true)
      console.error('[Wrapped] Errore nel recupero dello storico ELO:', error)
    }
    if (generation !== loadGeneration.current.value) return

    if (eloData.length === 0) {
      setEloRanking([])
      setPlayerEloDetail(null)
      setEloChartData([])
      setEloPlayerNames([])
      return
    }

    const entries = eloData

    // Raggruppa per player_id: primo e ultimo rating nell'anno
    const playerMap = new Map<string, { name: string; first: EloEntry; last: EloEntry }>()
    entries.forEach(entry => {
      const existing = playerMap.get(entry.player_id)
      if (existing) {
        existing.last = entry
      } else {
        playerMap.set(entry.player_id, { name: entry.player_name, first: entry, last: entry })
      }
    })

    const summaries: PlayerEloSummary[] = Array.from(playerMap.values()).map(p => ({
      player_id: p.first.player_id,
      player_name: p.name,
      startRating: p.first.rating - p.first.rating_change, // rating prima della prima partita dell'anno
      endRating: p.last.rating,
      change: p.last.rating - (p.first.rating - p.first.rating_change)
    }))

    // Ranking globale ordinato per ELO finale decrescente
    summaries.sort((a, b) => b.endRating - a.endRating)
    const visiblePlayerIds = new Set(entries.filter(entry =>
      isVisibleInRankings(entry.players?.name ?? entry.player_name)
    ).map(entry => entry.player_id))
    setEloRanking(summaries.filter(summary => visiblePlayerIds.has(summary.player_id)))

    // Dettaglio per il giocatore selezionato
    if (selectedPlayerId) {
      const detail = summaries.find(s => s.player_id === selectedPlayerId) || null
      setPlayerEloDetail(detail)
    } else {
      setPlayerEloDetail(null)
    }

    // Build chart data
    if (selectedPlayerId) {
      const playerEntries = entries.filter(e => e.player_id === selectedPlayerId)
      const chartPoints: EloChartPoint[] = playerEntries.map(e => ({
        date: formatChartDate(e.date.slice(0, 10)),
        ELO: e.rating
      }))
      setEloChartData(chartPoints)
      setEloPlayerNames(['ELO'])
    } else {
      const dateMap = new Map<string, Map<string, number>>()
      entries.forEach(entry => {
        const dateKey = entry.date.slice(0, 10)
        if (!dateMap.has(dateKey)) dateMap.set(dateKey, new Map())
        dateMap.get(dateKey)?.set(entry.player_name, entry.rating)
      })
      const sortedDates = Array.from(dateMap.keys()).sort()
      const currentElo = new Map<string, number>()
      const playerNames = summaries.filter(s => visiblePlayerIds.has(s.player_id)).map(s => s.player_name)
      const chartPoints: EloChartPoint[] = sortedDates.map(dateKey => {
        dateMap.get(dateKey)?.forEach((rating, name) => currentElo.set(name, rating))
        const point: EloChartPoint = { date: formatChartDate(dateKey) }
        playerNames.forEach(name => {
          const r = currentElo.get(name)
          if (r !== undefined) point[name] = r
        })
        return point
      })
      setEloChartData(chartPoints)
      setEloPlayerNames(playerNames)
    }
  }

  const calculateStats = (plays: DbPlayWithScores[], playerId?: string): WrappedStats => {
    const totalPlays = plays.length
    const totalHours = plays.reduce((sum, play) => sum + (play.duration_minutes || 0), 0) / 60
    
    // Giochi unici
    const uniqueGames = new Set(plays.map(p => p.game_id)).size

    // Gioco più giocato
    const gameCounts = new Map<string, { game: DbGame; count: number; wins: number }>()
    plays.forEach(play => {
      if (!play.games) return
      const current = gameCounts.get(play.game_id ?? "") || { game: play.games, count: 0, wins: 0 }
      current.count++
      
      if (playerId) {
        const playerScore = play.play_scores?.find(s => s.player_id === playerId)
        if (getPlayerOutcome(playerScore, play.play_scores, play) === 'win') {
          current.wins++
        }
      }
      
      gameCounts.set(play.game_id ?? "", current)
    })

    let topGame: { game: DbGame; count: number; winRate?: number } | null = null
    if (gameCounts.size > 0) {
      const sorted = Array.from(gameCounts.values()).sort((a, b) => b.count - a.count)
      const top = sorted[0]
      topGame = {
        game: top.game,
        count: top.count,
        winRate: playerId && top.count > 0 ? (top.wins / top.count) * 100 : undefined
      }
    }

    // Mese più giocato: partite, ore e giochi distinti del mese
    const monthStats = new Map<number, { count: number; minutes: number; games: Set<string> }>()
    plays.forEach(play => {
      const month = new Date(play.played_at).getMonth()
      const entry = monthStats.get(month) || { count: 0, minutes: 0, games: new Set<string>() }
      entry.count++
      entry.minutes += play.duration_minutes || 0
      if (play.game_id) entry.games.add(play.game_id)
      monthStats.set(month, entry)
    })

    let topMonth: { month: number; count: number; hours: number; uniqueGames: number } | null = null
    if (monthStats.size > 0) {
      const sorted = Array.from(monthStats.entries()).sort((a, b) => b[1].count - a[1].count)
      const [month, data] = sorted[0]
      topMonth = { month, count: data.count, hours: data.minutes / 60, uniqueGames: data.games.size }
    }

    // Dati mensili (tutti e 12 i mesi)
    const monthlyData = MONTHS.map((month, idx) => ({
      month,
      partite: monthStats.get(idx)?.count || 0
    }))

    // Statistiche specifiche per giocatore
    let wins: number | undefined
    let winRate: number | undefined
    let bestGame: { game: DbGame; wins: number } | null = null

    if (playerId) {
      wins = 0
      plays.forEach(play => {
        const playerScore = play.play_scores?.find(s => s.player_id === playerId)
        if (getPlayerOutcome(playerScore, play.play_scores, play) === 'win') {
          wins!++
        }
      })
      winRate = totalPlays > 0 ? (wins / totalPlays) * 100 : 0

      // Gioco con più vittorie
      if (gameCounts.size > 0) {
        const sorted = Array.from(gameCounts.values())
          .filter(g => g.wins > 0)
          .sort((a, b) => b.wins - a.wins)
        if (sorted.length > 0) {
          bestGame = { game: sorted[0].game, wins: sorted[0].wins }
        }
      }
    }

    // Partita più lunga
    let longestGame: { play: DbPlayWithScores; duration: number } | null = null
    const playsWithDuration = plays.filter(p => p.duration_minutes && p.duration_minutes > 0)
    if (playsWithDuration.length > 0) {
      const longest = playsWithDuration.reduce((max, play) =>
        (play.duration_minutes || 0) > (max.duration_minutes || 0) ? play : max
      )
      longestGame = { play: longest, duration: longest.duration_minutes || 0 }
    }

    // Giornata con più partite
    const dayCounts = new Map<string, number>()
    plays.forEach(play => {
      const date = play.played_at.split('T')[0]
      dayCounts.set(date, (dayCounts.get(date) || 0) + 1)
    })

    let busiestDay: { date: string; count: number } | null = null
    if (dayCounts.size > 0) {
      const sorted = Array.from(dayCounts.entries()).sort((a, b) => b[1] - a[1])
      busiestDay = { date: sorted[0][0], count: sorted[0][1] }
    }

    return {
      totalPlays,
      totalHours,
      uniqueGames,
      topGame,
      topMonth,
      monthlyData,
      wins,
      winRate,
      bestGame,
      longestGame,
      busiestDay
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })
  }

  if (loading) {
    return <Spinner />
  }

  const selectedPlayerName = selectedPlayerId
    ? players.find(p => p.id === selectedPlayerId)?.name || 'Giocatore'
    : 'Tutti'
  const linkedPlayer = user ? players.find((player) => player.account_user_id === user.id) : undefined

  return (
    <div className="min-h-screen bg-slate-900 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {atomicEloReadsEnabled && <p role="status" className="mb-6 rounded-lg bg-slate-800 p-4 text-slate-200">{eloReadStatus(publication, publicationFailed)}</p>}
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <Sparkles className="w-12 h-12 text-amber-400 mr-3" />
            <h1 className="text-5xl font-bold text-white">Wrapped {selectedYear}</h1>
          </div>
          <p className="text-xl text-slate-300">
            {selectedPlayerId ? `Il tuo anno in gioco, ${selectedPlayerName}` : 'Un anno di partite incredibili'}
          </p>
        </div>

        {/* Selettori */}
        <div className="flex flex-wrap gap-4 justify-center mb-12">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Anno</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {availableYears.map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Giocatore</label>
            <select
              value={selectedPlayerId}
              onChange={(e) => setSelectedPlayerId(e.target.value)}
              className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {!isAdmin && linkedPlayer && (
                <option value={linkedPlayer.id}>{linkedPlayer.alias || linkedPlayer.name}</option>
              )}
              <option value="">Tutti i giocatori</option>
              {isAdmin && players.map(player => (
                <option key={player.id} value={player.id}>
                  {player.alias || player.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Nessun dato */}
        {!stats && (
          <div className="text-center py-20">
            <Calendar className="w-16 h-16 text-slate-600 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-400 mb-2">
              Nessuna partita registrata nel {selectedYear}
            </h2>
            <p className="text-slate-500">
              {selectedPlayerId
                ? `${selectedPlayerName} non ha giocato partite in questo anno.`
                : 'Non ci sono partite registrate per questo anno.'}
            </p>
          </div>
        )}

        {/* Statistiche */}
        {stats && (
          <>
            {/* Grid statistiche principali */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {/* Card 1 - Il grande totale */}
              <div className="bg-gradient-to-br from-emerald-800 to-emerald-700 rounded-xl p-6 shadow-lg">
                <div className="flex items-center mb-4">
                  <Trophy className="w-8 h-8 text-emerald-200 mr-3" />
                  <h3 className="text-lg font-semibold text-white">Il Grande Totale</h3>
                </div>
                <div className="space-y-2">
                  <div>
                    <p className="text-4xl font-bold text-white">{stats.totalPlays}</p>
                    <p className="text-emerald-200">Partite giocate</p>
                  </div>
                  <div>
                    <p className="text-3xl font-bold text-white">{stats.totalHours.toFixed(1)}h</p>
                    <p className="text-emerald-200">Ore di gioco</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-white">{stats.uniqueGames}</p>
                    <p className="text-emerald-200">Giochi diversi</p>
                  </div>
                </div>
              </div>

              {/* Card 2 - Gioco dell'Anno */}
              {stats.topGame && (
                <div className="bg-gradient-to-br from-violet-800 to-violet-700 rounded-xl p-6 shadow-lg">
                  <div className="flex items-center mb-4">
                    <Award className="w-8 h-8 text-violet-200 mr-3" />
                    <h3 className="text-lg font-semibold text-white">Gioco dell'Anno</h3>
                  </div>
                  {stats.topGame.game.image_url && (
                    <img
                      src={stats.topGame.game.image_url}
                      alt={stats.topGame.game.name}
                      className="w-full h-32 object-cover rounded-lg mb-4"
                    />
                  )}
                  <div className="flex items-center mb-2">
                    <span className="text-3xl mr-2">🎲</span>
                    <p className="text-2xl font-bold text-white">{stats.topGame.game.name}</p>
                  </div>
                  <p className="text-violet-200 mb-1">
                    <span className="text-3xl font-bold">{stats.topGame.count}</span> partite
                  </p>
                  {stats.topGame.winRate !== undefined && (
                    <p className="text-violet-200">
                      Win rate: <span className="font-bold">{stats.topGame.winRate.toFixed(1)}%</span>
                    </p>
                  )}
                </div>
              )}

              {/* Card 3 - Mese più produttivo */}
              {stats.topMonth && (
                <div className="bg-gradient-to-br from-amber-800 to-amber-700 rounded-xl p-6 shadow-lg">
                  <div className="flex items-center mb-4">
                    <Calendar className="w-8 h-8 text-amber-200 mr-3" />
                    <h3 className="text-lg font-semibold text-white">Mese piu' giocato</h3>
                  </div>
                  <div>
                    <p className="text-4xl font-bold text-white mb-2">
                      {MONTHS[stats.topMonth.month]}
                    </p>
                    <p className="text-amber-200">
                      <span className="text-3xl font-bold">{stats.topMonth.count}</span> partite
                    </p>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="bg-amber-900/40 rounded-lg p-3">
                      <p className="text-2xl font-bold text-white">{stats.topMonth.hours.toFixed(1)}h</p>
                      <p className="text-sm text-amber-200">Ore di gioco</p>
                    </div>
                    <div className="bg-amber-900/40 rounded-lg p-3">
                      <p className="text-2xl font-bold text-white">{stats.topMonth.uniqueGames}</p>
                      <p className="text-sm text-amber-200">Giochi diversi</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Card 4 - Vittorie (solo se giocatore selezionato) */}
              {selectedPlayerId && stats.wins !== undefined && (
                <div className="bg-gradient-to-br from-rose-800 to-rose-700 rounded-xl p-6 shadow-lg">
                  <div className="flex items-center mb-4">
                    <Trophy className="w-8 h-8 text-rose-200 mr-3" />
                    <h3 className="text-lg font-semibold text-white">Le tue Vittorie</h3>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <p className="text-4xl font-bold text-white">{stats.wins}</p>
                      <p className="text-rose-200">Vittorie totali</p>
                    </div>
                    <div>
                      <p className="text-3xl font-bold text-white">{stats.winRate?.toFixed(1)}%</p>
                      <p className="text-rose-200">Win rate</p>
                    </div>
                    {stats.bestGame && (
                      <div>
                        <p className="text-sm text-rose-200 mt-3">Gioco con più vittorie:</p>
                        <p className="text-xl font-bold text-white">{stats.bestGame.game.name}</p>
                        <p className="text-rose-200">{stats.bestGame.wins} vittorie</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Card 5 - Record */}
              <div className="bg-gradient-to-br from-indigo-800 to-indigo-700 rounded-xl p-6 shadow-lg">
                <div className="flex items-center mb-4">
                  <TrendingUp className="w-8 h-8 text-indigo-200 mr-3" />
                  <h3 className="text-lg font-semibold text-white">Record</h3>
                </div>
                <div className="space-y-3">
                  {stats.longestGame && (
                    <div>
                      <p className="text-sm text-indigo-200">Partita più lunga:</p>
                      <p className="text-2xl font-bold text-white">
                        {stats.longestGame.duration} minuti
                      </p>
                      {stats.longestGame.play.games && (
                        <p className="text-indigo-200">{stats.longestGame.play.games.name}</p>
                      )}
                    </div>
                  )}
                  {stats.busiestDay && (
                    <div>
                      <p className="text-sm text-indigo-200">Giornata più intensa:</p>
                      <p className="text-xl font-bold text-white">
                        {stats.busiestDay.count} partite
                      </p>
                      <p className="text-indigo-200">{formatDate(stats.busiestDay.date)}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ELO Generale — singolo giocatore */}
            {selectedPlayerId && playerEloDetail && (
              <div className="bg-gradient-to-br from-sky-800 to-sky-700 rounded-xl p-6 shadow-lg mb-8">
                <div className="flex items-center mb-4">
                  <TrendingUp className="w-7 h-7 text-sky-200 mr-3" />
                  <h3 className="text-xl font-semibold text-white">ELO Generale {selectedYear}</h3>
                </div>
                <div className="grid grid-cols-3 gap-6 text-center">
                  <div>
                    <p className="text-sm text-sky-200 mb-1">Inizio anno</p>
                    <p className="text-4xl font-bold text-white">{playerEloDetail.startRating}</p>
                  </div>
                  <div>
                    <p className="text-sm text-sky-200 mb-1">Variazione</p>
                    <p className={`text-4xl font-bold ${eloChangeSkyClass(playerEloDetail.change)}`}>
                      {playerEloDetail.change > 0 ? '+' : ''}{playerEloDetail.change}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-sky-200 mb-1">Fine anno</p>
                    <p className="text-4xl font-bold text-white">{playerEloDetail.endRating}</p>
                  </div>
                </div>
              </div>
            )}

            {/* ELO Generale — classifica tutti i giocatori */}
            {eloRanking.length > 0 && (
              <div className="bg-slate-800 rounded-xl p-6 shadow-lg mb-8">
                <div className="flex items-center mb-6">
                  <TrendingUp className="w-6 h-6 text-slate-300 mr-3" />
                  <h3 className="text-xl font-semibold text-white">Classifica ELO Generale {selectedYear}</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-700">
                        <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">#</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Giocatore</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Inizio {selectedYear}</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Fine {selectedYear}</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Variazione</th>
                      </tr>
                    </thead>
                    <tbody>
                      {eloRanking.map((entry, index) => (
                        <tr
                          key={entry.player_id}
                          className={`border-b border-slate-700 ${
                            entry.player_id === selectedPlayerId ? 'bg-sky-500/10' : ''
                          }`}
                        >
                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${['bg-yellow-500 text-white', 'bg-slate-400 text-white', 'bg-orange-600 text-white'][index] ?? 'bg-slate-700 text-slate-300'}`}>
                              {index + 1}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className={`font-medium ${
                              entry.player_id === selectedPlayerId ? 'text-sky-300' : 'text-white'
                            }`}>
                              {entry.player_name}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right text-slate-300">{entry.startRating}</td>
                          <td className="py-3 px-4 text-right font-bold text-white">{entry.endRating}</td>
                          <td className="py-3 px-4 text-right">
                            <span className={`font-medium ${eloChangeClass(entry.change)}`}>
                              {entry.change > 0 ? '+' : ''}{entry.change}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Grafico Andamento ELO Generale */}
            {eloChartData.length > 0 && (
              <div className="bg-slate-800 rounded-xl p-6 shadow-lg mb-8">
                <div className="flex items-center mb-6">
                  <TrendingUp className="w-6 h-6 text-slate-300 mr-3" />
                  <h3 className="text-xl font-semibold text-white">Andamento ELO Generale {selectedYear}</h3>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={eloChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                    <XAxis
                      dataKey="date"
                      stroke="#cbd5e1"
                      tick={{ fill: '#cbd5e1', fontSize: 11 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      stroke="#cbd5e1"
                      tick={{ fill: '#cbd5e1' }}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1e293b',
                        border: '1px solid #475569',
                        borderRadius: '0.5rem',
                        color: '#fff'
                      }}
                    />
                    <Legend wrapperStyle={{ color: '#cbd5e1' }} />
                    {eloPlayerNames.map((name, i) => (
                      <Line
                        key={name}
                        type="monotone"
                        dataKey={name}
                        stroke={ELO_LINE_COLORS[i % ELO_LINE_COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Grafico Attività Mensile */}
            <div className="bg-slate-800 rounded-xl p-6 shadow-lg">
              <div className="flex items-center mb-6">
                <Clock className="w-6 h-6 text-slate-300 mr-3" />
                <h3 className="text-xl font-semibold text-white">Attività Mensile</h3>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={stats.monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                  <XAxis
                    dataKey="month"
                    stroke="#cbd5e1"
                    tick={{ fill: '#cbd5e1' }}
                  />
                  <YAxis
                    stroke="#cbd5e1"
                    tick={{ fill: '#cbd5e1' }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e293b',
                      border: '1px solid #475569',
                      borderRadius: '0.5rem',
                      color: '#fff'
                    }}
                  />
                  <Bar dataKey="partite" fill="#10b981" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Footer CTA */}
            <div className="mt-12 text-center bg-gradient-to-r from-emerald-800 to-cyan-800 rounded-xl p-8">
              <h3 className="text-3xl font-bold text-white mb-2">
                Continua a giocare nel {selectedYear + 1}!
              </h3>
              <p className="text-xl text-slate-200">
                {selectedPlayerId
                  ? `${selectedPlayerName}, non vediamo l'ora di vedere le tue prossime vittorie! 🎲`
                  : 'Aggiungi più partite e raggiungi nuovi record! 🎲'}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default Wrapped
