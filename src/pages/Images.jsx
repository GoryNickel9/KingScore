import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Image as ImageIcon, RefreshCw, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { XMLParser } from 'fast-xml-parser'

// ─── BoardGameGeek (BGG) Image Fetcher ───────────────────────────────────────
const parser = new XMLParser()

const fetchGameImageFromBGG = async (gameName) => {
  try {
    console.log('Fetching image for game:', gameName)

    // Search for the game on BGG
    const searchUrl = `https://boardgamegeek.com/xmlapi2/search?query=${encodeURIComponent(gameName)}&type=boardgame`
    console.log('Search URL:', searchUrl)

    const searchResponse = await fetch(searchUrl)
    const searchXml = await searchResponse.text()
    const searchResult = parser.parse(searchXml)

    console.log('Search result:', searchResult)

    // Check if we found any games
    const items = searchResult?.items?.item
    if (!items) {
      console.log('No games found for:', gameName)
      return null
    }

    // Get the first game ID (most relevant result)
    const gameId = Array.isArray(items) ? items[0].id : items.id
    if (!gameId) {
      console.log('No game ID found for:', gameName)
      return null
    }

    console.log('Game ID:', gameId)

    // Fetch game details including image
    const detailsUrl = `https://boardgamegeek.com/xmlapi2/thing?id=${gameId}&stats=1`
    console.log('Details URL:', detailsUrl)

    const detailsResponse = await fetch(detailsUrl)
    const detailsXml = await detailsResponse.text()
    const detailsResult = parser.parse(detailsXml)

    console.log('Details result:', detailsResult)

    // Extract image URL
    const items2 = detailsResult?.items?.item
    if (!items2) {
      console.log('No details found for game ID:', gameId)
      return null
    }

    const game = Array.isArray(items2) ? items2[0] : items2
    const imageUrl = game?.image || null

    console.log('Image URL for', gameName, ':', imageUrl)

    return imageUrl
  } catch (error) {
    console.error('Error fetching game image from BGG:', error)
    return null
  }
}

const Images = () => {
  const { user } = useAuth()
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [updatingImages, setUpdatingImages] = useState(false)
  const [updateProgress, setUpdateProgress] = useState(0)
  const [updateResults, setUpdateResults] = useState([])

  useEffect(() => {
    fetchGamesWithoutImages()
  }, [user])

  const fetchGamesWithoutImages = async () => {
    try {
      if (!user) {
        console.log('User not authenticated, skipping fetchGamesWithoutImages')
        setLoading(false)
        return
      }

      const { data } = await supabase
        .from('games')
        .select('*')
        .eq('user_id', user.id)
        .order('name')

      // Filter games without images on the client side
      const gamesWithoutImages = (data || []).filter(game => !game.image_url || game.image_url === '')
      setGames(gamesWithoutImages)
    } catch (error) {
      console.error('Error fetching games without images:', error)
      toast.error('Errore durante il caricamento dei giochi')
    } finally {
      setLoading(false)
    }
  }

  const updateAllImages = async () => {
    if (games.length === 0) {
      toast.success('Tutti i giochi hanno già un\'immagine!')
      return
    }

    setUpdatingImages(true)
    setUpdateProgress(0)
    setUpdateResults([])

    try {
      let updated = 0
      let failed = 0
      const results = []

      for (let i = 0; i < games.length; i++) {
        const game = games[i]
        setUpdateProgress(Math.round((i / games.length) * 100))

        try {
          const imageUrl = await fetchGameImageFromBGG(game.name)

          if (imageUrl) {
            console.log('Updating image for game:', game.name, 'with URL:', imageUrl)

            const { error } = await supabase
              .from('games')
              .update({ image_url: imageUrl })
              .eq('id', game.id)

            if (error) {
              console.error('Error updating image for game:', game.name, error)
              failed++
              results.push({
                game: game.name,
                status: 'error',
                message: 'Errore durante l\'aggiornamento'
              })
              toast.error(`Errore nell'aggiornamento dell'immagine per: ${game.name}`)
            } else {
              console.log('Successfully updated image for game:', game.name)
              updated++
              results.push({
                game: game.name,
                status: 'success',
                message: 'Immagine trovata'
              })
              toast.success(`Immagine trovata per: ${game.name}`)
            }
          } else {
            failed++
            results.push({
              game: game.name,
              status: 'warning',
              message: 'Nessuna immagine trovata'
            })
            toast.warning(`Nessuna immagine trovata per: ${game.name}`)
          }
        } catch (error) {
          failed++
          results.push({
            game: game.name,
            status: 'error',
            message: 'Errore durante l\'aggiornamento'
          })
          console.error(`Error updating image for ${game.name}:`, error)
          toast.error(`Errore nell'aggiornamento dell'immagine per: ${game.name}`)
        }
      }

      setUpdateProgress(100)
      setUpdateResults(results)
      toast.success(`Aggiornamento completato! ${updated} immagini aggiornate, ${failed} fallite`)

      // Refresh games list
      await fetchGamesWithoutImages()
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
          <h1 className="text-3xl font-bold text-white">Gestione Immagini</h1>
          <p className="mt-2 text-slate-400">{games.length} giochi senza immagine</p>
        </div>
        <button
          onClick={updateAllImages}
          disabled={updatingImages || games.length === 0}
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
              Aggiorna Tutte le Immagini
            </>
          )}
        </button>
      </div>

      {/* Games List */}
      {games.length === 0 ? (
        <div className="bg-slate-800 rounded-xl p-12 shadow-md text-center">
          <ImageIcon className="w-16 h-16 mx-auto mb-4 text-emerald-500" />
          <h3 className="text-xl font-semibold text-white mb-2">Tutti i giochi hanno un'immagine!</h3>
          <p className="text-slate-400">Non ci sono giochi senza immagine da aggiornare.</p>
        </div>
      ) : (
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <h2 className="text-lg font-semibold text-white mb-4">Giochi senza immagine</h2>
          <div className="space-y-2">
            {games.map((game) => (
              <div key={game.id} className="flex items-center justify-between p-3 bg-slate-700 rounded-lg">
                <span className="text-white">{game.name}</span>
                <span className="text-sm text-slate-400">ID: {game.id.slice(0, 8)}...</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Update Results */}
      {updateResults.length > 0 && (
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <h2 className="text-lg font-semibold text-white mb-4">Risultati dell'aggiornamento</h2>
          <div className="space-y-2">
            {updateResults.map((result, index) => (
              <div key={index} className={`flex items-center justify-between p-3 rounded-lg ${
                result.status === 'success' ? 'bg-emerald-900/30' :
                result.status === 'warning' ? 'bg-yellow-900/30' :
                'bg-red-900/30'
              }`}>
                <div className="flex items-center">
                  {result.status === 'success' && <CheckCircle className="w-5 h-5 text-emerald-500 mr-2" />}
                  {result.status === 'warning' && <AlertCircle className="w-5 h-5 text-yellow-500 mr-2" />}
                  {result.status === 'error' && <XCircle className="w-5 h-5 text-red-500 mr-2" />}
                  <span className="text-white">{result.game}</span>
                </div>
                <span className={`text-sm ${
                  result.status === 'success' ? 'text-emerald-400' :
                  result.status === 'warning' ? 'text-yellow-400' :
                  'text-red-400'
                }`}>
                  {result.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default Images
