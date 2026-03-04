import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Search, Gamepad2, TrendingUp, Calendar, RefreshCw, Image as ImageIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import { XMLParser } from 'fast-xml-parser'

// ─── BoardGameGeek (BGG) Image Fetcher ───────────────────────────────────────
const parser = new XMLParser()

const fetchGameImageFromBGG = async (gameName) => {
  try {
    // Search for the game on BGG
    const searchUrl = `https://boardgamegeek.com/xmlapi2/search?query=${encodeURIComponent(gameName)}&type=boardgame`
    const searchResponse = await fetch(searchUrl)
    const searchXml = await searchResponse.text()
    const searchResult = parser.parse(searchXml)

    // Check if we found any games
    const items = searchResult?.items?.item
    if (!items) return null

    // Get the first game ID (most relevant result)
    const gameId = Array.isArray(items) ? items[0].id : items.id
    if (!gameId) return null

    // Fetch game details including image
    const detailsUrl = `https://boardgamegeek.com/xmlapi2/thing?id=${gameId}&stats=1`
    const detailsResponse = await fetch(detailsUrl)
    const detailsXml = await detailsResponse.text()
    const detailsResult = parser.parse(detailsXml)

    // Extract image URL
    const items2 = detailsResult?.items?.item
    if (!items2) return null

    const game = Array.isArray(items2) ? items2[0] : items2
    return game?.image || null
  } catch (error) {
    console.error('Error fetching game image from BGG:', error)
    return null
  }
}

const Games = () => {
  const { user } = useAuth()
  const [games, setGames] = useState([])
  const [filteredGames, setFilteredGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [updatingImages, setUpdatingImages] = useState(false)
  const [updateProgress, setUpdateProgress] = useState(0)

  useEffect(() => {
    fetchGames()
  }, [])

  useEffect(() => {
    applyFilters()
  }, [games, searchTerm, sortBy])

  const fetchGames = async () => {
    try {
      // Fetch all games with play counts
      const { data: playsData } = await supabase
        .from('plays')
        .select('game_id, played_at')
        .eq('user_id', user.id)

      const gameStats = {}
      if (playsData) {
        playsData.forEach(play => {
          if (!gameStats[play.game_id]) {
            gameStats[play.game_id] = {
              count: 0,
              lastPlayed: null
            }
          }
          gameStats[play.game_id].count++
          if (!gameStats[play.game_id].lastPlayed || new Date(play.played_at) > new Date(gameStats[play.game_id].lastPlayed)) {
            gameStats[play.game_id].lastPlayed = play.played_at
          }
        })
      }

      const gameIds = Object.keys(gameStats)
      let gamesQuery = supabase.from('games').select('*')

      if (gameIds.length > 0) {
        gamesQuery = gamesQuery.in('id', gameIds)
      } else {
        // If no plays, return empty
        setGames([])
        setFilteredGames([])
        setLoading(false)
        return
      }

      const { data: gamesData } = await gamesQuery

      if (gamesData) {
        const gamesWithStats = gamesData.map(game => ({
          ...game,
          playCount: gameStats[game.id]?.count || 0,
          lastPlayed: gameStats[game.id]?.lastPlayed || null
        }))

        setGames(gamesWithStats)
      }
    } catch (error) {
      console.error('Error fetching games:', error)
    } finally {
      setLoading(false)
    }
  }

  const applyFilters = () => {
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
          return new Date(b.lastPlayed) - new Date(a.lastPlayed)
        })
        break
      default:
        break
    }

    setFilteredGames(result)
  }

  const updateGameImages = async () => {
    setUpdatingImages(true)
    setUpdateProgress(0)

    try {
      // Get all games without images
      const { data: gamesWithoutImages } = await supabase
        .from('games')
        .select('*')
        .is('image_url', null)
        .eq('user_id', user.id)

      if (!gamesWithoutImages || gamesWithoutImages.length === 0) {
        toast.success('Tutti i giochi hanno già un\'immagine!')
        setUpdatingImages(false)
        return
      }

      let updated = 0
      let failed = 0

      for (let i = 0; i < gamesWithoutImages.length; i++) {
        const game = gamesWithoutImages[i]
        setUpdateProgress(Math.round((i / gamesWithoutImages.length) * 100))

        try {
          const imageUrl = await fetchGameImageFromBGG(game.name)

          if (imageUrl) {
            await supabase
              .from('games')
              .update({ image_url: imageUrl })
              .eq('id', game.id)

            updated++
            toast.success(`Immagine trovata per: ${game.name}`)
          } else {
            failed++
            toast.warning(`Nessuna immagine trovata per: ${game.name}`)
          }
        } catch (error) {
          failed++
          console.error(`Error updating image for ${game.name}:`, error)
          toast.error(`Errore nell'aggiornamento dell'immagine per: ${game.name}`)
        }
      }

      setUpdateProgress(100)
      toast.success(`Aggiornamento completato! ${updated} immagini aggiornate, ${failed} fallite`)

      // Refresh games list
      await fetchGames()
    } catch (error) {
      console.error('Error updating game images:', error)
      toast.error('Errore durante l\'aggiornamento delle immagini')
    } finally {
      setUpdatingImages(false)
      setUpdateProgress(0)
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Libreria Giochi</h1>
          <p className="mt-2 text-slate-400">{filteredGames.length} giochi nella tua collezione</p>
        </div>
        <button
          onClick={updateGameImages}
          disabled={updatingImages}
          className="flex items-center px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {updatingImages ? (
            <>
              <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
              Aggiornamento in corso... {updateProgress}%
            </>
          ) : (
            <>
              <ImageIcon className="w-5 h-5 mr-2" />
              Aggiorna Immagini
            </>
          )}
        </button>
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
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredGames.map((game) => (
            <Link
              key={game.id}
              to={`/games/${game.id}`}
              className="bg-slate-800 rounded-xl overflow-hidden shadow-md hover:shadow-lg transition cursor-pointer group"
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
          ))}
        </div>
      )}
    </div>
  )
}

export default Games
