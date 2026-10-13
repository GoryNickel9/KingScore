import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Download, AlertCircle, CheckCircle, Loader2, Info, Users, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { getErrorMessage } from '../utils/errors'
import { performFullRecalc } from '../utils/elo/recalc'
import { runBgaImport } from '../services/bgaImport'
import type { BgaImportResult } from '../services/bgaImport'

interface LogEntry {
  timestamp: string
  message: string
  type: LogType
}

type LogType = 'success' | 'error' | 'warning' | 'info'

interface LogConfig {
  icon: React.ComponentType<{ className?: string }>
  iconClass: string
  textClass: string
}

const LOG_CONFIG: Record<LogType, LogConfig> = {
  success: { icon: CheckCircle, iconClass: 'text-emerald-500', textClass: 'text-emerald-400' },
  error:   { icon: AlertCircle, iconClass: 'text-red-500',     textClass: 'text-red-400' },
  warning: { icon: AlertCircle, iconClass: 'text-yellow-500',  textClass: 'text-yellow-400' },
  info:    { icon: Info,        iconClass: 'text-blue-500',    textClass: 'text-slate-300' },
}

// ─── Levenshtein similarity ───────────────────────────────────────────────────
const levenshtein = (a: string, b: string): number => {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  return dp[m][n]
}

const similarity = (a: string, b: string): number => {
  if (!a || !b) return 0
  const dist = levenshtein(a.toLowerCase(), b.toLowerCase())
  return 1 - dist / Math.max(a.length, b.length)
}

// ─── BoardGameGeek (BGG): la fetch delle immagini vive in services/bgaImport.ts ─

interface ResolveResult {
  name: string
  score: number | null
  autoResolved: boolean
  similarityScore: number
}

// Resolve "GoryNickel9112" → { name: "GoryNickel9", score: 112, autoResolved: bool }
const resolvePlayerString = (raw: string, knownNames: string[]): ResolveResult => {
  const scoreMatch = raw.match(/(-?\d+)\s*$/)
  if (!scoreMatch) return { name: raw, score: null, autoResolved: false, similarityScore: 0 }

  const scoreStr = scoreMatch[1]
  const nameRaw = raw.slice(0, raw.lastIndexOf(scoreStr)).trim()

  if (knownNames.length === 0)
    return { name: nameRaw || raw, score: parseInt(scoreStr, 10), autoResolved: false, similarityScore: 0 }

  // Exact prefix match (most reliable)
  for (const known of knownNames) {
    if (raw.toLowerCase().startsWith(known.toLowerCase())) {
      const suffix = raw.slice(known.length).trim()
      if (/^-?\d+$/.test(suffix))
        return { name: known, score: parseInt(suffix, 10), autoResolved: true, similarityScore: 1 }
    }
  }

  // Fuzzy match on name portion
  let best: ResolveResult = { name: nameRaw || raw, score: parseInt(scoreStr, 10), autoResolved: false, similarityScore: 0 }
  for (const known of knownNames) {
    const sim = similarity(nameRaw, known)
    if (sim > best.similarityScore)
      best = { name: known, score: parseInt(scoreStr, 10), autoResolved: sim >= 0.9, similarityScore: sim }
  }
  return best
}

interface RawPlayer {
  position: string
  raw: string
  winner: boolean
}

interface ParsedPlay {
  bga_table_id: string
  game_name: string
  played_at: string | null
  duration_minutes: number | null
  location: string | null
  rawPlayers: RawPlayer[]
}

interface ResolvedPlayer extends RawPlayer, ResolveResult {}

interface ResolvedPlay extends Omit<ParsedPlay, 'rawPlayers'> {
  players: ResolvedPlayer[]
}

// ─── Parse raw text into plays with rawPlayers ────────────────────────────────
const parseLines = (txtContent: string): ParsedPlay[] => {
  const lines = txtContent.split('\n').map((l: string) => l.trim()).filter(Boolean)
  const parsedPlays: ParsedPlay[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const skip = ['Storico delle partite', 'Visualizza di più']
    const isGameName = line
      && !line.startsWith('#')
      && !line.match(/^\d+°/)
      && !line.startsWith('(')
      && !line.includes('alle ore')
      && !line.includes('mn')
      && !line.includes('→')
      && !skip.includes(line)

    if (isGameName) {
      const gameName = line; i++

      let tableId: string | null = null
      if (i < lines.length && lines[i].startsWith('#')) { tableId = lines[i].trim(); i++ }

      let playedAt: string | null = null
      if (i < lines.length && lines[i].includes('alle ore')) {
        const dateLine = lines[i]
        const mFull = dateLine.match(/(\d{1,2})\/(\d{1,2})\/(\d{4}).*?(\d{1,2}):(\d{2})/)
        const mTime = dateLine.match(/(\d{1,2}):(\d{2})/)
        if (mFull) {
          const [, day, month, year, hour, minute] = mFull
          playedAt = new Date(`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}T${hour.padStart(2,'0')}:${minute.padStart(2,'0')}:00`).toISOString()
        } else if (mTime) {
          const [, hour, minute] = mTime
          const base = new Date()
          if (dateLine.includes('ieri')) base.setDate(base.getDate() - 1)
          base.setHours(parseInt(hour), parseInt(minute), 0, 0)
          playedAt = base.toISOString()
        }
        i++
      }

      let durationMinutes: number | null = null
      if (i < lines.length && lines[i].includes('mn')) {
        const m = lines[i].match(/(\d+)\s*mn/)
        if (m) durationMinutes = parseInt(m[1], 10)
        i++
      }

      const rawPlayers: RawPlayer[] = []
      while (i < lines.length) {
        const m = lines[i].match(/^(\d+)°\s*(.+)$/)
        if (m) { rawPlayers.push({ position: m[1], raw: m[2].trim(), winner: m[1] === '1' }); i++ }
        else break
      }
      while (i < lines.length && lines[i].includes('→')) i++

      if (gameName && tableId)
        parsedPlays.push({ bga_table_id: tableId, game_name: gameName, played_at: playedAt, duration_minutes: durationMinutes, location: null, rawPlayers })
    } else {
      i++
    }
  }
  return parsedPlays
}

interface ConfirmedEntry {
  name: string
  score: number
}

interface DisambiguationStepProps {
  plays: ResolvedPlay[]
  onConfirm: (confirmedMap: Record<string, ConfirmedEntry>) => void
}

// ─── Disambiguation: one play at a time ──────────────────────────────────────
const DisambiguationStep = ({ plays, onConfirm }: DisambiguationStepProps) => {
  // Only plays that have at least one unresolved player
  const playsToResolve = plays.filter(p => p.players.some(pl => !pl.autoResolved))
  const [currentIdx, setCurrentIdx] = useState<number>(0)
  // confirmedMap: raw string → { name, score }
  const [confirmedMap, setConfirmedMap] = useState<Record<string, ConfirmedEntry>>({})

  const currentPlay = playsToResolve[currentIdx]
  const isLast = currentIdx === playsToResolve.length - 1

  const getEntry = (player: ResolvedPlayer): ConfirmedEntry => {
    if (confirmedMap[player.raw]) return confirmedMap[player.raw]
    return { name: player.name, score: player.score ?? 0 }
  }

  const updateEntry = (raw: string, field: keyof ConfirmedEntry, value: string): void => {
    setConfirmedMap(prev => {
      const current = prev[raw] ?? { name: '', score: 0 }
      return { ...prev, [raw]: { ...current, [field]: field === 'score' ? (parseInt(value) || 0) : value } }
    })
  }

  // Ensure all unresolved players have an entry initialized
  const ensureInit = () => {
    const toInit: Record<string, ConfirmedEntry> = {}
    currentPlay?.players.forEach(p => {
      if (!p.autoResolved && !confirmedMap[p.raw])
        toInit[p.raw] = { name: p.name, score: p.score ?? 0 }
    })
    if (Object.keys(toInit).length > 0)
      setConfirmedMap(prev => ({ ...toInit, ...prev }))
  }

  // Init on first render of each play
  useState(() => { ensureInit() })

  const handleNext = (): void => {
    // Init any missing entries for current play before moving on
    const snapshot = { ...confirmedMap }
    currentPlay?.players.forEach(p => {
      if (!p.autoResolved && !snapshot[p.raw])
        snapshot[p.raw] = { name: p.name, score: p.score ?? 0 }
    })
    setConfirmedMap(snapshot)

    if (isLast) {
      onConfirm(snapshot)
    } else {
      setCurrentIdx(i => i + 1)
    }
  }

  const playedDate = currentPlay?.played_at
    ? new Date(currentPlay.played_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : null

  return (
    <div className="bg-slate-800 rounded-xl p-6 shadow-md space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center space-x-3">
          <Users className="w-6 h-6 text-yellow-400 flex-shrink-0" />
          <div>
            <h2 className="text-xl font-bold text-white">Conferma nomi giocatori</h2>
            <p className="text-sm text-slate-400">
              Correggi nome e punteggio. Le stesse stringhe nelle altre partite verranno risolte automaticamente.
            </p>
          </div>
        </div>
        <span className="text-sm text-slate-500 flex-shrink-0 mt-1">
          {currentIdx + 1} / {playsToResolve.length}
        </span>
      </div>

      {/* Progress bar */}
      <div className="flex gap-1.5">
        {playsToResolve.map((_, i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${i < currentIdx ? 'bg-emerald-500' : i === currentIdx ? 'bg-emerald-400' : 'bg-slate-600'}`} />
        ))}
      </div>

      {/* Play info */}
      <div className="bg-slate-700/50 rounded-lg px-4 py-3 flex items-center gap-4">
        <div>
          <p className="text-white font-semibold">{currentPlay?.game_name}</p>
          {playedDate && <p className="text-xs text-slate-400 mt-0.5">{playedDate}</p>}
        </div>
        {currentPlay?.duration_minutes && (
          <span className="ml-auto text-xs text-slate-400">{currentPlay.duration_minutes} min</span>
        )}
      </div>

      {/* Players list */}
      <div className="space-y-3">
        {currentPlay?.players.map((player, idx) => {
          const entry = getEntry(player)
          const needsInput = !player.autoResolved

          return (
            <div key={idx} className={`rounded-lg p-4 flex items-center gap-3 flex-wrap transition-opacity ${needsInput ? 'bg-slate-700/70 border border-slate-500' : 'bg-slate-700/30 opacity-50'}`}>
              {/* Position badge */}
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${player.position === '1' ? 'bg-yellow-500 text-slate-900' : 'bg-slate-600 text-white'}`}>
                {player.position}
              </div>

              {/* Original string */}
              <div className="flex-1 min-w-28">
                <p className="text-xs text-slate-400 mb-0.5">Originale</p>
                <code className="text-emerald-400 text-xs font-mono">{player.raw}</code>
              </div>

              <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0" />

              {/* Name */}
              <div className="flex-1 min-w-36">
                <p className="text-xs text-slate-400 mb-0.5">Nome giocatore</p>
                {needsInput ? (
                  <input
                    type="text"
                    value={entry.name}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateEntry(player.raw, 'name', e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-600 border border-slate-500 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                ) : (
                  <span className="text-white text-sm">{entry.name}</span>
                )}
              </div>

              {/* Score */}
              <div className="w-24">
                <p className="text-xs text-slate-400 mb-0.5">Punteggio</p>
                {needsInput ? (
                  <input
                    type="number"
                    value={entry.score ?? ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateEntry(player.raw, 'score', e.target.value)}
                    className="w-full px-2 py-1.5 bg-slate-600 border border-slate-500 rounded text-white text-sm font-mono text-right focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                ) : (
                  <span className="text-white font-mono text-sm">{entry.score}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <button
        onClick={handleNext}
        className="w-full flex justify-center items-center py-3 px-4 rounded-lg text-white bg-emerald-500 hover:bg-emerald-600 transition font-medium"
      >
        {isLast
          ? <><Download className="w-5 h-5 mr-2" />Conferma e Importa</>
          : <><ChevronRight className="w-5 h-5 mr-2" />Prossima partita</>
        }
      </button>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
type ImportStep = 'input' | 'disambiguate' | 'importing'

const Import = () => {
  const { user } = useAuth()
  const [txtContent, setTxtContent] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [progress, setProgress] = useState<number>(0)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [result, setResult] = useState<BgaImportResult | null>(null)
  const [step, setStep] = useState<ImportStep>('input')
  const [pendingPlays, setPendingPlays] = useState<ResolvedPlay[]>([])

  const addLog = (message: string, type: LogType = 'info'): void =>
    setLogs(prev => [...prev, { timestamp: new Date().toLocaleTimeString('it-IT'), message, type }])

  // ── Step 1: parse and resolve what we can ────────────────────────────────
  const handleParse = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setLoading(true)
    setLogs([])
    setResult(null)

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !session) throw new Error('Sessione scaduta. Effettua nuovamente il login.')
      if (!txtContent.trim()) throw new Error('Nessun contenuto incollato')

      addLog('Analisi del testo in corso...', 'info')

      const { data: knownPlayers } = await supabase.from('players').select('name, alias').eq('user_id', user!.id)
      const knownNames = (knownPlayers || []).map((p: { name: string; alias?: string | null }) => p.alias || p.name)
      addLog(`${knownNames.length} giocatori già conosciuti`, 'info')

      const parsedPlays = parseLines(txtContent)
      addLog(`Trovate ${parsedPlays.length} partite`, 'info')

      // Resolve players using known names
      const resolvedPlays: ResolvedPlay[] = parsedPlays.map(play => ({
        ...play,
        players: play.rawPlayers.map(rp => {
          const resolved = resolvePlayerString(rp.raw, knownNames)
          return { ...rp, ...resolved }
        })
      }))

      const needsDisambiguation = resolvedPlays.some(p => p.players.some(pl => !pl.autoResolved))

      setPendingPlays(resolvedPlays)

      if (needsDisambiguation) {
        const count = resolvedPlays.filter(p => p.players.some(pl => !pl.autoResolved)).length
        addLog(`${count} partite con nomi da confermare`, 'warning')
        setStep('disambiguate')
      } else {
        addLog('Tutti i nomi risolti automaticamente!', 'success')
        await runImport(resolvedPlays, [])
      }
    } catch (error) {
      addLog(`Errore: ${getErrorMessage(error)}`, 'error')
      toast.error(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  // ── Step 2: apply confirmed map and import ───────────────────────────────
  const handleDisambiguationConfirm = async (confirmedMap: Record<string, ConfirmedEntry>): Promise<void> => {
    // confirmedMap: { raw → { name, score } }
    setStep('importing')
    setLoading(true)

    const resolvedPlays = pendingPlays.map(play => ({
      ...play,
      players: play.players.map(p => {
        if (!p.autoResolved && confirmedMap[p.raw]) {
          return { ...p, name: confirmedMap[p.raw].name, score: confirmedMap[p.raw].score }
        }
        return p
      })
    }))

    // Collect unique confirmed entries to persist
    const confirmed = Object.entries(confirmedMap).map(([raw, val]) => ({ raw, ...val }))
    await runImport(resolvedPlays, confirmed)
  }

  // ── Core import ───────────────────────────────────────────────────────────
  // La persistenza (con pre-caricamento anti-N+1) vive in services/bgaImport.ts
  const runImport = async (plays: ResolvedPlay[], confirmedItems: (ConfirmedEntry & { raw: string })[]): Promise<void> => {
    try {
      const result = await runBgaImport(supabase, user!.id, plays, confirmedItems, {
        onLog: addLog,
        onProgress: setProgress
      })

      // Un solo ricalcolo ELO completo a fine import, con i rating correnti.
      // Fix TD-001: prima ogni partita aggiornava l'ELO "a caldo" partendo da
      // rating 1000. Fix TD-005: la cache elo_history non veniva mai
      // rigenerata dopo l'import; performFullRecalc la ricostruisce.
      if (result.imported > 0) {
        try {
          await performFullRecalc(supabase, user!.id)
        } catch (eloError) {
          addLog(`ELO non ricalcolato: ${getErrorMessage(eloError)} (verrà corretto dal ricalcolo notturno)`, 'warning')
        }
      }

      setResult(result)
      if (result.uncertain) {
        addLog(`Import interrotto: ${result.uncertain} esito incerto, ${result.unprocessed ?? 0} partite non inviate. Verifica lo storico prima di riprovare.`, 'warning')
        toast.error('Import interrotto: verifica la partita dall’esito incerto')
      } else if (result.errors > 0) {
        addLog(`Import concluso con ${result.errors} errori e ${result.imported} partite importate.`, 'warning')
        toast.error(`Import concluso con ${result.errors} errori: controlla il riepilogo`)
      } else {
        addLog('Importazione completata!', 'success')
        toast.success(`Importazione completata! ${result.imported} partite importate`)
      }
      setStep('input')
    } catch (error) {
      addLog(`Errore: ${getErrorMessage(error)}`, 'error')
      toast.error(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Import partite</h1>
        <p className="mt-2 text-slate-400">Importa le tue partite.</p>
      </div>

      {/* Step: input */}
      {step === 'input' && (
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <form onSubmit={handleParse} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Incolla il contenuto
              </label>
              <textarea
                rows={10}
                value={txtContent}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setTxtContent(e.target.value)}
                placeholder="Incolla qui il contenuto"
                className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-xs resize-none"
                disabled={loading}
                required
              />
            </div>
            <button
              type="submit" disabled={loading}
              className="w-full flex justify-center items-center py-3 px-4 rounded-lg text-white bg-emerald-500 hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 transition disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {loading
                ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Analisi in corso...</>
                : <><Download className="w-5 h-5 mr-2" />Analizza e Importa</>
              }
            </button>
          </form>
        </div>
      )}

      {/* Step: disambiguate */}
      {step === 'disambiguate' && (
        <DisambiguationStep
          plays={pendingPlays}
          onConfirm={handleDisambiguationConfirm}
        />
      )}

      {/* Progress bar (importing) */}
      {loading && step === 'importing' && (
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-300">Progresso</span>
            <span className="text-sm font-medium text-white">{Math.round(progress)}%</span>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-3">
            <div className="bg-emerald-500 h-3 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {/* Logs */}
      {logs.length > 0 && (
        <div className="bg-slate-800 rounded-xl p-6 shadow-md">
          <h2 className="text-xl font-bold text-white mb-4">Log Importazione</h2>
          <div className="bg-slate-900 rounded-lg p-4 max-h-96 overflow-y-auto space-y-2">
            {logs.map((log, i) => {
              const { icon: Icon, iconClass, textClass } = LOG_CONFIG[log.type] || LOG_CONFIG.info
              return (
                <div key={i} className="flex items-start space-x-2 text-sm">
                  <span className="text-slate-500 flex-shrink-0">{log.timestamp}</span>
                  <Icon className={`w-4 h-4 ${iconClass} flex-shrink-0`} />
                  <span className={textClass}>{log.message}</span>
                </div>
              )
            })}
          </div>

          {result && (
            <div className="mt-6 p-4 bg-slate-700 rounded-lg">
              <h3 className="text-lg font-semibold text-white mb-3">Riepilogo</h3>
              <div className="grid grid-cols-3 gap-4 text-center">
                {[
                  { value: result.imported, label: 'Importate', color: 'text-emerald-500' },
                  { value: result.skipped,  label: 'Duplicate', color: 'text-yellow-500' },
                  { value: result.errors,   label: 'Errori',    color: 'text-red-500' },
                  ...(result.uncertain ? [
                    { value: result.uncertain, label: 'Esito incerto', color: 'text-amber-400' },
                    { value: result.unprocessed ?? 0, label: 'Non inviate', color: 'text-slate-400' },
                  ] : []),
                ].map(({ value, label, color }) => (
                  <div key={label}>
                    <div className={`text-3xl font-bold ${color}`}>{value}</div>
                    <div className="text-sm text-slate-400">{label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default Import
