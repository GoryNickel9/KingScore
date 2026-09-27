import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarDays,
  Check,
  Gamepad2,
  MessageCircle,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import { Spinner } from '../components/Spinner'
import { supabase } from '../lib/supabase'
import type { DbAdminRegistration, DbPlayComment, DbPlayer } from '../types/rows'

interface AdminSummary {
  plays: number
  games: number
  players: number
  comments: number
  registrations: number
}

interface AdminDashboardData {
  summary: AdminSummary
  comments: DbPlayComment[]
  players: DbPlayer[]
  registrations: DbAdminRegistration[]
}

type AdminSection = 'overview' | 'players' | 'registrations' | 'comments'

const PAGE_SIZE = 500
const COMMENT_PAGE_SIZE = 100

async function fetchAdminDashboardData(): Promise<AdminDashboardData> {
  const [playsResult, gamesResult, playersResult, commentsResult, registrationsResult] = await Promise.all([
    supabase.from('plays').select('id', { count: 'exact', head: true }),
    supabase.from('games').select('id', { count: 'exact', head: true }),
    supabase.from('players').select('*', { count: 'exact' }).order('name').limit(PAGE_SIZE),
    supabase
      .from('play_comments')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(COMMENT_PAGE_SIZE),
    supabase.rpc('admin_list_registrations'),
  ])

  const error = playsResult.error ?? gamesResult.error ?? playersResult.error ?? commentsResult.error ?? registrationsResult.error
  if (error) throw error

  const players = playersResult.data ?? []
  const comments = commentsResult.data ?? []
  const registrations = registrationsResult.data ?? []

  return {
    summary: {
      plays: playsResult.count ?? 0,
      games: gamesResult.count ?? 0,
      players: playersResult.count ?? players.length,
      comments: commentsResult.count ?? 0,
      registrations: registrations[0]?.total_count ?? registrations.length,
    },
    comments,
    players,
    registrations,
  }
}

function formatDate(date: string): string {
  return new Date(date).toLocaleString('it-IT', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

const Admin = () => {
  const [summary, setSummary] = useState<AdminSummary>({
    plays: 0,
    games: 0,
    players: 0,
    comments: 0,
    registrations: 0,
  })
  const [comments, setComments] = useState<DbPlayComment[]>([])
  const [players, setPlayers] = useState<DbPlayer[]>([])
  const [registrations, setRegistrations] = useState<DbAdminRegistration[]>([])
  const [section, setSection] = useState<AdminSection>('overview')
  const [refreshing, setRefreshing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const applyDashboardData = useCallback((dashboard: AdminDashboardData): void => {
    setSummary(dashboard.summary)
    setComments(dashboard.comments)
    setPlayers(dashboard.players)
    setRegistrations(dashboard.registrations)
  }, [])

  const loadDashboard = useCallback(async (): Promise<void> => {
    setRefreshing(true)
    setLoadError(false)

    try {
      applyDashboardData(await fetchAdminDashboardData())
    } catch (error) {
      console.error('Error loading admin dashboard:', error)
      setLoadError(true)
      toast.error('Impossibile caricare i dati amministrativi')
    } finally {
      setRefreshing(false)
    }
  }, [applyDashboardData])

  useEffect(() => {
    let isCurrent = true
    void fetchAdminDashboardData()
      .then((dashboard) => {
        if (isCurrent) applyDashboardData(dashboard)
      })
      .catch((error: unknown) => {
        if (!isCurrent) return
        console.error('Error loading admin dashboard:', error)
        setLoadError(true)
        toast.error('Impossibile caricare i dati amministrativi')
      })
      .finally(() => {
        if (isCurrent) setLoading(false)
      })

    return () => {
      isCurrent = false
    }
  }, [applyDashboardData])

  const handleCommentDeleted = (commentId: string): void => {
    setComments((current) => current.filter((comment) => comment.id !== commentId))
    setSummary((current) => ({ ...current, comments: Math.max(0, current.comments - 1) }))
  }

  const handlePlayerUpdated = (updatedPlayer: DbPlayer): void => {
    setPlayers((current) => current.map((player) => player.id === updatedPlayer.id ? updatedPlayer : player))
  }

  const handlePlayerDeleted = (playerId: string): void => {
    setPlayers((current) => current.filter((player) => player.id !== playerId))
    setSummary((current) => ({ ...current, players: Math.max(0, current.players - 1) }))
  }

  if (loading) return <Spinner className="h-64" />

  const sections: { id: AdminSection; label: string; count?: number }[] = [
    { id: 'overview', label: 'Panoramica' },
    { id: 'players', label: 'Giocatori', count: summary.players },
    { id: 'registrations', label: 'Registrazioni', count: summary.registrations },
    { id: 'comments', label: 'Commenti', count: summary.comments },
  ]

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-emerald-500/15 p-3">
            <ShieldCheck className="h-7 w-7 text-emerald-400" />
          </div>
          <div>
            <p className="text-sm font-medium uppercase tracking-wider text-emerald-400">KingScore</p>
            <h1 className="text-3xl font-bold text-white">Pannello admin</h1>
            <p className="mt-1 text-slate-400">Gestisci player, account e commenti.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadDashboard()}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-600 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Aggiorna
        </button>
      </header>

      {loadError ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
          <p className="mb-3 text-slate-200">Non riesco a caricare i dati del pannello.</p>
          <button type="button" onClick={() => void loadDashboard()} className="text-sm font-medium text-emerald-400 hover:text-emerald-300">
            Riprova
          </button>
        </div>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-label="Riepilogo">
            <SummaryCard icon={CalendarDays} label="Partite" value={summary.plays} />
            <SummaryCard icon={Gamepad2} label="Giochi" value={summary.games} />
            <SummaryCard icon={Users} label="Player" value={summary.players} />
            <SummaryCard icon={UserRound} label="Account" value={summary.registrations} />
            <SummaryCard icon={MessageCircle} label="Commenti" value={summary.comments} />
          </section>

          <nav className="flex gap-2 overflow-x-auto border-b border-slate-700" aria-label="Sezioni amministrative">
            {sections.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={section === item.id}
                onClick={() => setSection(item.id)}
                className={`shrink-0 border-b-2 px-4 py-3 text-sm font-medium transition ${
                  section === item.id
                    ? 'border-emerald-400 text-emerald-300'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                {item.label}{item.count !== undefined && <span className="ml-2 text-xs text-slate-500">{item.count}</span>}
              </button>
            ))}
          </nav>

          {section === 'overview' && (
            <section className="grid gap-4 md:grid-cols-3" aria-label="Scorciatoie amministrative">
              <AdminShortcut title="Giocatori" description="Cerca e aggiorna i profili player registrati nell’app." onClick={() => setSection('players')} />
              <AdminShortcut title="Registrazioni" description="Consulta i nuovi account e i dati essenziali di accesso." onClick={() => setSection('registrations')} />
              <AdminShortcut title="Commenti" description="Esamina e rimuovi i commenti pubblicati sulle partite." onClick={() => setSection('comments')} />
            </section>
          )}

          {section === 'players' && (
            <AdminPlayers players={players} registrations={registrations} onUpdated={handlePlayerUpdated} onDeleted={handlePlayerDeleted} />
          )}
          {section === 'registrations' && <AdminRegistrations registrations={registrations} total={summary.registrations} />}
          {section === 'comments' && <AdminComments comments={comments} total={summary.comments} onDeleted={handleCommentDeleted} />}
        </>
      )}
    </div>
  )
}

interface SummaryCardProps {
  icon: LucideIcon
  label: string
  value: number
}

function SummaryCard({ icon: Icon, label, value }: SummaryCardProps) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800 p-5 shadow-md">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-slate-700 p-2.5 text-emerald-400">
          <Icon className="h-5 w-5" />
        </div>
        <p className="text-sm font-medium text-slate-400">{label}</p>
      </div>
      <p className="mt-4 text-3xl font-bold text-white">{value.toLocaleString('it-IT')}</p>
    </div>
  )
}

interface AdminShortcutProps {
  title: string
  description: string
  onClick: () => void
}

function AdminShortcut({ title, description, onClick }: AdminShortcutProps) {
  return (
    <button type="button" onClick={onClick} className="rounded-xl border border-slate-700 bg-slate-800 p-5 text-left transition hover:border-emerald-500/50 hover:bg-slate-800/80">
      <h2 className="font-semibold text-white">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">{description}</p>
    </button>
  )
}

interface AdminPlayersProps {
  players: DbPlayer[]
  registrations: DbAdminRegistration[]
  onUpdated: (player: DbPlayer) => void
  onDeleted: (playerId: string) => void
}

function AdminPlayers({ players, registrations, onUpdated, onDeleted }: AdminPlayersProps) {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<DbPlayer | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [aliasDraft, setAliasDraft] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const ownerById = useMemo(() => new Map(registrations.map((registration) => [registration.user_id, registration.email])), [registrations])
  const filteredPlayers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('it-IT')
    if (!query) return players
    return players.filter((player) => {
      const owner = player.user_id ? ownerById.get(player.user_id) ?? '' : ''
      return [player.name, player.alias ?? '', owner].some((value) => value.toLocaleLowerCase('it-IT').includes(query))
    })
  }, [players, ownerById, search])

  const beginEdit = (player: DbPlayer): void => {
    setEditing(player)
    setNameDraft(player.name)
    setAliasDraft(player.alias ?? '')
    setConfirmingId(null)
  }

  const saveEdit = async (): Promise<void> => {
    if (!editing || !nameDraft.trim()) {
      toast.error('Il nome del player è obbligatorio')
      return
    }

    setSaving(true)
    const { data, error } = await supabase
      .from('players')
      .update({ name: nameDraft.trim(), alias: aliasDraft.trim() || null })
      .eq('id', editing.id)
      .select('*')
      .single()

    if (error) {
      console.error('Error updating player in admin:', error)
      toast.error('Impossibile aggiornare il player')
    } else {
      onUpdated(data)
      setEditing(null)
      toast.success('Player aggiornato')
    }
    setSaving(false)
  }

  const deletePlayer = async (player: DbPlayer): Promise<void> => {
    setSaving(true)
    const { error } = await supabase.from('players').delete().eq('id', player.id)

    if (error) {
      console.error('Error deleting player in admin:', error)
      toast.error('Impossibile eliminare il player')
    } else {
      onDeleted(player.id)
      setConfirmingId(null)
      toast.success('Player eliminato')
    }
    setSaving(false)
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800 shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-700 p-5 sm:p-6">
        <div>
          <h2 className="text-xl font-bold text-white">Gestione player</h2>
          <p className="mt-1 text-sm text-slate-400">Modifica nome e alias, oppure rimuovi un profilo e i punteggi collegati.</p>
        </div>
        <label className="relative block w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cerca player o proprietario"
            aria-label="Cerca player"
            className="w-full rounded-lg border border-slate-600 bg-slate-900 py-2 pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>
      </div>

      {players.length === 0 ? (
        <p className="p-8 text-center text-slate-400">Non ci sono profili player.</p>
      ) : filteredPlayers.length === 0 ? (
        <p className="p-8 text-center text-slate-400">Nessun player corrisponde alla ricerca.</p>
      ) : (
        <ul className="divide-y divide-slate-700">
          {filteredPlayers.map((player) => {
            const owner = player.user_id ? ownerById.get(player.user_id) : null
            const isEditing = editing?.id === player.id
            const isConfirming = confirmingId === player.id

            return (
              <li key={player.id} className="p-5 sm:p-6">
                {isEditing ? (
                  <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
                    <label className="block text-xs font-medium text-slate-400">
                      Nome
                      <input value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} maxLength={120} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none" />
                    </label>
                    <label className="block text-xs font-medium text-slate-400">
                      Alias
                      <input value={aliasDraft} onChange={(event) => setAliasDraft(event.target.value)} maxLength={120} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none" />
                    </label>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => void saveEdit()} disabled={saving} className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"><Check className="h-4 w-4" />Salva</button>
                      <button type="button" onClick={() => setEditing(null)} disabled={saving} className="inline-flex items-center gap-1 rounded-lg bg-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-600"><X className="h-4 w-4" />Annulla</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-white">{player.alias || player.name}</p>
                      {player.alias && player.alias !== player.name && <p className="mt-1 text-sm text-slate-400">{player.name}</p>}
                      <p className="mt-1 truncate text-xs text-slate-500">Proprietario: {owner || 'Account non incluso tra i 500 più recenti'}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {isConfirming ? (
                        <>
                          <span className="text-xs text-amber-300">Eliminare anche i punteggi collegati?</span>
                          <button type="button" onClick={() => void deletePlayer(player)} disabled={saving} className="rounded-md px-2 py-1 text-xs font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">Conferma</button>
                          <button type="button" onClick={() => setConfirmingId(null)} disabled={saving} className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-700">Annulla</button>
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={() => beginEdit(player)} className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"><Pencil className="h-4 w-4" />Modifica</button>
                          <button type="button" onClick={() => { setConfirmingId(player.id); setEditing(null) }} className="inline-flex items-center gap-2 rounded-lg border border-red-400/30 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10"><Trash2 className="h-4 w-4" />Elimina</button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {players.length >= PAGE_SIZE && <p className="border-t border-slate-700 px-5 py-3 text-xs text-slate-500">Sono mostrati i primi {PAGE_SIZE} profili.</p>}
    </section>
  )
}

interface AdminRegistrationsProps {
  registrations: DbAdminRegistration[]
  total: number
}

function AdminRegistrations({ registrations, total }: AdminRegistrationsProps) {
  const [search, setSearch] = useState('')
  const filteredRegistrations = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('it-IT')
    if (!query) return registrations
    return registrations.filter((registration) =>
      (registration.email ?? '').toLocaleLowerCase('it-IT').includes(query) ||
      (registration.display_name ?? '').toLocaleLowerCase('it-IT').includes(query) ||
      registration.user_id.toLocaleLowerCase('it-IT').includes(query)
    )
  }, [registrations, search])

  return (
    <section className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800 shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-700 p-5 sm:p-6">
        <div>
          <h2 className="text-xl font-bold text-white">Registrazioni</h2>
          <p className="mt-1 text-sm text-slate-400">Elenco in sola lettura degli account, con stato email e ultimo accesso.</p>
        </div>
        <label className="relative block w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cerca nome, email o ID"
            aria-label="Cerca registrazioni"
            className="w-full rounded-lg border border-slate-600 bg-slate-900 py-2 pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>
      </div>
      {filteredRegistrations.length === 0 ? (
        <p className="p-8 text-center text-slate-400">Nessun account corrisponde alla ricerca.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead className="bg-slate-900/50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Account</th>
                <th className="px-5 py-3 font-medium">Registrazione</th>
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Ultimo accesso</th>
                <th className="px-5 py-3 font-medium">ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {filteredRegistrations.map((registration) => (
                <tr key={registration.user_id}>
                  <td className="px-5 py-4">
                    <p className="font-medium text-white">{registration.display_name || 'Senza nome'}</p>
                    <p className="mt-1 text-xs text-slate-500">{registration.email || 'Email non disponibile'}</p>
                  </td>
                  <td className="px-5 py-4 text-sm text-slate-300">{formatDate(registration.created_at)}</td>
                  <td className="px-5 py-4">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${registration.confirmed_at ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                      {registration.confirmed_at ? 'Confermata' : 'In attesa'}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-sm text-slate-300">{registration.last_sign_in_at ? formatDate(registration.last_sign_in_at) : 'Mai'}</td>
                  <td className="px-5 py-4 font-mono text-xs text-slate-500">{registration.user_id.slice(0, 8)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > registrations.length && <p className="border-t border-slate-700 px-5 py-3 text-xs text-slate-500">Mostrati {registrations.length} account su {total}.</p>}
    </section>
  )
}

interface AdminCommentsProps {
  comments: DbPlayComment[]
  total: number
  onDeleted: (commentId: string) => void
}

function AdminComments({ comments, total, onDeleted }: AdminCommentsProps) {
  const [search, setSearch] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const filteredComments = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('it-IT')
    if (!query) return comments
    return comments.filter((comment) =>
      comment.author_name.toLocaleLowerCase('it-IT').includes(query) ||
      comment.content.toLocaleLowerCase('it-IT').includes(query) ||
      comment.play_id.toLocaleLowerCase('it-IT').includes(query)
    )
  }, [comments, search])

  const deleteComment = async (commentId: string): Promise<void> => {
    setDeletingId(commentId)
    const { error } = await supabase.from('play_comments').delete().eq('id', commentId)

    if (error) {
      console.error('Error moderating play comment:', error)
      toast.error('Impossibile eliminare il commento')
    } else {
      onDeleted(commentId)
      setConfirmingId(null)
      toast.success('Commento eliminato')
    }
    setDeletingId(null)
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800 shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-700 p-5 sm:p-6">
        <div>
          <h2 className="text-xl font-bold text-white">Moderazione commenti</h2>
          <p className="mt-1 text-sm text-slate-400">Mostro i {Math.min(COMMENT_PAGE_SIZE, total)} commenti più recenti.</p>
        </div>
        <label className="relative block w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cerca autore o testo"
            aria-label="Cerca commenti"
            className="w-full rounded-lg border border-slate-600 bg-slate-900 py-2 pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>
      </div>
      {filteredComments.length === 0 ? (
        <p className="p-8 text-center text-slate-400">{comments.length ? 'Nessun commento corrisponde alla ricerca.' : 'Non ci sono commenti da moderare.'}</p>
      ) : (
        <ul className="divide-y divide-slate-700">
          {filteredComments.map((comment) => (
            <li key={comment.id} className="p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold text-white">{comment.author_name}</span>
                    <time dateTime={comment.created_at} className="text-xs text-slate-500">{formatDate(comment.created_at)}</time>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-300">{comment.content}</p>
                  <Link to={`/plays/${comment.play_id}`} className="mt-3 inline-flex items-center text-xs font-medium text-emerald-400 hover:text-emerald-300">
                    Apri partita <span className="ml-1" aria-hidden="true">↗</span>
                  </Link>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {confirmingId === comment.id ? (
                    <>
                      <span className="text-xs text-slate-400">Eliminare?</span>
                      <button type="button" onClick={() => void deleteComment(comment.id)} disabled={deletingId === comment.id} className="rounded-md px-2 py-1 text-xs font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-50">Conferma</button>
                      <button type="button" onClick={() => setConfirmingId(null)} className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-700">Annulla</button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirmingId(comment.id)} className="inline-flex items-center gap-2 rounded-lg border border-red-400/30 px-3 py-2 text-sm font-medium text-red-300 transition hover:bg-red-500/10">
                      <Trash2 className="h-4 w-4" /> Elimina
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default Admin
