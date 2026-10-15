import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Save, ArrowLeft, Gamepad2, Plus, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { Spinner } from '../components/Spinner'
import { PlayWriteStatus } from '../components/PlayWriteStatus'
import { usePlayWrites } from '../hooks/usePlayWrites'
import { atomicPlayWritesEnabled } from '../services/browserPlayWrites'
import { playFormPayload } from '../services/playFormPayload'
import { preparePlaySave } from '../services/playSaveRequests'
import type { PlayEditorSnapshot } from '../services/playEditorReader'
import type { DbGame, DbPlayer } from '../types/rows'
import { listGames } from '../services/games'
import { listUserPlayers } from '../services/players'

interface EditPlayerRow {
  id: string | null
  playerId: string
  playerName: string
  score: string
  winner: boolean
  color: string | null
  role: string | null
}
interface EditFormData {
  gameId: string; gameName: string; playedAt: string; durationMinutes: string
  source: string; notes: string; players: EditPlayerRow[]
  isCooperative: boolean; teamWon: boolean | null
}
function formFromSnapshot(snapshot: PlayEditorSnapshot): EditFormData {
  const { play, game, scores } = snapshot.detail
  return {
    gameId: play.game_id ?? '', gameName: game?.name ?? '', playedAt: play.played_at,
    durationMinutes: play.duration_minutes === null ? '' : String(play.duration_minutes),
    source: play.source ?? '', notes: play.notes ?? '', isCooperative: play.is_cooperative ?? false,
    teamWon: play.team_won,
    players: scores.map(({ score, player }) => ({ id: score.id, playerId: score.player_id ?? '',
      playerName: player?.alias || player?.name || 'Giocatore non disponibile', score: score.score ?? '',
      winner: score.winner ?? false, color: score.color, role: score.role })),
  }
}
function SnapshotSummary({ form }: { form: EditFormData }) {
  return <div className="space-y-2 text-sm text-slate-300">
    <p>{form.gameName || 'Gioco non disponibile'} · {form.playedAt}</p>
    <p>Durata: {form.durationMinutes || 'non specificata'} · Fonte: {form.source || 'non specificata'}</p>
    <p>Risultato: {form.isCooperative ? `cooperativo, team ${form.teamWon === null ? 'non specificato' : form.teamWon ? 'vincitore' : 'sconfitto'}` : 'competitivo'}</p>
    <p className="whitespace-pre-wrap break-words">Note: {form.notes || 'nessuna'}</p>
    <ol className="list-decimal pl-5">{form.players.map((player, index) => <li key={player.id ?? index}>
      {player.playerName}: {player.score || 'senza punteggio'}{player.winner ? ' · vincitore' : ''}
      {player.color !== null ? ` · colore: ${player.color}` : ''}{player.role !== null ? ` · ruolo: ${player.role}` : ''}
    </li>)}</ol>
  </div>
}

const EditPlay = () => {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  return <EditPlayForm key={`${user?.id ?? ''}:${user?.app_metadata?.role ?? ''}:${id ?? ''}`} id={id ?? ''} />
}
const EditPlayForm = ({ id }: { id: string }) => {
  const writes = usePlayWrites()
  const { actor, api, coordinator } = writes
  const { user } = useAuth()
  const navigate = useNavigate()
  const active = useRef(false)
  const loadGeneration = useRef(0)
  const compareGeneration = useRef(0)
  const confirmedBefore = useRef<string | undefined>(undefined)
  const [snapshot, setSnapshot] = useState<PlayEditorSnapshot | null>(null)
  const [formData, setFormData] = useState<EditFormData>({ gameId: '', gameName: '', playedAt: '',
    durationMinutes: '', source: '', notes: '', players: [], isCooperative: false, teamWon: null })
  const [games, setGames] = useState<DbGame[]>([])
  const [players, setPlayers] = useState<DbPlayer[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [latest, setLatest] = useState<PlayEditorSnapshot | null>(null)
  const [comparing, setComparing] = useState(false)
  const [compareError, setCompareError] = useState(false)
  const enabled = atomicPlayWritesEnabled && user?.app_metadata?.role === 'admin'
  const saving = writes.state.phase === 'busy'

  const loadInitial = useCallback(async () => {
    if (!enabled) { setLoading(false); return }
    const generation = ++loadGeneration.current
    setLoading(true); setLoadError(false)
    try {
      const client = await api.catalogClient(actor)
      const [next, catalogGames, catalogPlayers] = await Promise.all([
        api.editor(actor, id), listGames(client), listUserPlayers(client, actor),
      ])
      await api.requireActor(actor)
      if (!active.current || generation !== loadGeneration.current) return
      setSnapshot(next); setFormData(formFromSnapshot(next))
      setGames([...new Map([...catalogGames, ...(next.detail.game ? [next.detail.game] : [])].map(game => [game.id, game])).values()])
      setPlayers([...new Map([...catalogPlayers, ...next.detail.scores.flatMap(item => item.player ? [item.player] : [])].map(player => [player.id, player])).values()])
    } catch {
      if (active.current && generation === loadGeneration.current) setLoadError(true)
    } finally {
      if (active.current && generation === loadGeneration.current) setLoading(false)
    }
  }, [enabled, api, actor, id])
  useEffect(() => {
    active.current = true
    void loadInitial()
    return () => { active.current = false }
  }, [loadInitial])

  const compareLatest = useCallback(async () => {
    const generation = ++compareGeneration.current
    setComparing(true); setCompareError(false); setLatest(null)
    try {
      const next = await api.editor(actor, id)
      if (active.current && generation === compareGeneration.current) setLatest(next)
    } catch {
      if (active.current && generation === compareGeneration.current) setCompareError(true)
    } finally {
      if (active.current && generation === compareGeneration.current) setComparing(false)
    }
  }, [api, actor, id])
  useEffect(() => {
    if (writes.state.phase !== 'ready' && writes.state.phase !== 'pending') return
    const receipt = writes.state.confirmed
    const key = receipt ? `${receipt.playId}:${receipt.revision ?? 'deleted'}` : ''
    if (confirmedBefore.current !== undefined && confirmedBefore.current !== key && receipt?.playId === id &&
        snapshot && receipt.revision !== snapshot.revision) {
      setConflict(true)
      void compareLatest()
    }
    confirmedBefore.current = key
  }, [writes.state.phase, writes.state.confirmed, id, snapshot, compareLatest])

  const handleGameSelect = (game: DbGame): void => {
    setFormData(prev => ({ ...prev, gameId: game.id, gameName: game.name }))
  }
  const handlePlayerAdd = (): void => {
    setFormData(prev => ({ ...prev, players: [...prev.players, { id: null, playerId: '',
      playerName: '', score: '', winner: false, color: null, role: null }] }))
  }
  const handlePlayerRemove = (index: number): void => {
    setFormData(prev => ({ ...prev, players: prev.players.filter((_, i) => i !== index) }))
  }
  const handlePlayerChange = (index: number, field: keyof EditPlayerRow, value: string | boolean): void => {
    setFormData(prev => ({ ...prev, players: prev.players.map((player, i) => i === index ? { ...player, [field]: value } : player) }))
  }
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (writes.blocked || conflict || !snapshot?.editability.editable) return
    if (!formData.gameId) { toast.error('Seleziona un gioco'); return }
    if (formData.players.length < 1) { toast.error('Aggiungi almeno un giocatore'); return }
    if (formData.players.some(player => !player.playerId)) { toast.error('Seleziona un giocatore per ogni riga'); return }
    let request
    try {
      request = preparePlaySave(actor, 'update_play_v1', { p_request_id: crypto.randomUUID(), p_play_id: id,
        p_expected_revision: snapshot.revision, p_payload: playFormPayload(formData, formData.players.map(player => ({
          id: player.id, player_id: player.playerId, score: player.score === '' ? null : player.score,
          winner: player.winner, color: player.color, role: player.role,
        }))) })
    } catch {
      toast.error('Controlla data, durata, punteggi e partecipanti. I punteggi devono essere numeri decimali con il punto.')
      return
    }
    const outcome = await coordinator.run(() => api.writer.save(request))
    if (!active.current || !outcome) return
    if (outcome.kind === 'saved') {
      toast.success('Partita aggiornata. Le classifiche ELO saranno aggiornate dal server.')
      void navigate(`/plays/${id}`)
    } else if (outcome.kind === 'rejected') {
      if (outcome.status === 409) {
        setConflict(true)
        void compareLatest()
      } else toast.error('La modifica non è stata accettata. Verifica dati e autorizzazioni prima di riprovare.')
    }
  }

  if (!enabled) return <PlayWriteStatus writes={writes} />
  if (loading) return <Spinner className="h-64" />
  if (loadError || !snapshot) return <div role="alert" className="space-y-4 rounded-xl bg-slate-800 p-6 text-slate-200">
    <p>Impossibile caricare la partita per la modifica. Verifica connessione e autorizzazioni.</p>
    <button type="button" onClick={() => { void loadInitial() }} className="rounded-lg bg-emerald-600 px-4 py-3">Riprova caricamento</button>
    <Link to={`/plays/${id}`} className="block text-emerald-400 underline">Torna alla partita</Link>
    <PlayWriteStatus writes={writes} />
  </div>

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

      <PlayWriteStatus writes={writes} />
      {!snapshot.editability.editable && <div role="alert" className="rounded-lg border border-amber-500 p-4 text-amber-200">
        Questa partita contiene dati storici non compatibili con l’editor. Non può essere modificata qui.
        <div className="mt-3"><SnapshotSummary form={formData} /></div>
      </div>}
      {conflict && <section aria-label="Confronto modifiche" className="space-y-4 rounded-xl border border-amber-500 bg-slate-800 p-6">
        <p role="alert" className="text-amber-200">La partita è cambiata o un salvataggio precedente è stato confermato. La tua bozza è conservata. Confronta i dati e ricarica prima di modificare ancora.</p>
        <div className="grid gap-6 md:grid-cols-2">
          <div><h2 className="mb-3 font-semibold text-white">La tua bozza</h2><SnapshotSummary form={formData} /></div>
          <div><h2 className="mb-3 font-semibold text-white">Dati aggiornati</h2>
            {latest ? <SnapshotSummary form={formFromSnapshot(latest)} /> : <p role="status" className="text-slate-300">{comparing ? 'Caricamento dati aggiornati…' : 'Dati aggiornati non disponibili. La bozza rimane conservata.'}</p>}
          </div>
        </div>
        {compareError && <p role="alert" className="text-amber-200">Impossibile caricare i dati aggiornati. Verifica connessione e autorizzazioni.</p>}
        {latest ? <button type="button" disabled={writes.blocked} onClick={() => {
          setSnapshot(latest); setFormData(formFromSnapshot(latest)); setConflict(false); setLatest(null)
          setGames(prev => [...new Map([...prev, ...(latest.detail.game ? [latest.detail.game] : [])].map(game => [game.id, game])).values()])
          setPlayers(prev => [...new Map([...prev, ...latest.detail.scores.flatMap(item => item.player ? [item.player] : [])].map(player => [player.id, player])).values()])
        }} className="rounded-lg bg-amber-600 px-4 py-3 text-white disabled:opacity-50">Sostituisci la bozza con i dati aggiornati</button> :
          <button type="button" disabled={comparing || writes.blocked} onClick={() => { void compareLatest() }} className="rounded-lg bg-slate-700 px-4 py-3 text-white disabled:opacity-50">Ricarica confronto</button>}
      </section>}
      {/* Form */}
      <form onSubmit={handleSubmit}>
        <fieldset disabled={writes.blocked || conflict || !snapshot.editability.editable} className="space-y-6 disabled:opacity-70">
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
                      step="any"
                      value={player.score}
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
            disabled={saving || writes.blocked || conflict || !snapshot.editability.editable}
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
