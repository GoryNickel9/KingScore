import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Gamepad2, MessageCircle, RefreshCw, Search, ShieldCheck, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { Spinner } from '../components/Spinner'
import { supabase } from '../lib/supabase'
import type { DbPlayComment } from '../types/rows'

interface AdminSummary {
  plays: number
  games: number
  comments: number
}

const PAGE_SIZE = 100

async function fetchAdminDashboardData(): Promise<{ summary: AdminSummary; comments: DbPlayComment[] }> {
  const [playsResult, gamesResult, commentsResult] = await Promise.all([
    supabase.from('plays').select('id', { count: 'exact', head: true }),
    supabase.from('games').select('id', { count: 'exact', head: true }),
    supabase
      .from('play_comments')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE),
  ])

  const error = playsResult.error ?? gamesResult.error ?? commentsResult.error
  if (error) throw error

  return {
    summary: {
      plays: playsResult.count ?? 0,
      games: gamesResult.count ?? 0,
      comments: commentsResult.count ?? 0,
    },
    comments: commentsResult.data ?? [],
  }
}

function formatDate(date: string): string {
  return new Date(date).toLocaleString('it-IT', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

const Admin = () => {
  const [summary, setSummary] = useState<AdminSummary>({ plays: 0, games: 0, comments: 0 })
  const [comments, setComments] = useState<DbPlayComment[]>([])
  const [search, setSearch] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState(false)

  const loadDashboard = useCallback(async (): Promise<void> => {
    setRefreshing(true)
    setLoadError(false)

    try {
      const dashboard = await fetchAdminDashboardData()
      setSummary(dashboard.summary)
      setComments(dashboard.comments)
    } catch (error) {
      console.error('Error loading admin dashboard:', error)
      setLoadError(true)
      toast.error('Impossibile caricare i dati amministrativi')
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    let isCurrent = true
    void fetchAdminDashboardData()
      .then((dashboard) => {
        if (!isCurrent) return
        setSummary(dashboard.summary)
        setComments(dashboard.comments)
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
  }, [])

  const filteredComments = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('it-IT')
    if (!query) return comments
    return comments.filter((comment) =>
      comment.author_name.toLocaleLowerCase('it-IT').includes(query) ||
      comment.content.toLocaleLowerCase('it-IT').includes(query) ||
      comment.play_id.toLocaleLowerCase('it-IT').includes(query)
    )
  }, [comments, search])

  const handleDelete = async (commentId: string): Promise<void> => {
    setDeletingId(commentId)
    const { error } = await supabase
      .from('play_comments')
      .delete()
      .eq('id', commentId)

    if (error) {
      console.error('Error moderating play comment:', error)
      toast.error('Impossibile eliminare il commento')
    } else {
      setComments((current) => current.filter((comment) => comment.id !== commentId))
      setSummary((current) => ({ ...current, comments: Math.max(0, current.comments - 1) }))
      setConfirmingId(null)
      toast.success('Commento eliminato')
    }
    setDeletingId(null)
  }

  if (loading) return <Spinner className="h-64" />

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
            <p className="mt-1 text-slate-400">Riepilogo e moderazione dei commenti.</p>
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

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3" aria-label="Riepilogo">
        <SummaryCard icon={CalendarDays} label="Partite registrate" value={summary.plays} />
        <SummaryCard icon={Gamepad2} label="Giochi" value={summary.games} />
        <SummaryCard icon={MessageCircle} label="Commenti" value={summary.comments} />
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800 shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-700 p-5 sm:p-6">
          <div>
            <h2 className="text-xl font-bold text-white">Moderazione commenti</h2>
            <p className="mt-1 text-sm text-slate-400">
              Mostro i {Math.min(PAGE_SIZE, summary.comments)} commenti più recenti.
            </p>
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

        {loadError ? (
          <div className="p-8 text-center">
            <p className="mb-3 text-slate-300">Non riesco a caricare i dati del pannello.</p>
            <button type="button" onClick={() => void loadDashboard()} className="text-sm font-medium text-emerald-400 hover:text-emerald-300">
              Riprova
            </button>
          </div>
        ) : filteredComments.length === 0 ? (
          <p className="p-8 text-center text-slate-400">
            {comments.length === 0 ? 'Non ci sono commenti da moderare.' : 'Nessun commento corrisponde alla ricerca.'}
          </p>
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
                        <button
                          type="button"
                          onClick={() => void handleDelete(comment.id)}
                          disabled={deletingId === comment.id}
                          className="rounded-md px-2 py-1 text-xs font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          Conferma
                        </button>
                        <button type="button" onClick={() => setConfirmingId(null)} className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-700">
                          Annulla
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingId(comment.id)}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-400/30 px-3 py-2 text-sm font-medium text-red-300 transition hover:bg-red-500/10"
                      >
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
    </div>
  )
}

interface SummaryCardProps {
  icon: typeof CalendarDays
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

export default Admin
