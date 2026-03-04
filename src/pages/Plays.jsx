import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Search, Filter, Calendar, MapPin, Clock, Gamepad2, Trophy } from 'lucide-react'

const Plays = () => {
  const { user } = useAuth()
  const [plays, setPlays] = useState([])
  const [filteredPlays, setFilteredPlays] = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({
    search: '',
    game: '',
    player: '',
    source: '',
    month: '',
    year: ''
  })

  useEffect(() => {
    fetchPlays()
  }, [user])

  useEffect(() => {
    applyFilters()
  }, [plays, filters])

  const fetchPlays = async () => {
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

      setPlays(data || [])
    } catch (error) {
      console.error('Error fetching plays:', error)
    } finally {
      setLoading(false)
    }
  }

  const applyFilters = () => {
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

  const getUniqueGames = () => {
    const games = [...new Set(plays.map(p => p.game_id))]
    return games.map(id => plays.find(p => p.game_id === id)?.games).filter(Boolean)
  }

  const getUniqueYears = () => {
    const years = [...new Set(plays.map(p => new Date(p.played_at).getFullYear()))]
    return years.sort((a, b) => b - a)
  }

  const getWinner = (play) => {
    const winner = play.play_scores?.find(s => s.winner)
    return winner?.players?.alias || winner?.players?.name
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
              onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
              className="w-full pl-10 pr-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Game Filter */}
          <select
            value={filters.game}
            onChange={(e) => setFilters(prev => ({ ...prev, game: e.target.value }))}
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
            onChange={(e) => setFilters(prev => ({ ...prev, source: e.target.value }))}
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
              onChange={(e) => setFilters(prev => ({ ...prev, year: e.target.value }))}
              className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">Anno</option>
              {getUniqueYears().map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
            <select
              value={filters.month}
              onChange={(e) => setFilters(prev => ({ ...prev, month: e.target.value }))}
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
          {filteredPlays.map((play) => (
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
                </div>

                {/* Winner Badge */}
                {getWinner(play) && (
                  <div className="flex-shrink-0">
                    <div className="bg-emerald-500/20 px-4 py-2 rounded-lg">
                      <div className="flex items-center text-emerald-500">
                        <Trophy className="w-4 h-4 mr-1" />
                        <span className="text-sm font-medium">{getWinner(play)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Source Badge */}
              <div className="mt-4">
                <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                  play.source === 'online' ? 'bg-blue-500/20 text-blue-500' :
                  play.source === 'offline' ? 'bg-orange-500/20 text-orange-500' :
                  'bg-slate-700 text-slate-300'
                }`}>
                  {play.source === 'online' ? 'Online' : play.source === 'offline' ? 'IRL' : play.source.toUpperCase()}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export default Plays
