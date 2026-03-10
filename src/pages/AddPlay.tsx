import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Save, Plus, Search, X, Gamepad2, Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import { updateELOAfterGame } from '../utils/eloCalculator'
import { uploadGameImage, compressImage } from '../utils/imageUpload'
import { XMLParser } from 'fast-xml-parser'

interface DbGame {
  id: string
  name: string
  image_url?: string | null
}

interface DbPlayer {
  id: string
  name: string
  alias?: string | null
  is_me?: boolean
}

interface TempPlayer {
  id: string
  name: string
  isNew: boolean
}

interface PlayerScore {
  score?: string
  winner?: boolean
}

interface AddPlayFormData {
  gameId: string
  gameName: string
  playedAt: string
  location: string
  durationMinutes: string
  source: string
  notes: string
  players: string[]
  isCooperative: boolean
  teamWon: boolean | null
}

interface NewGameForm {
  name: string
  minPlayers: string
  maxPlayers: string
  imageUrl: string
}

interface BGGResult {
  id: number
  name: string
  thumbnail: string | null
  yearPublished: number | null
}

const AddPlay = () => {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [formData, setFormData] = useState<AddPlayFormData>({
    gameId: '',
    gameName: '',
    playedAt: new Date().toISOString().split('T')[0],
    location: '',
    durationMinutes: '',
    source: 'offline',
    notes: '',
    players: [],
    isCooperative: false,
    teamWon: null
  })

  const [playerScores, setPlayerScores] = useState<Record<string, PlayerScore>>({})

  const [games, setGames] = useState<DbGame[]>([])
  const [players, setPlayers] = useState<(DbPlayer | TempPlayer)[]>([])
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [showAddGame, setShowAddGame] = useState<boolean>(false)
  const [newGame, setNewGame] = useState<NewGameForm>({
    name: '',
    minPlayers: '',
    maxPlayers: '',
    imageUrl: ''
  })
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(false)
  const [bggQuery, setBggQuery] = useState<string>('')
  const [bggResults, setBggResults] = useState<BGGResult[]>([])
  const [bggLoading, setBggLoading] = useState<boolean>(false)

  useEffect(() => {
    fetchGames()
    fetchPlayers()
  }, [])

  const fetchGames = async (): Promise<void> => {
    try {
      const { data } = await supabase
        .from('games')
        .select('*')
        .order('name')
      setGames((data || []) as DbGame[])
    } catch (error) {
      console.error('Error fetching games:', error)
    }
  }

  const fetchPlayers = async (): Promise<void> => {
    if (!user) return
    try {
      const { data } = await supabase
        .from('players')
        .select('*')
        .eq('user_id', user.id)
        .order('name')
      setPlayers((data || []) as DbPlayer[])
    } catch (error) {
      console.error('Error fetching players:', error)
    }
  }

  const handleGameSelect = (game: DbGame): void => {
    setFormData(prev => ({
      ...prev,
      gameId: game.id,
      gameName: game.name
    }))
    setSearchTerm('')
  }

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    if (!file) return

    // Valida il file
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
    if (!allowedTypes.includes(file.type)) {
      toast.error('Tipo di file non supportato. Usa: JPG, PNG, WebP o GIF')
      return
    }

    const maxSize = 5 * 1024 * 1024 // 5MB
    if (file.size > maxSize) {
      toast.error('Il file è troppo grande. La dimensione massima è 5MB')
      return
    }

    // Crea anteprima
    const reader = new FileReader()
    reader.onloadend = () => {
      setImagePreview(reader.result as string)
    }
    reader.readAsDataURL(file)
    setImageFile(file)
  }

  const handleRemoveImage = (): void => {
    setImageFile(null)
    setImagePreview(null)
    setNewGame(prev => ({ ...prev, imageUrl: '' }))
  }

  const searchBGG = async (query: string): Promise<void> => {
    if (!query.trim()) return

    setBggLoading(true)
    try {
      const parser = new XMLParser()
      
      // Step 1: Search for games
      const searchUrl = `https://boardgamegeek.com/xmlapi2/search?query=${encodeURIComponent(query)}&type=boardgame`
      const searchResponse = await fetch(searchUrl)
      const searchXml = await searchResponse.text()
      const searchResult = parser.parse(searchXml)

      const items = searchResult?.items?.item
      if (!items) {
        setBggResults([])
        toast.error('Nessun risultato trovato su BGG')
        return
      }

      // Get first 5 results
      const gameIds = (Array.isArray(items) ? items.slice(0, 5) : [items]).map(item => item.id)
      
      if (gameIds.length === 0) {
        setBggResults([])
        toast.error('Nessun risultato trovato su BGG')
        return
      }

      // Step 2: Fetch details for all games
      const detailsUrl = `https://boardgamegeek.com/xmlapi2/thing?id=${gameIds.join(',')}`
      const detailsResponse = await fetch(detailsUrl)
      const detailsXml = await detailsResponse.text()
      const detailsResult = parser.parse(detailsXml)

      const detailItems = detailsResult?.items?.item
      if (!detailItems) {
        setBggResults([])
        return
      }

      // Parse results
      const games = (Array.isArray(detailItems) ? detailItems : [detailItems]).map(game => {
        const name = Array.isArray(game.name) 
          ? game.name.find((n: any) => n['@_type'] === 'primary')?.['@_value'] || game.name[0]?.['@_value']
          : game.name?.['@_value'] || 'Unknown'
        
        return {
          id: parseInt(game['@_id']),
          name,
          thumbnail: game.thumbnail || null,
          yearPublished: game.yearpublished?.['@_value'] ? parseInt(game.yearpublished['@_value']) : null
        }
      })

      setBggResults(games)
    } catch (error) {
      console.error('Error searching BGG:', error)
      toast.error('Errore durante la ricerca su BGG')
      setBggResults([])
    } finally {
      setBggLoading(false)
    }
  }

  const handleBggSelect = (result: BGGResult): void => {
    setNewGame(prev => ({
      ...prev,
      name: result.name,
      imageUrl: result.thumbnail || ''
    }))
    setBggResults([])
    setBggQuery('')
  }

  const handleAddGame = async (e: React.MouseEvent<HTMLButtonElement>): Promise<void> => {
    e.preventDefault()
    if (!newGame.name) return

    setUploadingImage(true)

    try {
      let imageUrl: string | null = newGame.imageUrl || null

      // Se è stato selezionato un file, caricalo su Supabase Storage
      if (imageFile) {
        try {
          // Comprimi l'immagine prima dell'upload
          const compressedImage = await compressImage(imageFile, 800, 0.8)

          // Carica l'immagine
          const { publicUrl } = await uploadGameImage(compressedImage as unknown as File, user!.id)
          imageUrl = publicUrl
          toast.success('Immagine caricata con successo!')
        } catch (uploadError) {
          console.error('Errore durante l\'upload dell\'immagine:', uploadError)
          toast.error('Errore durante il caricamento dell\'immagine. Il gioco verrà salvato senza immagine.')
        }
      }

      const { data, error } = await supabase
        .from('games')
        .insert({
          name: newGame.name,
          min_players: newGame.minPlayers ? parseInt(newGame.minPlayers) : null,
          max_players: newGame.maxPlayers ? parseInt(newGame.maxPlayers) : null,
          image_url: imageUrl
        })
        .select()
        .single()

      if (error) throw error

      setFormData(prev => ({
        ...prev,
        gameId: data.id,
        gameName: data.name
      }))

      setGames([...games, data as DbGame])
      setNewGame({ name: '', minPlayers: '', maxPlayers: '', imageUrl: '' })
      setImageFile(null)
      setImagePreview(null)
      setShowAddGame(false)
      toast.success('Gioco aggiunto con successo!')
    } catch (error) {
      toast.error('Errore durante l\'aggiunta del gioco')
      console.error('Error adding game:', error)
    } finally {
      setUploadingImage(false)
    }
  }

  const handlePlayerToggle = (playerId: string): void => {
    setFormData(prev => ({
      ...prev,
      players: prev.players.includes(playerId)
        ? prev.players.filter(id => id !== playerId)
        : [...prev.players, playerId]
    }))
  }

  const handleAddQuickPlayer = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    const form = e.currentTarget
    const input = form.elements.namedItem('playerName') as HTMLInputElement
    const name = input.value.trim()
    if (!name) return

    const newPlayer: TempPlayer = {
      id: `temp-${Date.now()}`,
      name,
      isNew: true
    }

    setFormData(prev => ({
      ...prev,
      players: [...prev.players, newPlayer.id]
    }))

    setPlayers([...players, newPlayer])
    form.reset()
  }

  const handlePlayerScoreChange = (playerId: string, field: keyof PlayerScore, value: string | boolean): void => {
    setPlayerScores(prev => ({
      ...prev,
      [playerId]: {
        ...prev[playerId],
        [field]: value
      }
    }))
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    if (!formData.gameId || formData.players.length === 0) {
      toast.error('Seleziona un gioco e almeno un giocatore')
      return
    }

    setLoading(true)

    try {
      // Create new players if needed
      const newPlayers = formData.players.filter(id => id.startsWith('temp-'))
      const createdPlayers: { tempId: string; newId: string }[] = []

      for (const tempId of newPlayers) {
        const player = players.find(p => p.id === tempId) as TempPlayer | undefined
        if (player) {
          const { data, error } = await supabase
            .from('players')
            .insert({
              user_id: user!.id,
              name: player.name,
              is_me: false
            })
            .select()
            .single()

          if (error) throw error
          createdPlayers.push({ tempId, newId: data.id })
        }
      }

      // Map temp IDs to real IDs
      const mappedPlayers = formData.players.map(id => {
        const mapping = createdPlayers.find(m => m.tempId === id)
        return mapping ? mapping.newId : id
      })

      // Create play
      const { data: play, error: playError } = await supabase
        .from('plays')
        .insert({
          user_id: user!.id,
          game_id: formData.gameId,
          played_at: formData.playedAt,
          location: formData.location || null,
          duration_minutes: formData.durationMinutes ? parseInt(formData.durationMinutes) : null,
          source: formData.source,
          notes: formData.notes || null,
          is_cooperative: formData.isCooperative,
          team_won: formData.isCooperative ? formData.teamWon : null
        })
        .select()
        .single()

      if (playError) throw playError

      // Create play scores
      // Calcola le posizioni prima di salvare
      const playersWithScores = mappedPlayers.map(playerId => {
        const playerData = playerScores[playerId] || { score: undefined, winner: false }
        
        // Se è cooperativo e il risultato del team è definito, sovrascrive il winner individuale
        const winner = formData.isCooperative && formData.teamWon !== null 
          ? formData.teamWon 
          : playerData.winner || false
        
        return {
          playerId,
          score: playerData.score ? parseFloat(playerData.score) : null,
          winner
        }
      })

      // Calcola le posizioni
      // Se cooperativo: position = 1 se vinto, 2 se perso
      // Se competitivo: i vincitori hanno posizione 1, gli altri ordinati per punteggio
      let playersWithPositions
      if (formData.isCooperative && formData.teamWon !== null) {
        playersWithPositions = playersWithScores.map(player => ({
          ...player,
          position: formData.teamWon ? 1 : 2
        }))
      } else {
        const winners = playersWithScores.filter(p => p.winner)
        const nonWinners = playersWithScores.filter(p => !p.winner)

        // Ordina i non vincitori per punteggio decrescente (se disponibile)
        nonWinners.sort((a, b) => {
          if (a.score !== null && b.score !== null) {
            return b.score - a.score
          }
          if (a.score !== null) return -1
          if (b.score !== null) return 1
          return 0
        })

        // Assegna le posizioni
        let currentPosition = 1
        playersWithPositions = [...winners, ...nonWinners].map((player, index) => {
          // Se è il primo non vincitore, inizia dalla posizione 2 (o più se ci sono più vincitori)
          if (!player.winner && index === winners.length) {
            currentPosition = winners.length + 1
          } else if (!player.winner && index > winners.length) {
            currentPosition++
          }
          return {
            ...player,
            position: player.winner ? 1 : currentPosition
          }
        })
      }

      const playScoresData = playersWithPositions.map(player => ({
        play_id: play.id,
        player_id: player.playerId,
        score: player.score,
        winner: player.winner,
        position: player.position
      }))

      const { error: scoresError } = await supabase
        .from('play_scores')
        .insert(playScoresData)

      if (scoresError) throw scoresError

      // Aggiorna l'ELO per questa partita
      try {
        if (mappedPlayers.length >= 2) {
          // Prepara i dati dei giocatori per il calcolo ELO
          const playersData = playersWithPositions.map(player => {
            return {
              playerId: player.playerId,
              currentRating: 1000, // Verrà aggiornato da updateELOAfterGame
              gamesPlayed: 0, // Verrà aggiornato da updateELOAfterGame
              winner: player.winner,
              position: player.position
            }
          })

          // Aggiorna gli ELO (incluso l'ELO Generale)
          await updateELOAfterGame(supabase, play.game_id, playersData, user!.id)
        }
      } catch (eloError) {
        // Non bloccare il salvataggio se l'aggiornamento ELO fallisce
        console.error('Errore nell\'aggiornamento ELO:', eloError)
      }

      toast.success('Partita aggiunta con successo!')
      navigate('/plays')
    } catch (error) {
      toast.error('Errore durante il salvataggio della partita')
      console.error('Error saving play:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredGames = games.filter(game =>
    game.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white">Aggiungi Nuova Partita</h1>
        <p className="mt-2 text-slate-400">Registra i dettagli della tua partita</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Game Selection */}
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Gioco *
          </label>

          {/* Local Search */}
          {!formData.gameId && (
            <div className="relative">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
                <input
                  type="text"
                  placeholder="Cerca un gioco..."
                  value={searchTerm}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {searchTerm && filteredGames.length > 0 && (
                <div className="absolute z-10 w-full mt-2 bg-slate-700 border border-slate-600 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {filteredGames.map((game) => (
                    <div
                      key={game.id}
                      onClick={() => handleGameSelect(game)}
                      className="flex items-center p-3 hover:bg-slate-600 cursor-pointer transition"
                    >
                      {game.image_url ? (
                        <img src={game.image_url} alt={game.name} className="w-10 h-10 object-cover rounded" />
                      ) : (
                        <div className="w-10 h-10 bg-slate-600 rounded flex items-center justify-center">
                          <Gamepad2 className="w-5 h-5 text-slate-400" />
                        </div>
                      )}
                      <span className="ml-3 text-white">{game.name}</span>
                    </div>
                  ))}
                </div>
              )}

              {searchTerm && filteredGames.length === 0 && (
                <div className="absolute z-10 w-full mt-2 bg-slate-700 border border-slate-600 rounded-lg shadow-lg p-4">
                  <p className="text-slate-400 mb-3">Nessun gioco trovato</p>
                  <button
                    type="button"
                    onClick={() => setShowAddGame(true)}
                    className="w-full flex items-center justify-center px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Aggiungi gioco manualmente
                  </button>
                </div>
              )}
            </div>
          )}

          {formData.gameId && (
            <div className="flex items-center justify-between p-4 bg-slate-700 rounded-lg">
              <div className="flex items-center">
                <Gamepad2 className="w-6 h-6 text-emerald-500 mr-3" />
                <span className="text-white font-medium">{formData.gameName}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setFormData(prev => ({ ...prev, gameId: '', gameName: '' }))
                }}
                className="text-slate-400 hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          )}

          {showAddGame && (
            <div className="mt-4 p-4 bg-slate-700 rounded-lg">
              <h3 className="text-lg font-semibold text-white mb-4">Aggiungi Nuovo Gioco</h3>
              <div className="space-y-4">
                {/* BGG Search Section */}
                <div className="p-4 bg-slate-600 rounded-lg border border-slate-500">
                  <label className="block text-sm text-slate-300 mb-2">Cerca su BoardGameGeek</label>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      placeholder="Cerca su BoardGameGeek..."
                      value={bggQuery}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBggQuery(e.target.value)}
                      onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          searchBGG(bggQuery)
                        }
                      }}
                      className="flex-1 px-4 py-2 bg-slate-700 border border-slate-500 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={() => searchBGG(bggQuery)}
                      disabled={bggLoading || !bggQuery.trim()}
                      className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                    >
                      {bggLoading ? (
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                      ) : (
                        <>
                          <Search className="w-4 h-4 mr-2" />
                          Cerca
                        </>
                      )}
                    </button>
                  </div>

                  {/* BGG Results */}
                  {bggResults.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {bggResults.map((result) => (
                        <div
                          key={result.id}
                          onClick={() => handleBggSelect(result)}
                          className="flex items-center p-3 bg-slate-700 rounded-lg hover:bg-slate-600 cursor-pointer transition"
                        >
                          {result.thumbnail ? (
                            <img
                              src={result.thumbnail}
                              alt={result.name}
                              className="w-10 h-10 object-cover rounded"
                            />
                          ) : (
                            <div className="w-10 h-10 bg-slate-600 rounded flex items-center justify-center">
                              <Gamepad2 className="w-5 h-5 text-slate-400" />
                            </div>
                          )}
                          <div className="ml-3">
                            <span className="text-white font-medium">{result.name}</span>
                            {result.yearPublished && (
                              <span className="text-slate-400 text-sm ml-2">({result.yearPublished})</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm text-slate-300 mb-1">Nome *</label>
                  <input
                    type="text"
                    value={newGame.name}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewGame(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-4 py-2 bg-slate-600 border border-slate-500 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">Min Giocatori</label>
                    <input
                      type="number"
                      value={newGame.minPlayers}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewGame(prev => ({ ...prev, minPlayers: e.target.value }))}
                      className="w-full px-4 py-2 bg-slate-600 border border-slate-500 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">Max Giocatori</label>
                    <input
                      type="number"
                      value={newGame.maxPlayers}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewGame(prev => ({ ...prev, maxPlayers: e.target.value }))}
                      className="w-full px-4 py-2 bg-slate-600 border border-slate-500 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Immagine</label>

                  {/* Anteprima immagine */}
                  {(imagePreview || newGame.imageUrl) && (
                    <div className="mb-3 relative">
                      <img
                        src={imagePreview || newGame.imageUrl}
                        alt="Anteprima"
                        className="w-full h-48 object-cover rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={handleRemoveImage}
                        className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {/* Upload file */}
                  <div className="mb-3">
                    <label className="flex items-center justify-center w-full px-4 py-3 bg-slate-600 border-2 border-dashed border-slate-500 rounded-lg cursor-pointer hover:border-emerald-500 transition">
                      <div className="flex items-center space-x-2">
                        <Upload className="w-5 h-5 text-slate-400" />
                        <span className="text-slate-400">
                          {imageFile ? imageFile.name : 'Carica un\'immagine'}
                        </span>
                      </div>
                      <input
                        type="file"
                        accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
                        onChange={handleImageSelect}
                        className="hidden"
                      />
                    </label>
                    <p className="text-xs text-slate-500 mt-1">Formati supportati: JPG, PNG, WebP, GIF (max 5MB)</p>
                  </div>

                  {/* Oppure inserisci URL */}
                  <div className="flex items-center space-x-2">
                    <span className="text-slate-500 text-sm">oppure</span>
                    <input
                      type="url"
                      value={newGame.imageUrl}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewGame(prev => ({ ...prev, imageUrl: e.target.value }))}
                      placeholder="https://esempio.com/immagine.jpg"
                      className="flex-1 px-4 py-2 bg-slate-600 border border-slate-500 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>
                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={handleAddGame}
                    disabled={uploadingImage}
                    className="flex-1 px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                  >
                    {uploadingImage ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        Caricamento...
                      </>
                    ) : (
                      'Salva Gioco'
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddGame(false)}
                    disabled={uploadingImage}
                    className="flex-1 px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Annulla
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Date, Location, Duration */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-800 rounded-xl p-6 shadow-md">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Data *
            </label>
            <input
              type="date"
              value={formData.playedAt}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData(prev => ({ ...prev, playedAt: e.target.value }))}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              required
            />
          </div>

          <div className="bg-slate-800 rounded-xl p-6 shadow-md">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Luogo
            </label>
            <input
              type="text"
              value={formData.location}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData(prev => ({ ...prev, location: e.target.value }))}
              placeholder="es. Casa mia, Online"
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="bg-slate-800 rounded-xl p-6 shadow-md">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Durata (minuti)
            </label>
            <input
              type="number"
              value={formData.durationMinutes}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData(prev => ({ ...prev, durationMinutes: e.target.value }))}
              placeholder="es. 60"
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* Source */}
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Fonte
          </label>
          <div className="flex space-x-4">
            {[
              { value: 'online', label: 'Online' },
              { value: 'offline', label: 'IRL' }
            ].map((source) => (
              <label key={source.value} className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="source"
                  value={source.value}
                  checked={formData.source === source.value}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData(prev => ({ ...prev, source: e.target.value }))}
                  className="w-4 h-4 text-emerald-500 focus:ring-emerald-500"
                />
                <span className="text-white">{source.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Game Mode */}
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <label className="block text-sm font-medium text-slate-300 mb-4">
            Modalità di Gioco
          </label>
          
          <div className="flex items-center justify-between p-4 bg-slate-700 rounded-lg">
            <div>
              <p className="text-white font-medium">Partita Cooperativa</p>
              <p className="text-sm text-slate-400">Tutti i giocatori vincono o perdono insieme</p>
            </div>
            <button
              type="button"
              onClick={() => setFormData(prev => ({ ...prev, isCooperative: !prev.isCooperative, teamWon: null }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                formData.isCooperative ? 'bg-emerald-500' : 'bg-slate-600'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                formData.isCooperative ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>

          {formData.isCooperative && (
            <div className="mt-4 p-4 bg-slate-700 rounded-lg">
              <label className="block text-sm font-medium text-slate-300 mb-3">
                Il team ha vinto?
              </label>
              <div className="flex space-x-3">
                <button
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, teamWon: true }))}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition ${
                    formData.teamWon === true
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                  }`}
                >
                  Sì
                </button>
                <button
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, teamWon: false }))}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition ${
                    formData.teamWon === false
                      ? 'bg-red-500 text-white'
                      : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                  }`}
                >
                  No
                </button>
                <button
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, teamWon: null }))}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition ${
                    formData.teamWon === null
                      ? 'bg-slate-500 text-white'
                      : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                  }`}
                >
                  Non specificato
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Players */}
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Giocatori *
          </label>

          <div className="space-y-3">
            {players.map((player) => {
              const dbPlayer = player as DbPlayer
              return (
                <div key={player.id} className="p-4 bg-slate-700 rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <label className="flex items-center space-x-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.players.includes(player.id)}
                        onChange={() => handlePlayerToggle(player.id)}
                        className="w-4 h-4 text-emerald-500 focus:ring-emerald-500"
                      />
                      <span className="text-white font-medium">{dbPlayer.alias || player.name}</span>
                      {dbPlayer.alias && (
                        <span className="text-xs text-slate-400 ml-2">({player.name})</span>
                      )}
                      {dbPlayer.is_me && (
                        <span className="px-2 py-1 bg-emerald-500/20 text-emerald-500 text-xs rounded-full">
                          Sei tu
                        </span>
                      )}
                    </label>
                  </div>

                  {formData.players.includes(player.id) && (
                    <div className={`gap-4 ml-7 ${
                      formData.isCooperative ? 'grid grid-cols-1' : 'grid grid-cols-2'
                    }`}>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Punteggio</label>
                        <input
                          type="number"
                          step="0.1"
                          placeholder="Punteggio"
                          value={playerScores[player.id]?.score || ''}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => handlePlayerScoreChange(player.id, 'score', e.target.value)}
                          className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                      {!formData.isCooperative && (
                        <div>
                          <label className="flex items-center space-x-2 cursor-pointer mt-5">
                            <input
                              type="checkbox"
                              checked={playerScores[player.id]?.winner || false}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handlePlayerScoreChange(player.id, 'winner', e.target.checked)}
                              className="w-4 h-4 text-emerald-500 focus:ring-emerald-500"
                            />
                            <span className="text-white text-sm">Vincitore / Pareggio</span>
                          </label>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Indicatore Vincitori */}
          {!formData.isCooperative && formData.players.length > 0 && (() => {
            const winnersCount = formData.players.filter(playerId => playerScores[playerId]?.winner).length
            if (winnersCount === 0) return null
            if (winnersCount === 1) {
              return (
                <div className="mt-4 text-sm text-slate-300">
                  1 vincitore selezionato
                </div>
              )
            }
            return (
              <div className="mt-4 px-3 py-2 bg-amber-500/20 text-amber-400 text-sm rounded-lg inline-block">
                {winnersCount} vincitori selezionati — Pareggio!
              </div>
            )
          })()}

          <form onSubmit={handleAddQuickPlayer} className="mt-4 flex space-x-2">
            <input
              name="playerName"
              type="text"
              placeholder="Aggiungi giocatore al volo..."
              className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition"
            >
              <Plus className="w-5 h-5" />
            </button>
          </form>
        </div>

        {/* Notes */}
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Note
          </label>
          <textarea
            value={formData.notes}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
            rows={4}
            placeholder="Aggiungi note sulla partita..."
            className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
          />
        </div>

        {/* Submit Button */}
        <div className="flex justify-end space-x-4">
          <button
            type="button"
            onClick={() => navigate('/plays')}
            className="px-6 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition"
          >
            Annulla
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex items-center px-6 py-3 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <svg className="animate-spin h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <Save className="w-5 h-5 mr-2" />
            )}
            Salva Partita
          </button>
        </div>
      </form>
    </div>
  )
}

export default AddPlay
