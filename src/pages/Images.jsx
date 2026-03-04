import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Image as ImageIcon, Save, CheckCircle, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'

const Images = () => {
  const { user, loading: authLoading } = useAuth()
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [urlInputs, setUrlInputs] = useState({})
  const [saving, setSaving] = useState({})
  const [saved, setSaved] = useState({})

  useEffect(() => {
    if (!authLoading && user) {
      fetchGamesWithoutImages()
    } else if (!authLoading && !user) {
      setLoading(false)
    }
  }, [user, authLoading])

  const fetchGamesWithoutImages = async () => {
    try {
      const { data, error } = await supabase
        .from('games')
        .select('*')
        .order('name', { ascending: true })

      if (error) {
        toast.error('Errore durante il caricamento dei giochi')
        return
      }

      const gamesWithoutImages = (data || []).filter(g => !g.image_url || g.image_url === '')
      setGames(gamesWithoutImages)

      const inputs = {}
      gamesWithoutImages.forEach(g => { inputs[g.id] = '' })
      setUrlInputs(inputs)
    } catch (err) {
      console.error(err)
      toast.error('Errore durante il caricamento dei giochi')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (game) => {
    const url = urlInputs[game.id]?.trim()
    if (!url) {
      toast.error('Inserisci un URL valido')
      return
    }

    setSaving(prev => ({ ...prev, [game.id]: true }))

    try {
      const { error } = await supabase
        .from('games')
        .update({ image_url: url })
        .eq('id', game.id)

      if (error) throw error

      setSaved(prev => ({ ...prev, [game.id]: true }))
      toast.success(`Immagine salvata per: ${game.name}`)

      setTimeout(() => {
        setGames(prev => prev.filter(g => g.id !== game.id))
      }, 1200)
    } catch (err) {
      console.error(err)
      toast.error(`Errore nel salvataggio per: ${game.name}`)
    } finally {
      setSaving(prev => ({ ...prev, [game.id]: false }))
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
      <div>
        <h1 className="text-3xl font-bold text-white">Gestione Immagini</h1>
        <p className="mt-2 text-slate-400">
          {games.length > 0
            ? `${games.length} giochi senza immagine — cerca la copertina su BGG e incolla il link`
            : "Tutti i giochi hanno un'immagine!"}
        </p>
        {games.length > 0 && (
          <a
            href="https://boardgamegeek.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center mt-2 text-sm text-blue-400 hover:text-blue-300 transition"
          >
            <ExternalLink className="w-4 h-4 mr-1" />
            Apri BoardGameGeek
          </a>
        )}
      </div>

      {games.length === 0 ? (
        <div className="bg-slate-800 rounded-xl p-12 shadow-md text-center">
          <CheckCircle className="w-16 h-16 mx-auto mb-4 text-emerald-500" />
          <h3 className="text-xl font-semibold text-white mb-2">Tutto aggiornato!</h3>
          <p className="text-slate-400">Non ci sono giochi senza immagine.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {games.map((game) => {
            const url = urlInputs[game.id] ?? ''
            const isSaving = saving[game.id]
            const isSaved = saved[game.id]

            return (
              <div key={game.id} className="bg-slate-800 rounded-xl p-4 shadow-md">
                <div className="flex items-start gap-4">
                  <div className="w-16 h-20 flex-shrink-0 rounded-lg overflow-hidden bg-slate-700 flex items-center justify-center">
                    {url ? (
                      <img
                        src={url}
                        alt={game.name}
                        className="w-full h-full object-cover"
                        onError={(e) => { e.target.style.display = 'none' }}
                      />
                    ) : (
                      <ImageIcon className="w-6 h-6 text-slate-500" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-white font-semibold truncate">{game.name}</h3>
                      <a
                        href={`https://boardgamegeek.com/search/boardgame?q=${encodeURIComponent(game.name)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 flex-shrink-0 text-xs text-blue-400 hover:text-blue-300 flex items-center"
                      >
                        <ExternalLink className="w-3 h-3 mr-1" />
                        Cerca su BGG
                      </a>
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="url"
                        placeholder="https://cf.geekdo-images.com/..."
                        value={url}
                        onChange={(e) => setUrlInputs(prev => ({ ...prev, [game.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSave(game) }}
                        disabled={isSaving || isSaved}
                        className="flex-1 px-3 py-2 bg-slate-700 text-white text-sm rounded-lg border border-slate-600 focus:border-emerald-500 focus:outline-none placeholder-slate-500 disabled:opacity-50"
                      />
                      <button
                        onClick={() => handleSave(game)}
                        disabled={isSaving || isSaved || !url}
                        className="flex items-center px-3 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-500 transition disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                      >
                        {isSaved ? (
                          <CheckCircle className="w-4 h-4 text-emerald-300" />
                        ) : isSaving ? (
                          <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                          </svg>
                        ) : (
                          <Save className="w-4 h-4" />
                        )}
                      </button>
                    </div>

                    <p className="mt-1 text-xs text-slate-500">
                      Su BGG: trova il gioco → clic destro sull'immagine → "Copia indirizzo immagine"
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default Images
