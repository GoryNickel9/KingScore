import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Download, AlertCircle, CheckCircle, Loader2, Info, Users, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { updateELOAfterGame } from '../utils/eloCalculator'
import { XMLParser } from 'fast-xml-parser'

const LOG_CONFIG = {
  success: { icon: CheckCircle, iconClass: 'text-emerald-500', textClass: 'text-emerald-400' },
  error:   { icon: AlertCircle, iconClass: 'text-red-500',     textClass: 'text-red-400' },
  warning: { icon: AlertCircle, iconClass: 'text-yellow-500',  textClass: 'text-yellow-400' },
  info:    { icon: Info,        iconClass: 'text-blue-500',    textClass: 'text-slate-300' },
}

// ─── Levenshtein similarity ───────────────────────────────────────────────────
const levenshtein = (a, b) => {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  return dp[m][n]
}

const similarity = (a, b) => {
  if (!a || !b) return 0
  const dist = levenshtein(a.toLowerCase(), b.toLowerCase())
  return 1 - dist / Math.max(a.length, b.length)
}

// ─── BoardGameGeek (BGG) Image Fetcher ───────────────────────────────────────
const parser = new XMLParser()

const fetchGameImageFromBGG = async (gameName) => {
  try {
    // Search for the game on BGG
    const searchUrl = `https://boardgamegeek.com/xmlapi2/search?query=${encodeURIComponent(gameName)}&type=boardgame`
    const searchResponse = await fetch(searchUrl)
    const searchXml = await searchResponse.text()
    const searchResult = parser.parse(searchXml)

    // Check if we found any games
    const items = searchResult?.items?.item
    if (!items) return null

    // Get the first game ID (most relevant result)
    const gameId = Array.isArray(items) ? items[0].id : items.id
    if (!gameId) return null

    // Fetch game details including image
    const detailsUrl = `https://boardgamegeek.com/xmlapi2/thing?id=${gameId}&stats=1`
    const detailsResponse = await fetch(detailsUrl)
    const detailsXml = await detailsResponse.text()
    const detailsResult = parser.parse(detailsXml)

    // Extract image URL
    const items2 = detailsResult?.items?.item
    if (!items2) return null

    const game = Array.isArray(items2) ? items2[0] : items2
    return game?.image || null
  } catch (error) {
    console.error('Error fetching game image from BGG:', error)
    return null
  }
}

// Resolve "GoryNickel9112" → { name: "GoryNickel9", score: 112, autoResolved: bool }
const resolvePlayerString = (raw, knownNames) => {
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
  let best = { name: nameRaw || raw, score: parseInt(scoreStr, 10), autoResolved: false, similarityScore: 0 }
  for (const known of knownNames) {
    const sim = similarity(nameRaw, known)
    if (sim > best.similarityScore)
      best = { name: known, score: parseInt(scoreStr, 10), autoResolved: sim >= 0.9, similarityScore: sim }
  }
  return best
}

// ─── Parse raw text into plays with rawPlayers ────────────────────────────────
const parseLines = (txtContent) => {
  const lines = txtContent.split('\n').map(l => l.trim()).filter(Boolean)
  const parsedPlays = []
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

      let tableId = null
      if (i < lines.length && lines[i].startsWith('#')) { tableId = lines[i].trim(); i++ }

      let playedAt = null
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

      let durationMinutes = null
      if (i < lines.length && lines[i].includes('mn')) {
        const m = lines[i].match(/(\d+)\s*mn/)
        if (m) durationMinutes = parseInt(m[1], 10)
        i++
      }

      const rawPlayers = []
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

// ─── Disambiguation: one play at a time ──────────────────────────────────────
const DisambiguationStep = ({ plays, onConfirm }) => {
  // Only plays that have at least one unresolved player
  const playsToResolve = plays.filter(p => p.players.some(pl => !pl.autoResolved))
  const [currentIdx, setCurrentIdx] = useState(0)
  // confirmedMap: raw string → { name, score }
  const [confirmedMap, setConfirmedMap] = useState({})

  const currentPlay = playsToResolve[currentIdx]
  const isLast = currentIdx === playsToResolve.length - 1

  const getEntry = (player) => {
    if (confirmedMap[player.raw]) return confirmedMap[player.raw]
    return { name: player.name, score: player.score }
  }

  const updateEntry = (raw, field, value) => {
    setConfirmedMap(prev => {
      const current = prev[raw] ?? { name: '', score: 0 }
      return { ...prev, [raw]: { ...current, [field]: field === 'score' ? (parseInt(value) || 0) : value } }
    })
  }

  // Ensure all unresolved players have an entry initialized
  const ensureInit = () => {
    const toInit = {}
    currentPlay?.players.forEach(p => {
      if (!p.autoResolved && !confirmedMap[p.raw])
        toInit[p.raw] = { name: p.name, score: p.score }
    })
    if (Object.keys(toInit).length > 0)
      setConfirmedMap(prev => ({ ...toInit, ...prev }))
  }

  // Init on first render of each play
  useState(() => { ensureInit() })

  const handleNext = () => {
    // Init any missing entries for current play before moving on
    const snapshot = { ...confirmedMap }
    currentPlay?.players.forEach(p => {
      if (!p.autoResolved && !snapshot[p.raw])
        snapshot[p.raw] = { name: p.name, score: p.score }
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
          const isAutoOrConfirmed = player.autoResolved || (confirmedMap[player.raw] !== undefined && player.autoResolved)
          const isResolved = player.autoResolved || (confirmedMap[player.raw] !== undefined)
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
                    onChange={e => updateEntry(player.raw, 'name', e.target.value)}
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
                    onChange={e => updateEntry(player.raw, 'score', e.target.value)}
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
const Import = () => {
  const { user } = useAuth()
  const [txtContent, setTxtContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState([])
  const [result, setResult] = useState(null)
  const [step, setStep] = useState('input') // 'input' | 'disambiguate' | 'importing'
  const [pendingPlays, setPendingPlays] = useState([])

  const addLog = (message, type = 'info') =>
    setLogs(prev => [...prev, { timestamp: new Date().toLocaleTimeString('it-IT'), message, type }])

  // ── Step 1: parse and resolve what we can ────────────────────────────────
  const handleParse = async (e) => {
    e.preventDefault()
    setLoading(true)
    setLogs([])
    setResult(null)

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !session) throw new Error('Sessione scaduta. Effettua nuovamente il login.')
      if (!txtContent.trim()) throw new Error('Nessun contenuto incollato')

      addLog('Analisi del testo in corso...', 'info')

      const { data: knownPlayers } = await supabase.from('players').select('name, alias').eq('user_id', user.id)
      const knownNames = (knownPlayers || []).map(p => p.alias || p.name)
      addLog(`${knownNames.length} giocatori già conosciuti`, 'info')

      const parsedPlays = parseLines(txtContent)
      addLog(`Trovate ${parsedPlays.length} partite`, 'info')

      // Resolve players using known names
      const resolvedPlays = parsedPlays.map(play => ({
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
      addLog(`Errore: ${error.message}`, 'error')
      toast.error(error.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Step 2: apply confirmed map and import ───────────────────────────────
  const handleDisambiguationConfirm = async (confirmedMap) => {
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
  const runImport = async (plays, confirmedItems) => {
    setProgress(0)
    let imported = 0, skipped = 0, errors = 0

    try {
      // Persist newly confirmed player names
      for (const item of confirmedItems) {
        if (!item.name) continue
        const { data: existing } = await supabase.from('players').select('id')
          .eq('user_id', user.id).eq('name', item.name).maybeSingle()
        if (!existing) {
          await supabase.from('players').insert({ user_id: user.id, name: item.name, is_me: false })
          addLog(`Giocatore memorizzato: ${item.name}`, 'info')
        }
      }

      for (let i = 0; i < plays.length; i++) {
        const play = plays[i]
        setProgress(Math.round((i / plays.length) * 95))

        try {
          const { data: existing } = await supabase.from('plays').select('id')
            .eq('user_id', user.id).eq('bga_table_id', play.bga_table_id).maybeSingle()
          if (existing) { skipped++; continue }

          const { data: existingGame } = await supabase.from('games').select('id')
            .eq('name', play.game_name).maybeSingle()

          let gameId = existingGame?.id
          if (!gameId) {
            // Try to fetch game image from BGG
            const imageUrl = await fetchGameImageFromBGG(play.game_name)
            if (imageUrl) {
              addLog(`Immagine trovata per: ${play.game_name}`, 'info')
            } else {
              addLog(`Nessuna immagine trovata per: ${play.game_name}`, 'warning')
            }

            const { data: newGame } = await supabase.from('games')
              .insert({ name: play.game_name, bga_id: null, image_url: imageUrl }).select().single()
            if (newGame) { gameId = newGame.id; addLog(`Nuovo gioco: ${play.game_name}`, 'info') }
          }

          if (!gameId) { errors++; addLog(`Impossibile creare gioco per ${play.bga_table_id}`, 'error'); continue }

          const { data: newPlay, error: playError } = await supabase.from('plays')
            .insert({ user_id: user.id, game_id: gameId, played_at: play.played_at, location: play.location, duration_minutes: play.duration_minutes, source: 'offline', bga_table_id: play.bga_table_id })
            .select().single()

          if (playError) throw playError

          for (const p of play.players) {
            if (!p.name) continue
            const { data: existingPlayer } = await supabase.from('players').select('id')
              .eq('user_id', user.id).eq('name', p.name).maybeSingle()
            let pid = existingPlayer?.id
            if (!pid) {
              const { data: newPlayer } = await supabase.from('players')
                .insert({ user_id: user.id, name: p.name, is_me: false }).select().single()
              pid = newPlayer?.id
            }
            if (pid) {
              await supabase.from('play_scores').insert({
                play_id: newPlay.id,
                player_id: pid,
                score: p.score ?? null,
                winner: p.winner || false,
                position: p.position ? parseInt(p.position) : null
              })
            }
          }

          // Aggiorna l'ELO per questa partita
          try {
            const { data: playScores } = await supabase
              .from('play_scores')
              .select('*, players(*)')
              .eq('play_id', newPlay.id)

            if (playScores && playScores.length >= 2) {
              // Prepara i dati dei giocatori per il calcolo ELO
              const playersData = playScores.map((score) => {
                return {
                  playerId: score.player_id,
                  currentRating: 1000, // Verrà aggiornato da updateELOAfterGame
                  gamesPlayed: 0, // Verrà aggiornato da updateELOAfterGame
                  winner: score.winner || false,
                  position: score.position || undefined
                }
              })

              // Aggiorna gli ELO (incluso l'ELO Generale)
              await updateELOAfterGame(supabase, gameId, playersData, user.id)
            }
          } catch (eloError) {
            // Non bloccare l'importazione se l'aggiornamento ELO fallisce
            console.error('Errore nell\'aggiornamento ELO:', eloError)
          }

          imported++
        } catch (err) {
          errors++
          addLog(`Errore partita ${play.bga_table_id}: ${err.message}`, 'error')
        }
      }

      setProgress(100)
      addLog('Importazione completata!', 'success')
      setResult({ imported, skipped, errors, total: plays.length })
      toast.success(`Importazione completata! ${imported} partite importate`)
      setStep('input')
    } catch (error) {
      addLog(`Errore: ${error.message}`, 'error')
      toast.error(error.message)
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
                onChange={e => setTxtContent(e.target.value)}
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