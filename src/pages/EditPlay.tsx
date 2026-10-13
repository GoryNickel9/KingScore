import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { invalidateELOHistory } from '../utils/eloCalculator'
import { Save, ArrowLeft, Gamepad2, Plus, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { Spinner } from '../components/Spinner'
import type { DbGame, DbPlayer } from '../types/rows'
import { assignPositions } from '../utils/elo/positions'
import { listGames } from '../services/games'
import { listUserPlayers } from '../services/players'
import { atomicPlayWritesEnabled, getPlayEditor, updatePlay, parseDurationInput, parseScoreInput, PlayWriteError, type PlayInput } from '../services/playWrites'

interface EditPlayerRow {
  id: string | null
  playerId: string
  playerName: string
  score: string | number
  winner: boolean
  color: string | null
  role: string | null
}

interface EditFormData {
  gameId: string
  gameName: string
  playedAt: string
  durationMinutes: string
  source: string
  notes: string
  players: EditPlayerRow[]
  isCooperative: boolean
  teamWon: boolean | null
}

const EditPlay = () => {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [formData, setFormData] = useState<EditFormData>({
    gameId: '',
    gameName: '',
    playedAt: '',
    durationMinutes: '',
    source: 'offline',
    notes: '',
    players: [],
    isCooperative: false,
    teamWon: null
  })

  const [games, setGames] = useState<DbGame[]>([])
  const [players, setPlayers] = useState<DbPlayer[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [saving, setSaving] = useState<boolean>(false)
  const writing = useRef(false)
  const pending = useRef<{ actorId: string; ownerId: string | null; requestId: string; playId: string; revision: string; payload: PlayInput } | null>(null)
  const currentScope = useRef({ actorId: user?.id, playId: id })
  currentScope.current = { actorId: user?.id, playId: id }
  const readGeneration = useRef(0)
  const mounted = useRef(true)
  const [loadedScope, setLoadedScope] = useState<{ actorId: string; ownerId: string | null; playId: string } | null>(null)
  const [revision, setRevision] = useState<string | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [sourceNotice, setSourceNotice] = useState<string | null>(null)

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  useEffect(() => {
    if (atomicPlayWritesEnabled && pending.current) return
    void fetchPlay()
    void fetchGames()
    void fetchPlayers()
  }, [id, user?.id])

  const fetchPlay = async (reload = false): Promise<void> => {
    const scope = { ...currentScope.current }
    const generation = ++readGeneration.current
    const current = (): boolean => mounted.current && generation === readGeneration.current &&
      scope.actorId === currentScope.current.actorId && scope.playId === currentScope.current.playId && !pending.current
    setLoading(true)
    try {
      if (atomicPlayWritesEnabled) {
        if (!scope.playId || !scope.actorId) throw new Error('Accedi per modificare la partita')
        const editor = await getPlayEditor(supabase, scope.playId, scope.actorId)
        if (!current()) return
        const data = editor.detail.play
        setLoadedScope({ actorId: scope.actorId, playId: scope.playId, ownerId: data.user_id })
        setSourceNotice(data.source !== 'online' && data.source !== 'offline' ? data.source ?? 'non indicata' : null)
        setRevision(editor.revision)
        setConflict(false)
        setFormData({ gameId: data.game_id ?? '', gameName: editor.detail.game?.name ?? '',
          playedAt: data.played_at, durationMinutes: data.duration_minutes == null ? '' : String(data.duration_minutes),
          source: data.source === 'online' ? 'online' : 'offline', notes: data.notes ?? '',
          isCooperative: data.is_cooperative ?? false, teamWon: data.team_won,
          players: editor.detail.scores.map(({ score, player }) => ({ id: score.id, playerId: score.player_id ?? '',
            playerName: player?.alias || player?.name || '', score: score.score ?? '', winner: score.winner ?? false,
            color: score.color, role: score.role })),
        })
        return
      }
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
        .eq('id', id!)
        .eq('user_id', user!.id)
        .single()

      if (error) throw error
      if (!current()) return

      if (data) {
        setFormData({
          gameId: data.game_id || '',
          gameName: data.games?.name || '',
          playedAt: data.played_at ? data.played_at.split('T')[0] : new Date().toISOString().split('T')[0],
          durationMinutes: data.duration_minutes !== null && data.duration_minutes !== undefined ? String(data.duration_minutes) : '',
          source: data.source || 'offline',
          notes: data.notes || '',
          isCooperative: data.is_cooperative || false,
          teamWon: data.team_won ?? null,
          players: data.play_scores?.map(score => ({
            id: score.id,
            playerId: score.player_id ?? '',
            playerName: score.players?.alias || score.players?.name || '',
            score: score.score ?? '',
            winner: score.winner || false,
            color: score.color,
            role: score.role
          })) || []
        })
      }
    } catch (error) {
      if (!current()) return
      console.error('Error fetching play:', error)
      toast.error('Errore durante il caricamento della partita')
      if (!reload) void navigate('/plays')
    } finally {
      if (current()) setLoading(false)
    }
  }

  const fetchGames = async (): Promise<void> => {
    const scope = { ...currentScope.current }
    try {
      const data = await listGames(supabase)
      if (mounted.current && scope.actorId === currentScope.current.actorId && scope.playId === currentScope.current.playId) setGames(data)
    } catch (error) {
      console.error('Error fetching games:', error)
    }
  }

  const fetchPlayers = async (): Promise<void> => {
    const scope = { ...currentScope.current }
    try {
      if (atomicPlayWritesEnabled) {
        const { data, error } = await supabase.from('players').select('*').order('name')
        if (error) throw error
        if (mounted.current && scope.actorId === currentScope.current.actorId && scope.playId === currentScope.current.playId) setPlayers(data ?? [])
      } else {
        const data = await listUserPlayers(supabase, user!.id)
        if (mounted.current && scope.actorId === currentScope.current.actorId && scope.playId === currentScope.current.playId) setPlayers(data)
      }
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
          color: null,
          role: null
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

  const saveAtomic = async (): Promise<void> => {
    if (writing.current || conflict) return
    if ((pending.current && (pending.current.actorId !== currentScope.current.actorId || pending.current.playId !== currentScope.current.playId)) ||
        !loadedScope || loadedScope.actorId !== currentScope.current.actorId || loadedScope.playId !== currentScope.current.playId) {
      toast.error('Torna alla partita e all’account originali prima di verificare il salvataggio')
      return
    }
    writing.current = true
    setSaving(true)
    try {
      if (!pending.current) {
        if (!user || !id || !revision) throw new Error('Ricarica la partita prima di salvarla')
        if (!formData.gameId || !formData.players.length || formData.players.some(player => !player.playerId)) {
          throw new Error('Seleziona gioco e almeno un giocatore valido')
        }
        pending.current = { actorId: loadedScope.actorId, ownerId: loadedScope.ownerId,
          requestId: crypto.randomUUID(), playId: loadedScope.playId, revision, payload: {
          game_id: formData.gameId, played_at: formData.playedAt, duration_minutes: parseDurationInput(formData.durationMinutes),
          source: formData.source === 'online' ? 'online' : 'offline', notes: formData.notes || null,
          is_cooperative: formData.isCooperative, team_won: formData.isCooperative ? formData.teamWon : null,
          scores: formData.players.map(player => ({ id: player.id, player_id: player.playerId,
            score: parseScoreInput(player.score), winner: formData.isCooperative && formData.teamWon !== null ? formData.teamWon : player.winner,
            color: player.color, role: player.role })),
        } }
      }
      const command = pending.current
      await updatePlay(supabase, command)
      if (!mounted.current) return
      pending.current = null
      setUncertain(false)
      if (command.ownerId && currentScope.current.actorId === command.actorId) {
        try { await invalidateELOHistory(supabase, command.playId, command.ownerId) } catch { /* Existing website behavior. */ }
      }
      if (!mounted.current) return
      toast.success('Partita aggiornata con successo!')
      if (currentScope.current.actorId === command.actorId && currentScope.current.playId === command.playId) {
        void navigate(`/plays/${command.playId}`)
      } else { void fetchPlay(); void fetchGames(); void fetchPlayers() }
    } catch (error) {
      if (!mounted.current) return
      if (error instanceof PlayWriteError && (error.kind === 'unknown' ||
          (uncertain && (error.kind === 'unavailable' || error.kind === 'permission')))) setUncertain(true)
      else {
        pending.current = null
        setUncertain(false)
        if (error instanceof PlayWriteError && error.kind === 'conflict') setConflict(true)
        if (loadedScope.actorId !== currentScope.current.actorId || loadedScope.playId !== currentScope.current.playId) {
          void fetchPlay(); void fetchGames(); void fetchPlayers()
        }
      }
      toast.error(error instanceof Error ? error.message : 'Errore durante il salvataggio della partita')
    } finally { writing.current = false; setSaving(false) }
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    if (atomicPlayWritesEnabled) { await saveAtomic(); return }
    if (writing.current) return

    if (!formData.gameId) {
      toast.error('Seleziona un gioco')
      return
    }

    if (formData.players.length < 2) {
      toast.error('Aggiungi almeno 2 giocatori')
      return
    }

    // Verifica che tutti i giocatori abbiano un playerId valido
    const invalidPlayers = formData.players.filter(player => !player.playerId)
    if (invalidPlayers.length > 0) {
      toast.error('Seleziona un giocatore per ogni riga')
      return
    }

    writing.current = true
    try {
      setSaving(true)

      // Aggiorna la partita — NON usare .single() con UPDATE...RETURNING quando ci sono
      // più policy RLS SELECT attive: PostgREST riceve righe duplicate e risponde 406.
      // Invece: .select() restituisce un array, controlliamo data[0].
      const { data: updatedPlayData, error: playError } = await supabase
        .from('plays')
        .update({
          game_id: formData.gameId,
          played_at: formData.playedAt,
          duration_minutes: formData.durationMinutes === '' ? null : Number.parseInt(formData.durationMinutes, 10),
          source: formData.source,
          notes: formData.notes || null,
          is_cooperative: formData.isCooperative,
          team_won: formData.isCooperative ? formData.teamWon : null
        })
        .eq('id', id!)
        .eq('user_id', user!.id)
        .select()

      if (playError) {
        throw new Error(`Errore aggiornamento partita: ${playError.message}`)
      }

      const updatedPlay = updatedPlayData?.[0]
      if (!updatedPlay) {
        throw new Error('Partita non trovata o permesso negato: nessuna riga aggiornata')
      }

      // Valida gli score prima di modificare il DB per evitare data loss
      const validatedScores = formData.players.map(player => {
        const scoreValue = player.score === '' ? null : Number.parseInt(String(player.score), 10)
        if (scoreValue === null || Number.isNaN(scoreValue)) {
          throw new Error(`Il punteggio per "${player.playerName}" non è valido`)
        }

        // Se cooperativo e teamWon è definito, sovrascrive il winner individuale
        const winner = formData.isCooperative && formData.teamWon !== null
          ? formData.teamWon
          : player.winner

        return { playerId: player.playerId, score: scoreValue, winner }
      })

      // Posizioni ricalcolate con la fonte unica di verità condivisa col
      // ricalcolo ELO (prima si riusavano quelle stale caricate dal form)
      const positionedScores = assignPositions(validatedScores, {
        cooperative: formData.isCooperative,
        teamWon: formData.isCooperative ? formData.teamWon : null
      })

      const scoresToInsert = positionedScores.map(player => ({
        play_id: id,
        player_id: player.playerId,
        score: player.score,
        winner: player.winner,
        position: player.position
      }))

      // Sostituzione atomica dei punteggi (fix TD-004): delete + insert in
      // un'unica transazione lato DB. Prima erano due richieste separate e un
      // fallimento di rete in mezzo lasciava la partita senza punteggi — dati
      // grezzi, non ricostruibili dal ricalcolo ELO.
      const { data: insertedScores, error: replaceError } = await supabase.rpc('replace_play_scores', {
        p_play_id: id!,
        p_scores: scoresToInsert.map(({ player_id, score, winner, position }) => ({
          player_id,
          score,
          winner,
          position
        }))
      })

      if (replaceError) {
        throw new Error(`Errore sostituzione punteggi: ${replaceError.message}`)
      }

      // Verifica che i punteggi siano stati inseriti correttamente
      if ((insertedScores ?? []).length !== formData.players.length) {
        throw new Error('Errore: non tutti i punteggi sono stati inseriti correttamente')
      }

      // Invalida la cache ELO: la partita modificata rende obsoleto lo storico
      // calcolato in precedenza per questo gioco e per l'ELO Generale.
      try { await invalidateELOHistory(supabase, id!) } catch { /* non bloccare il flusso */ }

      toast.success('Partita aggiornata con successo!')
      void navigate(`/plays/${id}`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Errore sconosciuto durante l'aggiornamento della partita"
      toast.error(errorMessage)
    } finally {
      writing.current = false
      setSaving(false)
    }
  }

  if (atomicPlayWritesEnabled && pending.current &&
      (pending.current.actorId !== user?.id || pending.current.playId !== id)) {
    return <div role="alert" className="rounded-lg bg-amber-500/20 p-4 text-amber-200">
      <p>Un salvataggio della partita precedente deve essere verificato. Torna all’account e alla partita originali prima di iniziare una nuova modifica.</p>
      {pending.current.actorId === user?.id && <Link to={`/plays/${pending.current.playId}/edit`}
        className="mt-3 inline-block rounded-lg bg-slate-700 px-4 py-2">Torna alla partita in sospeso</Link>}
    </div>
  }

  if (loading || (atomicPlayWritesEnabled && (!loadedScope || loadedScope.actorId !== user?.id || loadedScope.playId !== id))) {
    return <Spinner className="h-64" />
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
        {uncertain && <div role="alert" className="rounded-lg bg-amber-500/20 p-4 text-amber-200">
          <p>La risposta non è arrivata. Le modifiche potrebbero essere già salvate. Riprova la stessa richiesta.</p>
          <button type="button" onClick={() => void saveAtomic()} disabled={saving}
            className="mt-3 min-h-11 rounded-lg bg-slate-700 px-4 py-2 disabled:opacity-50">{saving ? 'Verifica...' : 'Riprova la stessa richiesta'}</button>
        </div>}
        {conflict && <div role="alert" className="rounded-lg bg-amber-500/20 p-4 text-amber-200">
          <p>La partita è cambiata. La tua bozza resta visibile. Ricarica i dati aggiornati prima di salvare; la ricarica sostituisce la bozza.</p>
          <button type="button" onClick={() => { setLoading(true); void fetchPlay(true) }}
            className="mt-3 min-h-11 rounded-lg bg-slate-700 px-4 py-2">Ricarica e sostituisci la bozza</button>
        </div>}
        <fieldset disabled={saving || uncertain || conflict} className="space-y-6">
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

          {/* Indicatore Vincitori */}
          {!formData.isCooperative && formData.players.length > 0 && (() => {
            const winnersCount = formData.players.filter(p => p.winner).length
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
        </div>

        {/* Play Details */}
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <h2 className="text-xl font-bold text-white mb-4">Dettagli Partita</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              {sourceNotice && <p className="mt-2 text-sm text-amber-300">La fonte storica «{sourceNotice}» verrà salvata come IRL, oppure scegli Online.</p>}
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

        {/* Cooperative result */}
        {formData.isCooperative && (
          <div className="bg-slate-800 rounded-xl p-6 shadow-md">
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
                      step={atomicPlayWritesEnabled ? 'any' : undefined}
                      value={player.score as string}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => handlePlayerChange(index, 'score', e.target.value)}
                      className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      placeholder="Punteggio"
                    />
                  </div>
                  {!formData.isCooperative && (
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">Vincitore / Pareggio</label>
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
                  )}
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
        </fieldset>
      </form>
    </div>
  )
}

export default EditPlay
