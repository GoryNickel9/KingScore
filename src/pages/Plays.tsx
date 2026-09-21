import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Search, Filter, Calendar, MapPin, Clock, Gamepad2, Trophy, Users, StickyNote } from 'lucide-react'
import { Spinner } from '../components/Spinner'
import { Pagination } from '../components/Pagination'
import type { DbGame, DbPlayWithScores } from '../types/rows'

interface Filters {
  search: string
  game: string
  player: string
  source: string
  month: string
  year: string
}

const Plays = () => {
  const { user } = useAuth()
  const [plays, setPlays] = useState<DbPlayWithScores[]>([])
  const [filteredPlays, setFilteredPlays] = useState<DbPlayWithScores[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [filters, setFilters] = useState<Filters>({
    search: '',
    game: '',
    player: '',
    source: '',
    month: '',
    year: ''
  })

  const PLAYS_PER_PAGE = 20

  useEffect(() => {
    void fetchPlays()
  }, [user])

  useEffect(() => {
    applyFilters()
  }, [plays, filters])

  // Reset pagina quando cambiano i filtri
  useEffect(() => {
    setCurrentPage(1)
  }, [filters])

  const fetchPlays = async (): Promise<void> => {
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
        .order('played_at', { ascending: false })

      setPlays(data ?? [])
    } catch (error) {
      console.error('Error fetching plays:', error)
    } finally {
      setLoading(false)
    }
  }

  const applyFilters = (): void => {
    let result = [...plays]

    if (filters.search) {
      const search = filters.search.toLowerCase()
      result = result.filter(play =>
        play.games?.name.toLowerCase().includes(search) ||
        (play.notes && play.notes.toLowerCase().includes(search))
      )
    }

    if (filters.game) {
      result = result.filter(play => play.game_id === filters.game)
    }

    if (filters.source) {
      result = result.filter(play => play.source === filters.source)
    }

    if (filters.month) {
      result = result.filter(play => {
        const date = new Date(play.played_at)
        return date.getMonth() + 1 === parseInt(filters.month)
      })
    }

    if (filters.year) {
      result = result.filter(play => {
        const date = new Date(play.played_at)
        return date.getFullYear() === parseInt(filters.year)
      })
    }

    setFilteredPlays(result)
  }

  const getUniqueGames = (): DbGame[] => {
    const games = [...new Set(plays.map(p => p.game_id))]
    return games.map(id => plays.find(p => p.game_id === id)?.games).filter((g): g is DbGame => Boolean(g))
  }

  const getUniqueYears = (): number[] => {
    const years = [...new Set(plays.map(p => new Date(p.played_at).getFullYear()))]
    return years.sort((a, b) => b - a)
  }

  const getWinners = (play: DbPlayWithScores): string => {
    const winners = play.play_scores?.filter(s => s.winner) || []
    if (winners.length === 0) return '—'
    const names = winners.map(s => s.players?.alias || s.players?.name || 'Unknown')
    if (names.length === 1) return names[0]
    if (names.length === 2) return `${names[0]} e ${names[1]}`
    return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
  }

  // Calcola paginazione
  const totalPages = Math.ceil(filteredPlays.length / PLAYS_PER_PAGE)
  const paginatedPlays = filteredPlays.slice(
    (currentPage - 1) * PLAYS_PER_PAGE,
    currentPage * PLAYS_PER_PAGE
  )
  const startItem = filteredPlays.length === 0 ? 0 : (currentPage - 1) * PLAYS_PER_PAGE + 1
  const endItem = Math.min(currentPage * PLAYS_PER_PAGE, filteredPlays.length)

  if (loading) {
    return <Spinner className="h-64" />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Storico Partite</h1>
          <p className="mt-2 text-slate-400">{filteredPlays.length} partite registrate</p>
        </div>
        <Link
          to="/plays/new"
          className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition flex items-center"
        >
          <Gamepad2 className="w-5 h-5 mr-2" />
          Aggiungi Partita
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-slate-800 rounded-xl p-6 shadow-md">
        <div className="flex items-center mb-4">
          <Filter className="w-5 h-5 text-slate-400 mr-2" />
          <h2 className="text-lg font-semibold text-white">Filtri</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Cerca gioco o note..."
              value={filters.search}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilters(prev => ({ ...prev, search: e.target.value }))}
              className="w-full pl-10 pr-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Game Filter */}
          <select
            value={filters.game}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilters(prev => ({ ...prev, game: e.target.value }))}
            className="px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="">Tutti i giochi</option>
            {getUniqueGames().map(game => (
              <option key={game.id} value={game.id}>{game.name}</option>
            ))}
          </select>

          {/* Source Filter */}
          <select
            value={filters.source}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilters(prev => ({ ...prev, source: e.target.value }))}
            className="px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="">Tutte le fonti</option>
            <option value="online">Online</option>
            <option value="offline">IRL</option>
          </select>

          {/* Date Filters */}
          <div className="flex space-x-2">
            <select
              value={filters.year}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilters(prev => ({ ...prev, year: e.target.value }))}
              className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">Anno</option>
              {getUniqueYears().map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
            <select
              value={filters.month}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilters(prev => ({ ...prev, month: e.target.value }))}
              className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">Mese</option>
              {['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'].map((month, index) => (
                <option key={month} value={index + 1}>{month}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Clear Filters */}
        {(filters.search || filters.game || filters.source || filters.month || filters.year) && (
          <button
            onClick={() => setFilters({ search: '', game: '', player: '', source: '', month: '', year: '' })}
            className="mt-4 text-sm text-emerald-500 hover:text-emerald-400 transition"
          >
            Rimuovi filtri
          </button>
        )}
      </div>

      {/* Plays List */}
      {filteredPlays.length === 0 ? (
        <div className="bg-slate-800 rounded-xl p-12 shadow-md text-center">
          <Gamepad2 className="w-16 h-16 mx-auto mb-4 text-slate-600" />
          <h3 className="text-xl font-semibold text-white mb-2">Nessuna partita trovata</h3>
          <p className="text-slate-400 mb-6">
            {plays.length === 0 ? 'Inizia aggiungendo la tua prima partita!' : 'Prova a cambiare i filtri'}
          </p>
          {plays.length === 0 && (
            <Link
              to="/plays/new"
              className="inline-flex items-center px-6 py-3 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition"
            >
              <Gamepad2 className="w-5 h-5 mr-2" />
              Aggiungi Prima Partita
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Pagination info */}
          <div className="text-sm text-slate-400 text-center">
            Pagina {currentPage} di {totalPages} — Mostrando {startItem}-{endItem} di {filteredPlays.length}
          </div>

          {paginatedPlays.map((play) => (
            <Link
              key={play.id}
              to={`/plays/${play.id}`}
              className="block bg-slate-800 rounded-xl p-6 shadow-md hover:bg-slate-750 transition cursor-pointer"
            >
              <div className="flex items-start space-x-4">
                {/* Game Image */}
                {play.games?.image_url ? (
                  <img
                    src={play.games.image_url}
                    alt={play.games.name}
                    className="w-20 h-20 object-cover rounded-lg flex-shrink-0"
                  />
                ) : (
                  <div className="w-20 h-20 bg-slate-700 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Gamepad2 className="w-10 h-10 text-slate-500" />
                  </div>
                )}

                {/* Play Info */}
                <div className="flex-1 min-w-0">
                  <h3 className="text-xl font-semibold text-white mb-2">
                    {play.games?.name || 'Gioco sconosciuto'}
                  </h3>

                  <div className="flex flex-wrap gap-4 text-sm text-slate-400 mb-3">
                    <div className="flex items-center">
                      <Calendar className="w-4 h-4 mr-1" />
                      {new Date(play.played_at).toLocaleDateString('it-IT')}
                    </div>
                    {play.location && (
                      <div className="flex items-center">
                        <MapPin className="w-4 h-4 mr-1" />
                        {play.location}
                      </div>
                    )}
                    {play.duration_minutes && (
                      <div className="flex items-center">
                        <Clock className="w-4 h-4 mr-1" />
                        {play.duration_minutes} min
                      </div>
                    )}
                  </div>

                  {/* Scores */}
                  {play.play_scores && play.play_scores.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {play.play_scores.slice(0, 4).map((score) => (
                        <span
                          key={score.id}
                          className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                            score.winner
                              ? 'bg-emerald-500/20 text-emerald-500'
                              : 'bg-slate-700 text-slate-300'
                          }`}
                        >
                          {score.winner && <Trophy className="w-3 h-3 mr-1" />}
                          {score.players?.alias || score.players?.name}
                          {score.score !== null && `: ${score.score}`}
                        </span>
                      ))}
                      {play.play_scores.length > 4 && (
                        <span className="text-xs text-slate-500">
                          +{play.play_scores.length - 4} altri
                        </span>
                      )}
                    </div>
                  )}

                  {/* Notes */}
                  {play.notes && (
                    <div className="mt-3 flex items-start text-sm text-slate-300">
                      <StickyNote className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0 text-slate-500" />
                      <span className="italic">{play.notes}</span>
                    </div>
                  )}
                </div>

                {/* Winner Badge */}
                {(() => {
                  const winners = play.play_scores?.filter(s => s.winner) || []
                  if (winners.length === 0) return null
                  
                  if (winners.length === 1) {
                    return (
                      <div className="flex-shrink-0">
                        <div className="bg-emerald-500/20 px-4 py-2 rounded-lg">
                          <div className="flex items-center text-emerald-500">
                            <Trophy className="w-4 h-4 mr-1" />
                            <span className="text-sm font-medium">{getWinners(play)}</span>
                          </div>
                        </div>
                      </div>
                    )
                  }
                  
                  return (
                    <div className="flex-shrink-0">
                      <div className="bg-amber-500/20 px-4 py-2 rounded-lg">
                        <div className="flex flex-col">
                          <span className="inline-flex items-center text-amber-400 text-xs font-semibold mb-1">
                            <Trophy className="w-3 h-3 mr-1" />
                            Pareggio
                          </span>
                          <span className="text-sm font-medium text-amber-400">                            {getWinners(play)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })()}
              </div>

              {/* Source Badge */}
              <div className="mt-4 flex items-center space-x-2">
                <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                  play.source === 'online' ? 'bg-blue-500/20 text-blue-500' :
                  play.source === 'offline' ? 'bg-orange-500/20 text-orange-500' :
                  'bg-slate-700 text-slate-300'
                }`}>
                  {play.source === 'online' ? 'Online' : play.source === 'offline' ? 'IRL' : play.source?.toUpperCase()}
                </span>
                
                {play.is_cooperative && (
                  <>
                    <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-blue-500/20 text-blue-500">
                      <Users className="w-3 h-3 mr-1" />
                      Coop
                    </span>
                    {play.team_won === true && (
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-emerald-500/20 text-emerald-500">
                        Team ha vinto
                      </span>
                    )}
                    {play.team_won === false && (
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-500/20 text-red-500">
                        Team ha perso
                      </span>
                    )}
                  </>
                )}
              </div>
            </Link>
          ))}

          {/* Pagination */}
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            className="mt-6"
          />
        </div>
      )}
    </div>
  )
}

export default Plays
