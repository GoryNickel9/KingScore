import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Search, Gamepad2, TrendingUp, Calendar, Plus, X, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { getErrorMessage } from '../utils/errors'
import { listGames } from '../services/games'
import { Spinner } from '../components/Spinner'
import { Pagination } from '../components/Pagination'
import type { DbGame } from '../types/rows'

interface DbGameWithStats extends DbGame {
  playCount: number
  lastPlayed: string | null
}

interface NewGameForm {
  name: string
  min_players: string
  max_players: string
  image_url: string
}

const Games = () => {
  const { user } = useAuth()
  const [games, setGames] = useState<DbGameWithStats[]>([])
  const [filteredGames, setFilteredGames] = useState<DbGameWithStats[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [sortBy, setSortBy] = useState<string>('name')
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false)
  const [newGame, setNewGame] = useState<NewGameForm>({
    name: '',
    min_players: '',
    max_players: '',
    image_url: ''
  })

  const GAMES_PER_PAGE = 24

  useEffect(() => {
    void fetchGames()
  }, [])

  useEffect(() => {
    applyFilters()
  }, [games, searchTerm, sortBy])

  // Reset pagina quando cambiano ricerca o ordinamento
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, sortBy])

  const fetchGames = async (): Promise<void> => {
    try {
      // Check if user is authenticated
      if (!user?.id) {
        setGames([])
        setFilteredGames([])
        setLoading(false)
        return
      }

      // La libreria giochi è condivisa (decisione TD-006): la tabella non ha
      // user_id e la lettura è aperta a tutti gli autenticati per RLS
      const gamesData = await listGames(supabase)

      if (!gamesData) {
        setGames([])
        setFilteredGames([])
        setLoading(false)
        return
      }

      // Fetch play counts for user's games
      const { data: playsData } = await supabase
        .from('plays')
        .select('game_id, played_at')
        .eq('user_id', user.id)

      const gameStats: Record<string, { count: number; lastPlayed: string | null }> = {}
      if (playsData) {
        ;(playsData as { game_id: string; played_at: string }[]).forEach(play => {
          if (!gameStats[play.game_id]) {
            gameStats[play.game_id] = {
              count: 0,
              lastPlayed: null
            }
          }
          gameStats[play.game_id].count++
          if (!gameStats[play.game_id].lastPlayed || new Date(play.played_at) > new Date(gameStats[play.game_id].lastPlayed!)) {
            gameStats[play.game_id].lastPlayed = play.played_at
          }
        })
      }

      const gamesWithStats: DbGameWithStats[] = gamesData.map(game => ({
        ...game,
        playCount: gameStats[game.id]?.count || 0,
        lastPlayed: gameStats[game.id]?.lastPlayed || null
      }))

      setGames(gamesWithStats)
    } catch (error) {
      console.error('Error fetching games:', error)
    } finally {
      setLoading(false)
    }
  }

  const applyFilters = (): void => {
    let result = [...games]

    if (searchTerm) {
      result = result.filter(game =>
        game.name.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    switch (sortBy) {
      case 'name':
        result.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'mostPlayed':
        result.sort((a, b) => b.playCount - a.playCount)
        break
      case 'lastPlayed':
        result.sort((a, b) => {
          if (!a.lastPlayed) return 1
          if (!b.lastPlayed) return -1
          return new Date(b.lastPlayed).getTime() - new Date(a.lastPlayed).getTime()
        })
        break
      default:
        break
    }

    setFilteredGames(result)
  }

  const handleCreateGame = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()

    // Check if user is authenticated
    if (!user?.id) {
      toast.error('Devi essere autenticato per aggiungere un gioco')
      return
    }

    try {
      const { error } = await supabase
        .from('games')
        .insert({
          name: newGame.name,
          min_players: newGame.min_players ? parseInt(newGame.min_players) : null,
          max_players: newGame.max_players ? parseInt(newGame.max_players) : null,
          image_url: newGame.image_url || null
        })

      if (error) throw error

      toast.success('Gioco aggiunto con successo!')
      setIsModalOpen(false)
      setNewGame({
        name: '',
        min_players: '',
        max_players: '',
        image_url: ''
      })
      await fetchGames()
    } catch (error) {
      console.error('Error creating game:', error)
      toast.error('Errore durante la creazione del gioco')
    }
  }

  const handleDeleteGame = async (gameId: string, gameName: string): Promise<void> => {
    // Check if user is authenticated
    if (!user?.id) {
      toast.error('Devi essere autenticato per eliminare un gioco')
      return
    }

    console.log('Tentativo di eliminare gioco:', { gameId, gameName, userId: user.id })

    // Check if there are plays associated with this game
    const { data: playsData, error: playsError } = await supabase
      .from('plays')
      .select('id')
      .eq('game_id', gameId)

    console.log('Partite associate:', { playsData, playsError })

    if (playsError) {
      console.error('Error checking plays:', playsError)
      toast.error('Errore durante il controllo delle partite')
      return
    }

    const hasPlays = playsData && playsData.length > 0
    const playCount = hasPlays ? playsData.length : 0

    // Create confirmation message
    let confirmMessage = `Sei sicuro di voler eliminare "${gameName}"?`
    if (hasPlays) {
      confirmMessage += `\n\nAttenzione: Questo gioco ha ${playCount} partite associate che verranno eliminate.`
    }

    if (!window.confirm(confirmMessage)) {
      return
    }

    try {
      // Delete associated plays first (if any)
      if (hasPlays) {
        console.log('Eliminazione partite associate...')
        const { data: deletedPlays, error: deletePlaysError } = await supabase
          .from('plays')
          .delete()
          .eq('game_id', gameId)
          .select()

        console.log('Risultato eliminazione partite:', { deletedPlays, deletePlaysError })

        if (deletePlaysError) {
          throw deletePlaysError
        }
      }

      // Delete the game
      console.log('Eliminazione gioco...')
      const { data: deletedGame, error: deleteGameError } = await supabase
        .from('games')
        .delete()
        .eq('id', gameId)
        .select()

      console.log('Risultato eliminazione gioco:', { deletedGame, deleteGameError })

      if (deleteGameError) {
        throw deleteGameError
      }

      if (!deletedGame || deletedGame.length === 0) {
        console.warn('Nessun gioco eliminato. Possibile problema con RLS o ID non valido.')
        toast.error('Errore: Il gioco non è stato eliminato. Verifica i permessi.')
        return
      }

      toast.success(`Gioco "${gameName}" eliminato con successo!${hasPlays ? ` (${playCount} partite eliminate)` : ''}`)

      // Refresh games list
      await fetchGames()
    } catch (error) {
      console.error('Error deleting game:', error)
      toast.error(`Errore durante l'eliminazione del gioco: ${getErrorMessage(error)}`)
    }
  }

  // Calcola paginazione
  const totalPages = Math.ceil(filteredGames.length / GAMES_PER_PAGE)
  const paginatedGames = filteredGames.slice(
    (currentPage - 1) * GAMES_PER_PAGE,
    currentPage * GAMES_PER_PAGE
  )
  const startItem = filteredGames.length === 0 ? 0 : (currentPage - 1) * GAMES_PER_PAGE + 1
  const endItem = Math.min(currentPage * GAMES_PER_PAGE, filteredGames.length)

  if (loading) {
    return <Spinner className="h-64" />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Libreria Giochi</h1>
          <p className="mt-2 text-slate-400">{filteredGames.length} giochi nella tua collezione</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition"
          >
            <Plus className="w-5 h-5 mr-2" />
            Aggiungi Gioco
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-slate-800 rounded-xl p-6 shadow-md">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Cerca un gioco..."
              value={searchTerm}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSortBy(e.target.value)}
            className="px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="name">Ordina per nome</option>
            <option value="mostPlayed">Più giocato</option>
            <option value="lastPlayed">Ultimo giocato</option>
          </select>
        </div>
      </div>

      {/* Games Grid */}
      {filteredGames.length === 0 ? (
        <div className="bg-slate-800 rounded-xl p-12 shadow-md text-center">
          <Gamepad2 className="w-16 h-16 mx-auto mb-4 text-slate-600" />
          <h3 className="text-xl font-semibold text-white mb-2">Nessun gioco trovato</h3>
          <p className="text-slate-400">
            {games.length === 0
              ? 'Inizia aggiungendo la tua prima partita!'
              : 'Prova a cambiare i filtri'}
          </p>
        </div>
      ) : (
        <>
          {/* Pagination info */}
          <div className="text-sm text-slate-400 text-center mb-4">
            Pagina {currentPage} di {totalPages} — Mostrando {startItem}-{endItem} di {filteredGames.length}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {paginatedGames.map((game) => (
            <div
              key={game.id}
              className="bg-slate-800 rounded-xl overflow-hidden shadow-md hover:shadow-lg transition group relative"
            >
              {/* Delete Button */}
              {user && (
                <button
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation()
                    void handleDeleteGame(game.id, game.name)
                  }}
                  className="absolute top-2 right-2 z-10 p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition opacity-0 group-hover:opacity-100 shadow-lg"
                  title="Elimina gioco"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}

              <Link
                to={`/games/${game.id}`}
                className="block"
              >
                {/* Game Image */}
                <div className="relative aspect-[4/3] bg-slate-700">
                  {game.image_url ? (
                    <img
                      src={game.image_url}
                      alt={game.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Gamepad2 className="w-16 h-16 text-slate-500" />
                    </div>
                  )}
                </div>

                {/* Game Info */}
                <div className="p-4">
                  <h3 className="text-lg font-semibold text-white mb-2 line-clamp-2">
                    {game.name}
                  </h3>

                  {/* Player Count */}
                  {game.min_players && game.max_players && (
                    <p className="text-sm text-slate-400 mb-3">
                      {game.min_players}-{game.max_players} giocatori
                    </p>
                  )}

                  {/* Stats */}
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center text-emerald-500">
                      <TrendingUp className="w-4 h-4 mr-1" />
                      <span className="font-medium">{game.playCount}</span>
                      <span className="text-slate-400 ml-1">partite</span>
                    </div>

                    {game.lastPlayed && (
                      <div className="flex items-center text-slate-400">
                        <Calendar className="w-4 h-4 mr-1" />
                        <span>
                          {new Date(game.lastPlayed).toLocaleDateString('it-IT', {
                            day: 'numeric',
                            month: 'short'
                          })}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            </div>
          ))}
          </div>

          {/* Pagination */}
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            className="mt-6"
          />
        </>
      )}

      {/* Modal per aggiungere nuovo gioco */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-slate-700">
              <h2 className="text-xl font-bold text-white">Aggiungi Nuovo Gioco</h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white transition"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleCreateGame} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Nome del gioco *
                </label>
                <input
                  type="text"
                  required
                  value={newGame.name}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewGame({ ...newGame, name: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Es. Catan"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Min. Giocatori
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={newGame.min_players}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewGame({ ...newGame, min_players: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="1"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Max. Giocatori
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={newGame.max_players}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewGame({ ...newGame, max_players: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="4"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  URL Immagine (opzionale)
                </label>
                <input
                  type="url"
                  value={newGame.image_url}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewGame({ ...newGame, image_url: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="https://..."
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-3 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition"
                >
                  Aggiungi Gioco
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default Games
