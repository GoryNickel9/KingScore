import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ClipboardCheck, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Pagination } from '../components/Pagination'
import { Spinner } from '../components/Spinner'
import { fetchAllPages } from '../utils/pagination'
import { checkPlayCompleteness } from '../utils/playCompleteness'
import { getErrorMessage } from '../utils/errors'
import type { DbPlay, DbPlayScore } from '../types/rows'

type CheckedPlay = Pick<DbPlay, 'id' | 'played_at' | 'duration_minutes' | 'is_cooperative' | 'team_won'> & {
  games: { name: string } | null
  play_scores: (Pick<DbPlayScore, 'score' | 'winner'> & { players: { name: string; alias: string | null } | null })[]
}

const checks = [
  { key: 'duration', label: 'Durata' },
  { key: 'winners', label: 'Vincitori' },
  { key: 'scores', label: 'Punteggi' },
] as const
type CheckKey = typeof checks[number]['key']
const PAGE_SIZE = 20

export default function PlayChecks() {
  const [snapshot, setSnapshot] = useState<{ plays: CheckedPlay[]; checkedAt: Date } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [filter, setFilter] = useState<CheckKey | 'all'>('all')
  const [page, setPage] = useState(1)

  useEffect(() => {
    let current = true
    const load = async () => {
      try {
        const plays = await fetchAllPages((from, to) => supabase.from('plays')
          .select('id,played_at,duration_minutes,is_cooperative,team_won,games(name),play_scores(score,winner,players(name,alias))', { count: 'exact' })
          .order('played_at', { ascending: false }).order('id').range(from, to))
        if (current) setSnapshot({ plays, checkedAt: new Date() })
      } catch (cause) {
        if (current) setError(getErrorMessage(cause))
      } finally {
        if (current) setLoading(false)
      }
    }
    void load()
    return () => { current = false }
  }, [refresh])

  const results = (snapshot?.plays ?? []).map(play => ({ play, checks: checkPlayCompleteness(play) }))
  const incomplete = results.filter(result => checks.some(check => !result.checks[check.key]))
  const filtered = incomplete.filter(result => filter === 'all' || !result.checks[filter])
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const reload = () => {
    setLoading(true)
    setError(null)
    setPage(1)
    setRefresh(value => value + 1)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold text-white">
            <ClipboardCheck aria-hidden="true" className="h-7 w-7 shrink-0 text-emerald-400" />
            Controllo partite
          </h1>
          <p className="mt-2 text-slate-400">Verifica durata, vincitori e punteggi di tutte le partite registrate.</p>
        </div>
        <button type="button" onClick={reload} disabled={loading}
          className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-700 px-4 py-2 font-medium text-white transition hover:bg-slate-600 disabled:cursor-wait disabled:opacity-50">
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          Ricontrolla
        </button>
      </div>

      <p className="text-sm leading-relaxed text-slate-400">
        La durata deve essere un numero intero di minuti maggiore di zero. Nei cooperativi serve l’esito del gruppo,
        anche in caso di sconfitta. Ogni partecipante deve avere un punteggio numerico; lo zero è valido.
      </p>

      {loading ? (
        <div role="status"><span className="sr-only">Controllo delle partite in corso</span><Spinner className="h-64" /></div>
      ) : error ? (
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-5 text-red-200">
          <p className="font-semibold">Controllo non completato</p>
          <p className="mt-1 break-words">{error}</p>
          <p className="mt-2 text-sm">Premi «Ricontrolla» per riprovare.</p>
        </div>
      ) : snapshot && (
        <>
          <div role="status" className="text-sm text-slate-300">
            {results.length} partite controllate · {results.length - incomplete.length} complete · {incomplete.length} da correggere
            <span className="mt-1 block text-slate-400">Ultimo controllo: {snapshot.checkedAt.toLocaleString('it-IT')}</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {checks.map(check => {
              const count = results.filter(result => !result.checks[check.key]).length
              return (
                <button key={check.key} type="button" aria-pressed={filter === check.key}
                  onClick={() => { setFilter(value => value === check.key ? 'all' : check.key); setPage(1) }}
                  className={`rounded-xl border bg-slate-800 p-5 text-left transition hover:border-emerald-400 ${filter === check.key ? 'border-emerald-400' : 'border-slate-700'}`}>
                  <span className="block font-medium text-slate-300">{check.label}</span>
                  <span className={`mt-2 block text-3xl font-bold ${count ? 'text-amber-300' : 'text-emerald-400'}`}>{count}</span>
                  <span className="mt-1 block text-sm text-slate-400">{count === 1 ? 'partita da correggere' : count ? 'partite da correggere' : 'nessuna anomalia'}</span>
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-white">Partite da correggere ({filtered.length})</h2>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              Mostra
              <select value={filter} onChange={event => { setFilter(event.target.value as CheckKey | 'all'); setPage(1) }}
                className="min-h-11 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white">
                <option value="all">Tutte le anomalie</option>
                {checks.map(check => <option key={check.key} value={check.key}>{check.label}</option>)}
              </select>
            </label>
          </div>

          {filtered.length === 0 ? (
            <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-slate-800 p-6 text-slate-200">
              <CheckCircle2 aria-hidden="true" className="h-6 w-6 shrink-0 text-emerald-400" />
              <p>{results.length === 0 ? 'Non ci sono partite da controllare.' : incomplete.length === 0
                ? 'Tutte le partite hanno durata, esito e punteggi compilati.' : 'Nessuna anomalia per il controllo selezionato.'}</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {visible.map(({ play, checks: status }) => (
                <li key={play.id} className="rounded-xl border border-slate-700 bg-slate-800 p-5">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div className="min-w-0">
                      <Link to={`/plays/${play.id}`} className="break-words text-lg font-semibold text-white hover:text-emerald-300">
                        {play.games?.name ?? 'Gioco non disponibile'}
                      </Link>
                      <p className="mt-1 text-sm text-slate-400">{new Date(play.played_at).toLocaleDateString('it-IT')}</p>
                    </div>
                    <Link to={`/plays/${play.id}/edit`} aria-label={`Correggi ${play.games?.name ?? 'partita'} del ${new Date(play.played_at).toLocaleDateString('it-IT')}`}
                      className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-emerald-500 px-4 py-2 font-medium text-white transition hover:bg-emerald-600">
                      Correggi partita
                    </Link>
                  </div>
                  <ul className="mt-3 space-y-1 text-sm text-amber-200">
                    {!status.duration && <li>Durata: {play.duration_minutes === null ? 'mancante' : `non valida (${play.duration_minutes} min)`}.</li>}
                    {!status.winners && <li>{play.is_cooperative ? 'Vincitori: esito del gruppo mancante.' : 'Vincitori: nessun vincitore indicato.'}</li>}
                    {!status.scores && <li>Punteggi: {play.play_scores.length === 0 ? 'nessun partecipante registrato' :
                      `mancanti o non validi per ${play.play_scores.filter(score => score.score === null || !Number.isFinite(score.score))
                        .map(score => score.players?.alias || score.players?.name || 'Giocatore non disponibile').join(', ')}`}.</li>}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          <Pagination currentPage={page} totalPages={Math.ceil(filtered.length / PAGE_SIZE)} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}
