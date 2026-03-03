import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Save, Plus, Search, X, Gamepad2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { updateELOAfterGame } from '../utils/eloCalculator'

const AddPlay = () => {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [formData, setFormData] = useState({
    gameId: '',
    gameName: '',
    playedAt: new Date().toISOString().split('T')[0],
    location: '',
    durationMinutes: '',
    source: 'offline',
    notes: '',
    players: []
  })

  const [playerScores, setPlayerScores] = useState({})

  const [games, setGames] = useState([])
  const [players, setPlayers] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [showAddGame, setShowAddGame] = useState(false)
  const [newGame, setNewGame] = useState({
    name: '',
    minPlayers: '',
    maxPlayers: '',
    imageUrl: ''
  })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchGames()
    fetchPlayers()
  }, [])

  const fetchGames = async () => {
    try {
      const { data } = await supabase
        .from('games')
        .select('*')
        .order('name')
      setGames(data || [])
    } catch (error) {
      console.error('Error fetching games:', error)
    }
  }

  const fetchPlayers = async () => {
    try {
      const { data } = await supabase
        .from('players')
        .select('*')
        .eq('user_id', user.id)
        .order('name')
      setPlayers(data || [])
    } catch (error) {
      console.error('Error fetching players:', error)
    }
  }

  const handleGameSelect = (game) => {
    setFormData(prev => ({
      ...prev,
      gameId: game.id,
      gameName: game.name
    }))
    setSearchTerm('')
  }

  const handleAddGame = async (e) => {
    e.preventDefault()
    if (!newGame.name) return

    try {
      const { data, error } = await supabase
        .from('games')
        .insert({
          name: newGame.name,
          min_players: newGame.minPlayers ? parseInt(newGame.minPlayers) : null,
          max_players: newGame.maxPlayers ? parseInt(newGame.maxPlayers) : null,
          image_url: newGame.imageUrl || null
        })
        .select()
        .single()

      if (error) throw error

      setFormData(prev => ({
        ...prev,
        gameId: data.id,
        gameName: data.name
      }))

      setGames([...games, data])
      setNewGame({ name: '', minPlayers: '', maxPlayers: '', imageUrl: '' })
      setShowAddGame(false)
      toast.success('Gioco aggiunto con successo!')
    } catch (error) {
      toast.error('Errore durante l\'aggiunta del gioco')
      console.error('Error adding game:', error)
    }
  }

  const handlePlayerToggle = (playerId) => {
    setFormData(prev => ({
      ...prev,
      players: prev.players.includes(playerId)
        ? prev.players.filter(id => id !== playerId)
        : [...prev.players, playerId]
    }))
  }

  const handleAddQuickPlayer = (e) => {
    e.preventDefault()
    const name = e.target.playerName.value.trim()
    if (!name) return

    const newPlayer = {
      id: `temp-${Date.now()}`,
      name,
      isNew: true
    }

    setFormData(prev => ({
      ...prev,
      players: [...prev.players, newPlayer.id]
    }))

    setPlayers([...players, newPlayer])
    e.target.reset()
  }

  const handlePlayerScoreChange = (playerId, field, value) => {
    setPlayerScores(prev => ({
      ...prev,
      [playerId]: {
        ...prev[playerId],
        [field]: value
      }
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formData.gameId || formData.players.length === 0) {
      toast.error('Seleziona un gioco e almeno un giocatore')
      return
    }

    setLoading(true)

    try {
      // Create new players if needed
      const newPlayers = formData.players.filter(id => id.startsWith('temp-'))
      const createdPlayers = []

      for (const tempId of newPlayers) {
        const player = players.find(p => p.id === tempId)
        if (player) {
          const { data, error } = await supabase
            .from('players')
            .insert({
              user_id: user.id,
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
          user_id: user.id,
          game_id: formData.gameId,
          played_at: formData.playedAt,
          location: formData.location || null,
          duration_minutes: formData.durationMinutes ? parseInt(formData.durationMinutes) : null,
          source: formData.source,
          notes: formData.notes || null
        })
        .select()
        .single()

      if (playError) throw playError

      // Create play scores
      // Calcola le posizioni prima di salvare
      const playersWithScores = mappedPlayers.map(playerId => {
        const playerData = playerScores[playerId] || { score: null, winner: false }
        return {
          playerId,
          score: playerData.score ? parseFloat(playerData.score) : null,
          winner: playerData.winner || false
        }
      })

      // Calcola le posizioni
      // I vincitori hanno posizione 1
      // Gli altri sono ordinati per punteggio decrescente (se disponibile) o per ordine di inserimento
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
      const playersWithPositions = [...winners, ...nonWinners].map((player, index) => {
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
          await updateELOAfterGame(supabase, play.game_id, playersData, user.id)
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
                      onChange={(e) => setSearchTerm(e.target.value)}
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
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Nome *</label>
                  <input
                    type="text"
                    value={newGame.name}
                    onChange={(e) => setNewGame(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-4 py-2 bg-slate-600 border border-slate-500 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">Min Giocatori</label>
                    <input
                      type="number"
                      value={newGame.minPlayers}
                      onChange={(e) => setNewGame(prev => ({ ...prev, minPlayers: e.target.value }))}
                      className="w-full px-4 py-2 bg-slate-600 border border-slate-500 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">Max Giocatori</label>
                    <input
                      type="number"
                      value={newGame.maxPlayers}
                      onChange={(e) => setNewGame(prev => ({ ...prev, maxPlayers: e.target.value }))}
                      className="w-full px-4 py-2 bg-slate-600 border border-slate-500 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">URL Immagine</label>
                  <input
                    type="url"
                    value={newGame.imageUrl}
                    onChange={(e) => setNewGame(prev => ({ ...prev, imageUrl: e.target.value }))}
                    className="w-full px-4 py-2 bg-slate-600 border border-slate-500 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={handleAddGame}
                    className="flex-1 px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition"
                  >
                    Salva Gioco
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddGame(false)}
                    className="flex-1 px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-500 transition"
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
              onChange={(e) => setFormData(prev => ({ ...prev, playedAt: e.target.value }))}
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
              onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
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
              onChange={(e) => setFormData(prev => ({ ...prev, durationMinutes: e.target.value }))}
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
                  onChange={(e) => setFormData(prev => ({ ...prev, source: e.target.value }))}
                  className="w-4 h-4 text-emerald-500 focus:ring-emerald-500"
                />
                <span className="text-white">{source.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Players */}
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Giocatori *
          </label>

          <div className="space-y-3">
            {players.map((player) => (
              <div key={player.id} className="p-4 bg-slate-700 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.players.includes(player.id)}
                      onChange={() => handlePlayerToggle(player.id)}
                      className="w-4 h-4 text-emerald-500 focus:ring-emerald-500"
                    />
                    <span className="text-white font-medium">{player.alias || player.name}</span>
                    {player.alias && (
                      <span className="text-xs text-slate-400 ml-2">({player.name})</span>
                    )}
                    {player.is_me && (
                      <span className="px-2 py-1 bg-emerald-500/20 text-emerald-500 text-xs rounded-full">
                        Sei tu
                      </span>
                    )}
                  </label>
                </div>

                {formData.players.includes(player.id) && (
                  <div className="grid grid-cols-2 gap-4 ml-7">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Punteggio</label>
                      <input
                        type="number"
                        step="0.1"
                        placeholder="Punteggio"
                        value={playerScores[player.id]?.score || ''}
                        onChange={(e) => handlePlayerScoreChange(player.id, 'score', e.target.value)}
                        className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="flex items-center space-x-2 cursor-pointer mt-5">
                        <input
                          type="checkbox"
                          checked={playerScores[player.id]?.winner || false}
                          onChange={(e) => handlePlayerScoreChange(player.id, 'winner', e.target.checked)}
                          className="w-4 h-4 text-emerald-500 focus:ring-emerald-500"
                        />
                        <span className="text-white text-sm">Vincitore</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

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
            onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
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
