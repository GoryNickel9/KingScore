import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Plus, Edit, Trash2, Users, Trophy, TrendingUp, User, AlertTriangle, Upload, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { uploadPlayerImage, deletePlayerImage, getPlayerImageUrl } from '../utils/imageUpload'

const Players = () => {
  const { user } = useAuth()
  const [players, setPlayers] = useState([])
  const [playerStats, setPlayerStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  const [formData, setFormData] = useState({ name: '', alias: '', avatar_url: '' })
  const [avatarFile, setAvatarFile] = useState(null)
  const [avatarPreview, setAvatarPreview] = useState(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  useEffect(() => {
    fetchPlayers()
  }, [])

  const fetchPlayers = async () => {
    try {
      if (!user) {
        setLoading(false)
        return
      }

      const { data } = await supabase
        .from('players')
        .select('*')
        .eq('user_id', user.id)
        .order('name')

      if (data) {
        setPlayers(data)

        // Fetch stats for each player
        const stats = {}
        for (const player of data) {
          const { data: playsData } = await supabase
            .from('play_scores')
            .select('winner, plays(*)')
            .eq('player_id', player.id)

          if (playsData) {
            const totalPlays = playsData.length
            const wins = playsData.filter(s => s.winner).length
            stats[player.id] = {
              totalPlays,
              winRate: totalPlays > 0 ? Math.round((wins / totalPlays) * 100) : 0
            }
          }
        }

        setPlayerStats(stats)
      }
    } catch (error) {
      console.error('Error fetching players:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!formData.name.trim()) return

    try {
      let avatarUrl = null

      // Carica l'immagine del profilo se presente
      if (avatarFile) {
        setUploadingAvatar(true)
        try {
          const { publicUrl, path } = await uploadPlayerImage(avatarFile, user.id)
          avatarUrl = path
        } catch (error) {
          toast.error('Errore durante il caricamento dell\'immagine')
          console.error('Error uploading avatar:', error)
          setUploadingAvatar(false)
          return
        }
        setUploadingAvatar(false)
      }

      const { error } = await supabase
        .from('players')
        .insert({
          user_id: user.id,
          name: formData.name.trim(),
          alias: formData.alias.trim() || null,
          avatar_url: avatarUrl,
          is_me: false
        })

      if (error) throw error

      toast.success('Giocatore aggiunto con successo!')
      setShowAddModal(false)
      setFormData({ name: '', alias: '', avatar_url: '' })
      setAvatarFile(null)
      setAvatarPreview(null)
      fetchPlayers()
    } catch (error) {
      toast.error('Errore durante l\'aggiunta del giocatore')
      console.error('Error adding player:', error)
    }
  }

  const handleEdit = async (e) => {
    e.preventDefault()
    if (!formData.name.trim()) return

    try {
      let avatarUrl = selectedPlayer.avatar_url

      // Carica la nuova immagine del profilo se presente
      if (avatarFile) {
        setUploadingAvatar(true)
        try {
          // Elimina l'immagine precedente se esiste
          if (selectedPlayer.avatar_url) {
            await deletePlayerImage(selectedPlayer.avatar_url)
          }

          const { publicUrl, path } = await uploadPlayerImage(avatarFile, user.id)
          avatarUrl = path
        } catch (error) {
          toast.error('Errore durante il caricamento dell\'immagine')
          console.error('Error uploading avatar:', error)
          setUploadingAvatar(false)
          return
        }
        setUploadingAvatar(false)
      }

      const { error } = await supabase
        .from('players')
        .update({
          name: formData.name.trim(),
          alias: formData.alias.trim() || null,
          avatar_url: avatarUrl
        })
        .eq('id', selectedPlayer.id)

      if (error) throw error

      toast.success('Giocatore aggiornato con successo!')
      setShowEditModal(false)
      setSelectedPlayer(null)
      setFormData({ name: '', alias: '', avatar_url: '' })
      setAvatarFile(null)
      setAvatarPreview(null)
      fetchPlayers()
    } catch (error) {
      toast.error('Errore durante l\'aggiornamento del giocatore')
      console.error('Error updating player:', error)
    }
  }

  const handleDelete = async () => {
    try {
      const { error } = await supabase
        .from('players')
        .delete()
        .eq('id', selectedPlayer.id)

      if (error) throw error

      toast.success('Giocatore eliminato con successo!')
      setShowDeleteModal(false)
      setSelectedPlayer(null)
      fetchPlayers()
    } catch (error) {
      toast.error('Errore durante l\'eliminazione del giocatore')
      console.error('Error deleting player:', error)
    }
  }

  const getAvatarColor = (name) => {
    const colors = [
      'bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-500',
      'bg-teal-500', 'bg-blue-500', 'bg-indigo-500', 'bg-purple-500',
      'bg-pink-500'
    ]
    const index = name.charCodeAt(0) % colors.length
    return colors[index]
  }

  const getInitials = (name) => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const handleAvatarChange = (e) => {
    const file = e.target.files[0]
    if (file) {
      // Controlla la dimensione del file (max 2MB)
      const maxSize = 2 * 1024 * 1024
      if (file.size > maxSize) {
        toast.error('Il file è troppo grande. La dimensione massima è 2MB')
        return
      }

      // Controlla il tipo MIME
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
      if (!allowedTypes.includes(file.type)) {
        toast.error('Tipo di file non supportato. Usa: JPG, PNG, WebP o GIF')
        return
      }

      setAvatarFile(file)

      // Crea un'anteprima dell'immagine
      const reader = new FileReader()
      reader.onloadend = () => {
        setAvatarPreview(reader.result)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleRemoveAvatar = () => {
    setAvatarFile(null)
    setAvatarPreview(null)
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

  // Nascondi i giocatori agli utenti non registrati
  if (!user) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Gestione Giocatori</h1>
          <p className="mt-2 text-slate-400">Accedi per vedere i giocatori</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-12 shadow-md text-center">
          <Users className="w-16 h-16 mx-auto mb-4 text-slate-600" />
          <h3 className="text-xl font-semibold text-white mb-2">Accesso Richiesto</h3>
          <p className="text-slate-400 mb-6">Devi accedere per vedere e gestire i giocatori.</p>
          <a
            href="/login"
            className="inline-flex items-center px-6 py-3 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition"
          >
            Accedi
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Gestione Giocatori</h1>
          <p className="mt-2 text-slate-400">{players.length} giocatori registrati</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition"
        >
          <Plus className="w-5 h-5 mr-2" />
          Aggiungi Giocatore
        </button>
      </div>

      {/* Players Grid */}
      {players.length === 0 ? (
        <div className="bg-slate-800 rounded-xl p-12 shadow-md text-center">
          <Users className="w-16 h-16 mx-auto mb-4 text-slate-600" />
          <h3 className="text-xl font-semibold text-white mb-2">Nessun giocatore</h3>
          <p className="text-slate-400 mb-6">Inizia aggiungendo il tuo primo giocatore!</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center px-6 py-3 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition"
          >
            <Plus className="w-5 h-5 mr-2" />
            Aggiungi Giocatore
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {players.map((player) => (
            <div
              key={player.id}
              className="bg-slate-800 rounded-xl p-6 shadow-md hover:shadow-lg transition"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center space-x-4">
                  {/* Avatar */}
                  {player.avatar_url ? (
                    <img
                      src={getPlayerImageUrl(player.avatar_url)}
                      alt={player.name}
                      className="w-16 h-16 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className={`w-16 h-16 rounded-full ${getAvatarColor(player.name)} flex items-center justify-center flex-shrink-0`}>
                      <span className="text-white text-xl font-bold">{getInitials(player.name)}</span>
                    </div>
                  )}

                  <div>
                    <h3 className="text-xl font-semibold text-white">{player.alias || player.name}</h3>
                    {player.alias && (
                      <p className="text-sm text-slate-400 mt-0.5">{player.name}</p>
                    )}
                    {player.is_me && (
                      <span className="inline-flex items-center px-2 py-0.5 bg-emerald-500/20 text-emerald-500 text-xs rounded-full mt-1">
                        Sei tu
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex space-x-2">
                  {!player.is_me && (
                    <>
                      <button
                        onClick={() => {
                          setSelectedPlayer(player)
                          setFormData({ name: player.name, alias: player.alias || '', avatar_url: player.avatar_url || '' })
                          setAvatarPreview(player.avatar_url ? getPlayerImageUrl(player.avatar_url) : null)
                          setShowEditModal(true)
                        }}
                        className="p-2 hover:bg-slate-700 rounded-lg transition"
                        title="Modifica"
                      >
                        <Edit className="w-4 h-4 text-slate-400" />
                      </button>
                      <button
                        onClick={() => {
                          setSelectedPlayer(player)
                          setShowDeleteModal(true)
                        }}
                        className="p-2 hover:bg-slate-700 rounded-lg transition"
                        title="Elimina"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-700">
                <div className="flex items-center">
                  <Users className="w-5 h-5 text-emerald-500 mr-2" />
                  <div>
                    <p className="text-2xl font-bold text-white">
                      {playerStats[player.id]?.totalPlays || 0}
                    </p>
                    <p className="text-xs text-slate-400">Partite</p>
                  </div>
                </div>

                <div className="flex items-center">
                  <Trophy className="w-5 h-5 text-purple-500 mr-2" />
                  <div>
                    <p className="text-2xl font-bold text-white">
                      {playerStats[player.id]?.winRate || 0}%
                    </p>
                    <p className="text-xs text-slate-400">Win Rate</p>
                  </div>
                </div>
              </div>

              {/* View Details Link */}
              <Link
                to={`/players/${player.id}`}
                className="mt-4 block text-center text-sm text-emerald-500 hover:text-emerald-400 transition"
              >
                Vedi dettagli →
              </Link>
            </div>
          ))}
        </div>
      )}

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-xl font-bold text-white mb-4">Aggiungi Giocatore</h3>
            <form onSubmit={handleAdd}>
              <div className="mb-4">
                <label className="block text-sm text-slate-300 mb-2">Nome</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Nome del giocatore"
                  autoFocus
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm text-slate-300 mb-2">Alias (opzionale)</label>
                <input
                  type="text"
                  value={formData.alias}
                  onChange={(e) => setFormData({ ...formData, alias: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Nickname o alias"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm text-slate-300 mb-2">Immagine del profilo (opzionale)</label>
                <div className="flex items-center space-x-4">
                  {avatarPreview ? (
                    <div className="relative">
                      <img
                        src={avatarPreview}
                        alt="Anteprima avatar"
                        className="w-20 h-20 rounded-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={handleRemoveAvatar}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600 transition"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-slate-700 flex items-center justify-center">
                      <User className="w-10 h-10 text-slate-500" />
                    </div>
                  )}
                  <div className="flex-1">
                    <input
                      type="file"
                      id="avatar-upload"
                      accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
                      onChange={handleAvatarChange}
                      className="hidden"
                    />
                    <label
                      htmlFor="avatar-upload"
                      className="inline-flex items-center px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition cursor-pointer"
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      {uploadingAvatar ? 'Caricamento...' : 'Carica immagine'}
                    </label>
                    <p className="text-xs text-slate-400 mt-2">JPG, PNG, WebP o GIF (max 2MB)</p>
                  </div>
                </div>
              </div>
              <div className="flex space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false)
                    setFormData({ name: '', alias: '', avatar_url: '' })
                    setAvatarFile(null)
                    setAvatarPreview(null)
                  }}
                  className="flex-1 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition"
                >
                  Aggiungi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-xl font-bold text-white mb-4">Modifica Giocatore</h3>
            <form onSubmit={handleEdit}>
              <div className="mb-4">
                <label className="block text-sm text-slate-300 mb-2">Nome</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  autoFocus
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm text-slate-300 mb-2">Alias (opzionale)</label>
                <input
                  type="text"
                  value={formData.alias}
                  onChange={(e) => setFormData({ ...formData, alias: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Nickname o alias"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm text-slate-300 mb-2">Immagine del profilo (opzionale)</label>
                <div className="flex items-center space-x-4">
                  {avatarPreview ? (
                    <div className="relative">
                      <img
                        src={avatarPreview}
                        alt="Anteprima avatar"
                        className="w-20 h-20 rounded-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={handleRemoveAvatar}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600 transition"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-slate-700 flex items-center justify-center">
                      <User className="w-10 h-10 text-slate-500" />
                    </div>
                  )}
                  <div className="flex-1">
                    <input
                      type="file"
                      id="avatar-edit-upload"
                      accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
                      onChange={handleAvatarChange}
                      className="hidden"
                    />
                    <label
                      htmlFor="avatar-edit-upload"
                      className="inline-flex items-center px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition cursor-pointer"
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      {uploadingAvatar ? 'Caricamento...' : 'Cambia immagine'}
                    </label>
                    <p className="text-xs text-slate-400 mt-2">JPG, PNG, WebP o GIF (max 2MB)</p>
                  </div>
                </div>
              </div>
              <div className="flex space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false)
                    setSelectedPlayer(null)
                    setFormData({ name: '', alias: '', avatar_url: '' })
                    setAvatarFile(null)
                    setAvatarPreview(null)
                  }}
                  className="flex-1 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition"
                >
                  Salva
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-center mb-4">
              <div className="bg-red-500/20 p-3 rounded-full mr-4">
                <AlertTriangle className="w-6 h-6 text-red-500" />
              </div>
              <h3 className="text-xl font-bold text-white">Conferma Eliminazione</h3>
            </div>

            <p className="text-slate-300 mb-6">
              Sei sicuro di voler eliminare il giocatore "{selectedPlayer?.name}"? Questa azione non può essere annullata.
            </p>

            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false)
                  setSelectedPlayer(null)
                }}
                className="flex-1 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition"
              >
                Annulla
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition"
              >
                Elimina
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Players
