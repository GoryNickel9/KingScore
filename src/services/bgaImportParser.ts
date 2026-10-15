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

export interface ResolveResult {
  name: string
  score: string | null
  autoResolved: boolean
  similarityScore: number
}

// Scores remain text from the initial parse through the immutable RPC arguments.
export const resolvePlayerString = (raw: string, knownNames: string[]): ResolveResult => {
  const exactName = knownNames.find(known => known.toLowerCase() === raw.trim().toLowerCase())
  if (exactName) return { name: exactName, score: null, autoResolved: false, similarityScore: 1 }
  const scoreMatch = raw.match(/(-?\d+(?:\.\d+)?)\s*$/)
  if (!scoreMatch) return { name: raw, score: null, autoResolved: false, similarityScore: 0 }

  const scoreStr = scoreMatch[1]
  const nameRaw = raw.slice(0, raw.lastIndexOf(scoreStr)).trim()

  if (knownNames.length === 0)
    return { name: nameRaw || raw, score: scoreStr, autoResolved: false, similarityScore: 0 }

  const prefixes = knownNames.filter(known => known && raw.toLowerCase().startsWith(known.toLowerCase()))
  const matches = prefixes.map(name => ({ name, score: raw.slice(name.length).trim() }))
    .filter(candidate => /^-?\d+(?:\.\d+)?$/.test(candidate.score))
    .sort((a, b) => b.name.length - a.name.length)
  if (matches.length) {
    return { ...matches[0], autoResolved: matches.length === 1, similarityScore: 1 }
  }

  // Fuzzy match on name portion
  let best: ResolveResult = { name: nameRaw || raw, score: scoreStr, autoResolved: false, similarityScore: 0 }
  for (const known of knownNames) {
    const sim = similarity(nameRaw, known)
    if (sim > best.similarityScore)
      best = { name: known, score: scoreStr, autoResolved: prefixes.length === 0 && sim >= 0.9, similarityScore: sim }
  }
  return best
}

export interface RawPlayer {
  position: string
  raw: string
  winner: boolean
}

export interface ParsedPlay {
  bga_table_id: string
  game_name: string
  played_at: string | null
  duration_minutes: number | null
  location: string | null
  rawPlayers: RawPlayer[]
}

export interface ResolvedPlayer extends RawPlayer, ResolveResult {}

export interface ResolvedPlay extends Omit<ParsedPlay, 'rawPlayers'> {
  players: ResolvedPlayer[]
}

// ─── Parse raw text into plays with rawPlayers ────────────────────────────────
export const parseLines = (txtContent: string, now: Date = new Date()): ParsedPlay[] => {
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
        const mFull = dateLine.match(/(?:^|[^\d])(\d{1,2})\/(\d{1,2})\/(\d{4})(?!\d).*?(\d{1,2}):(\d{2})/)
        const mTime = dateLine.match(/(\d{1,2}):(\d{2})/)
        const validTime = mTime && Number(mTime[1]) < 24 && Number(mTime[2]) < 60
        if (mFull && validTime) {
          const [, day, month, year] = mFull
          playedAt = `${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`
        } else if (validTime && /\b(oggi|ieri)\b/i.test(dateLine) && !dateLine.includes('/')) {
          const base = new Date(now.getTime())
          if (/\bieri\b/i.test(dateLine)) base.setDate(base.getDate() - 1)
          playedAt = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`
        }
        i++
      }

      let durationMinutes: number | null = null
      if (i < lines.length && lines[i].includes('mn')) {
        const m = lines[i].match(/^(-?\d+(?:\.\d+)?)\s*mn(?:\b|$)/)
        // Invalid supplied durations must fail validation rather than become missing values.
        durationMinutes = m ? Number(m[1]) : Number.NaN
        i++
      }

      const rawPlayers: RawPlayer[] = []
      while (i < lines.length) {
        const m = lines[i].match(/^(\d+)°\s*(.*)$/)
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
