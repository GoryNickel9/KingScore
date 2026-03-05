import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Save, ArrowLeft, Gamepad2, Plus, X } from 'lucide-react'
import toast from 'react-hot-toast'

interface DbGame {
  id: string
  name: string
}

interface DbPlayer {
  id: string
  name: string
  alias?: string | null
}

interface EditPlayerRow {
  id: string | null
  playerId: string
  playerName: string
  score: string | number
  winner: boolean
  position: number | null
}

interface EditFormData {
  gameId: string
  gameName: string
  playedAt: string
  location: string
  durationMinutes: string
  source: string
  notes: string
  players: EditPlayerRow[]
}

const EditPlay = () => {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [formData, setFormData] = useState<EditFormData>({
    gameId: '',
    gameName: '',
    playedAt: '',
    location: '',
    durationMinutes: '',
    source: 'offline',
    notes: '',
    players: []
  })

  const [games, setGames] = useState<DbGame[]>([])
  const [players, setPlayers] = useState<DbPlayer[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [saving, setSaving] = useState<boolean>(false)

  useEffect(() => {
    fetchPlay()
    fetchGames()
    fetchPlayers()
  }, [id])

  const fetchPlay = async (): Promise<void> => {
    try {
      const { data, error } = await supabase
        .from('plays')
        .select(`
          *,
          games(*),
          play_scores(
            *,
            players(*)
          )
        `)
        .eq('id', id)
        .eq('user_id', user!.id)
        .single()

      if (error) throw error

      if (data) {
        setFormData({
          gameId: data.game_id || '',
          gameName: data.games?.name || '',
          playedAt: data.played_at ? data.played_at.split('T')[0] : new Date().toISOString().split('T')[0],
          location: data.location || '',
          durationMinutes: data.duration_minutes || '',
          source: data.source || 'offline',
          notes: data.notes || '',
          players: data.play_scores?.map((score: { id: string; player_id: string; players?: DbPlayer; score: number | null; winner: boolean; position: number | null }) => ({
            id: score.id,
            playerId: score.player_id,
            playerName: score.players?.alias || score.players?.name || '',
            score: score.score !== null ? score.score : '',
            winner: score.winner || false,
            position: score.position || null
          })) || []
        })
      }
    } catch (error) {
      console.error('Error fetching play:', error)
      toast.error('Errore durante il caricamento della partita')
      navigate('/plays')
    } finally {
      setLoading(false)
    }
  }

  const fetchGames = async (): Promise<void> => {
    try {
      const { data } = await supabase
        .from('games')
        .select('*')
        .order('name')
      setGames((data ?? []) as DbGame[])
    } catch (error) {
      console.error('Error fetching games:', error)
    }
  }

  const fetchPlayers = async (): Promise<void> => {
    try {
      const { data } = await supabase
        .from('players')
        .select('*')
        .eq('user_id', user!.id)
        .order('name')
      setPlayers((data ?? []) as DbPlayer[])
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
  }

  const handlePlayerAdd = (): void => {
    setFormData(prev => ({
      ...prev,
      players: [
        ...prev.players,
        {
          id: null,
          playerId: '',
          playerName: '',
          score: '',
          winner: false,
          position: null
        }
      ]
    }))
  }

  const handlePlayerRemove = (index: number): void => {
    setFormData(prev => ({
      ...prev,
      players: prev.players.filter((_, i) => i !== index)
    }))
  }

  const handlePlayerChange = (index: number, field: keyof EditPlayerRow, value: string | number | boolean | null): void => {
    setFormData(prev => ({
      ...prev,
      players: prev.players.map((player, i) =>
        i === index ? { ...player, [field]: value } : player
      )
    }))
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()

    if (!formData.gameId) {
      toast.error('Seleziona un gioco')
      return
    }

    if (formData.players.length < 2) {
      toast.error('Aggiungi almeno 2 giocatori')
      return
    }

    try {
      setSaving(true)

      // Aggiorna la partita
      const { error: playError } = await supabase
        .from('plays')
        .update({
          game_id: formData.gameId,
          played_at: formData.playedAt,
          location: formData.location || null,
          duration_minutes: formData.durationMinutes ? parseInt(formData.durationMinutes as string) : null,
          source: formData.source,
          notes: formData.notes || null
        })
        .eq('id', id)
        .eq('user_id', user!.id)

      if (playError) throw playError

      // Aggiorna i punteggi
      // Prima elimina tutti i punteggi esistenti
      const { error: deleteError } = await supabase
        .from('play_scores')
        .delete()
        .eq('play_id', id)

      if (deleteError) throw deleteError

      // Poi inserisci i nuovi punteggi
      const scoresToInsert = formData.players.map((player, index) => ({
        play_id: id,
        player_id: player.playerId,
        score: player.score !== '' ? parseInt(player.score as string) : null,
        winner: player.winner,
        position: player.position || index + 1
      }))

      const { error: insertError } = await supabase
        .from('play_scores')
        .insert(scoresToInsert)

      if (insertError) throw insertError

      toast.success('Partita aggiornata con successo!')
      navigate(`/plays/${id}`)
    } catch (error) {
      console.error('Error updating play:', error)
      toast.error("Errore durante l'aggiornamento della partita")
    } finally {
      setSaving(false)
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link
            to={`/plays/${id}`}
            className="p-2 hover:bg-slate-800 rounded-lg transition"
          >
            <ArrowLeft className="w-5 h-5 text-slate-400" />
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-white">Modifica Partita</h1>
            <p className="text-slate-400 mt-1">Aggiorna i dettagli della partita</p>
          </div>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Game Selection */}
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <h2 className="text-xl font-bold text-white mb-4">Gioco</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Gioco</label>
              <select
                value={formData.gameId}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                  const game = games.find(g => g.id === e.target.value)
                  if (game) handleGameSelect(game)
                }}
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                required
              >
                <option value="">Seleziona un gioco</option>
                {games.map(game => (
                  <option key={game.id} value={game.id}>{game.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Data</label>
              <input
                type="date"
                value={formData.playedAt}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData(prev => ({ ...prev, playedAt: e.target.value }))}
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                required
              />
            </div>
          </div>
        </div>

        {/* Play Details */}
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <h2 className="text-xl font-bold text-white mb-4">Dettagli Partita</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Luogo</label>
              <input
                type="text"
                value={formData.location}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="Es. Casa, Parco..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Durata (minuti)</label>
              <input
                type="number"
                value={formData.durationMinutes}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData(prev => ({ ...prev, durationMinutes: e.target.value }))}
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="Es. 60"
                min="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Fonte</label>
              <select
                value={formData.source}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFormData(prev => ({ ...prev, source: e.target.value }))}
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="offline">IRL</option>
                <option value="online">Online</option>
              </select>
            </div>
          </div>
          <div className="mt-4">
            <label className="block text-sm font-medium text-slate-300 mb-2">Note</label>
            <textarea
              value={formData.notes}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              rows={3}
              placeholder="Aggiungi note sulla partita..."
            />
          </div>
        </div>

        {/* Players */}
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-white">Giocatori</h2>
            <button
              type="button"
              onClick={handlePlayerAdd}
              className="flex items-center px-3 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition"
            >
              <Plus className="w-4 h-4 mr-2" />
              Aggiungi Giocatore
            </button>
          </div>

          <div className="space-y-3">
            {formData.players.map((player, index) => (
              <div key={index} className="bg-slate-700 rounded-lg p-4">
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-lg font-semibold text-white">Giocatore {index + 1}</h3>
                  <button
                    type="button"
                    onClick={() => handlePlayerRemove(index)}
                    className="p-1 hover:bg-slate-600 rounded transition"
                  >
                    <X className="w-5 h-5 text-red-500" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-slate-300 mb-2">Giocatore</label>
                    <select
                      value={player.playerId}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                        const selectedPlayer = players.find(p => p.id === e.target.value)
                        handlePlayerChange(index, 'playerId', e.target.value)
                        handlePlayerChange(index, 'playerName', selectedPlayer?.alias || selectedPlayer?.name || '')
                      }}
                      className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      required
                    >
                      <option value="">Seleziona giocatore</option>
                      {players.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.alias || p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Punteggio</label>
                    <input
                      type="number"
                      value={player.score as string}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => handlePlayerChange(index, 'score', e.target.value)}
                      className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      placeholder="Punteggio"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Vincitore</label>
                    <button
                      type="button"
                      onClick={() => handlePlayerChange(index, 'winner', !player.winner)}
                      className={`w-full px-3 py-2 rounded-lg font-medium transition ${
                        player.winner
                          ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                          : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                      }`}
                    >
                      {player.winner ? 'Vincitore' : 'Non vincitore'}
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {formData.players.length === 0 && (
              <div className="text-center py-8 text-slate-400">
                <Gamepad2 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>Nessun giocatore aggiunto</p>
                <p className="text-sm mt-1">Clicca su "Aggiungi Giocatore" per iniziare</p>
              </div>
            )}
          </div>
        </div>

        {/* Submit Button */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center px-6 py-3 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:bg-emerald-800 disabled:cursor-not-allowed transition"
          >
            <Save className="w-5 h-5 mr-2" />
            {saving ? 'Salvataggio...' : 'Salva Modifiche'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default EditPlay
