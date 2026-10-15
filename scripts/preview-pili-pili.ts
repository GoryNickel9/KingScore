/** Anteprima locale: tutte le richieste HTTP diverse da GET sono bloccate. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { config } from 'dotenv'
import { build } from 'esbuild'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/db.ts'
import { PILI_PILI_GAME_ID } from '../src/utils/elo/gameRules.ts'
import { assignPositions } from '../src/utils/elo/positions.ts'
import { simulateAllPlays } from '../src/utils/elo/simulation.ts'
import type { SimulationPlay, SimulationResult } from '../src/utils/elo/simulation.ts'
import { fetchAllPages } from '../src/utils/pagination.ts'

config({ path: '.env.local', quiet: true })

async function main(): Promise<void> {
  const baselineRef = process.argv[2]
  if (!baselineRef || !/^[a-f0-9]{40}$/.test(baselineRef)) {
    throw new Error('Uso: node --experimental-strip-types scripts/preview-pili-pili.ts <commit SHA completo> [output.json]')
  }
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Configurazione Supabase mancante in .env.local')

  let getRequests = 0
  const readOnlyFetch: typeof fetch = (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    if (method !== 'GET') throw new Error(`Anteprima in sola lettura: richiesta ${method} bloccata`)
    getRequests++
    return fetch(input, init)
  }
  assert.throws(() => readOnlyFetch(url, { method: 'POST' }), /richiesta POST bloccata/)
  const supabase = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: readOnlyFetch },
  })

  // Il motore precedente viene compilato da Git, incluse le sue dipendenze.
  // Non importa positions.ts dal working tree modificato.
  const sourcePath = 'src/utils/elo/simulation.ts'
  const source = execFileSync('git', ['show', `${baselineRef}:${sourcePath}`], { encoding: 'utf8' })
  const bundle = await build({
    stdin: { contents: source, loader: 'ts', resolveDir: dirname(resolve(sourcePath)) },
    bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{
      name: 'git-baseline',
      setup(builder) {
        builder.onLoad({ filter: /[\\/]src[\\/]utils[\\/]elo[\\/].*\.ts$/ }, args => {
          const relative = args.path.slice(resolve('.').length + 1).replace(/\\/g, '/')
          return {
            contents: execFileSync('git', ['show', `${baselineRef}:${relative}`], { encoding: 'utf8' }),
            loader: 'ts', resolveDir: dirname(args.path),
          }
        })
      },
    }],
  })
  const baseline = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`) as {
    simulateAllPlays: (plays: SimulationPlay[]) => SimulationResult
  }

  const readPiliPlays = () => fetchAllPages((from, to) => supabase.from('plays')
    .select('id,user_id,game_id,played_at,games(lower_score_wins,shared_score_positions),play_scores(player_id,winner,position,score,players(name,alias))', { count: 'exact' })
    .eq('game_id', PILI_PILI_GAME_ID)
    .order('played_at', { ascending: true }).order('id', { ascending: true }).range(from, to))
  const piliPlays = await readPiliPlays()
  if (!piliPlays.length) throw new Error('Nessuna partita di Pili Pili accessibile')
  assert(piliPlays.every(play => play.user_id), 'Partita senza proprietario: impossibile separare gli storici')
  const ownerIds = [...new Set(piliPlays.map(play => play.user_id!))]
  const storedRatings = await fetchAllPages((from, to) => supabase.from('player_ratings')
    .select('player_id,rating,games_played', { count: 'exact' }).eq('game_id', PILI_PILI_GAME_ID)
    .order('player_id').range(from, to))
  const storedHistory = await fetchAllPages((from, to) => supabase.from('elo_history')
    .select('play_id,player_id,rating,rating_change', { count: 'exact' })
    .eq('game_id', PILI_PILI_GAME_ID).eq('is_general', false)
    .order('play_id').order('player_id').range(from, to))
  const results = []

  for (const ownerId of ownerIds) {
    const plays = await fetchAllPages((from, to) => supabase.from('plays')
      .select('id,game_id,played_at,is_cooperative,team_won,games(lower_score_wins,shared_score_positions),play_scores(player_id,winner,position,score,players(name,alias))', { count: 'exact' })
      .eq('user_id', ownerId).order('played_at', { ascending: true }).order('id', { ascending: true }).range(from, to))
    const simulationInput = plays as unknown as SimulationPlay[]
    const inputHash = createHash('sha256').update(JSON.stringify(plays)).digest('hex')
    const before = baseline.simulateAllPlays(simulationInput)
    const after = simulateAllPlays(simulationInput)
    assert.equal(createHash('sha256').update(JSON.stringify(plays)).digest('hex'), inputHash, 'Input mutato')
    const changedOtherGames = Object.keys(before.gamePlayers).filter(id => id !== PILI_PILI_GAME_ID &&
      JSON.stringify(after.gamePlayers[id]) !== JSON.stringify(before.gamePlayers[id]))
    const matches = piliPlays.filter(play => play.user_id === ownerId).map(play => {
      const rows = play.play_scores ?? []
      const ranked = assignPositions(rows, { gameId: PILI_PILI_GAME_ID, game: play.games })
      const entries = ranked.map(row => {
        const oldElo = before.gameHistory.find(h => h.playId === play.id && h.playerId === row.player_id)!
        const newElo = after.gameHistory.find(h => h.playId === play.id && h.playerId === row.player_id)!
        assert(oldElo && newElo, `Storico incompleto per ${play.id}/${row.player_id}`)
        const saved = storedHistory.find(h => h.play_id === play.id && h.player_id === row.player_id)
        return {
          playerId: row.player_id, name: row.players?.alias || row.players?.name,
          score: row.score, winner: row.winner,
          positionBefore: rows.find(s => s.player_id === row.player_id)!.position, positionAfter: row.position,
          eloBefore: oldElo.rating, eloAfter: newElo.rating,
          deltaBefore: oldElo.ratingChange, deltaAfter: newElo.ratingChange,
          cachedElo: saved?.rating ?? null, cachedDelta: saved?.rating_change ?? null,
        }
      })
      return { id: play.id, date: play.played_at, entries }
    })
    const standings = Object.values(after.gamePlayers[PILI_PILI_GAME_ID]).map(player => ({
      playerId: player.playerId, name: player.playerName, gamesPlayed: player.gamesPlayed,
      eloStored: storedRatings.find(r => r.player_id === player.playerId)?.rating ?? null,
      eloBefore: before.gamePlayers[PILI_PILI_GAME_ID][player.playerId].rating, eloAfter: player.rating,
      difference: player.rating - before.gamePlayers[PILI_PILI_GAME_ID][player.playerId].rating,
      generalBefore: before.generalPlayers[player.playerId].rating,
      generalAfter: after.generalPlayers[player.playerId].rating,
    })).sort((a, b) => b.eloAfter - a.eloAfter)
    results.push({
      ownerId, inputHash, totalPlays: plays.length,
      changedOtherGames,
      changedPositionMatches: matches.filter(m => m.entries.some(p => p.positionBefore !== p.positionAfter)).length,
      changedPositionRows: matches.flatMap(m => m.entries).filter(p => p.positionBefore !== p.positionAfter).length,
      baselineStoredRatingMismatches: standings.filter(p => p.eloStored !== p.eloBefore).length,
      baselineCachedHistoryMismatches: matches.flatMap(m => m.entries)
        .filter(p => p.cachedElo !== p.eloBefore || p.cachedDelta !== p.deltaBefore).length,
      standings, matches,
    })
  }

  assert.deepEqual(await readPiliPlays(), piliPlays, 'Le partite sono cambiate durante la lettura: ripetere l’anteprima')
  const reportPath = resolve(process.argv[3] ?? join(tmpdir(), 'kingscore-pili-pili-preview.json'))
  const report = {
    generatedAt: new Date().toISOString(), baselineRef, gameId: PILI_PILI_GAME_ID,
    readOnly: true, getRequests, totalPiliPlays: piliPlays.length, results,
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(JSON.stringify({
    reportPath, getRequests, totalPiliPlays: report.totalPiliPlays,
    results: results.map(({ matches, ...summary }) => ({
      ...summary, screenshot: matches.find(m => m.id === '049e0daf-861c-4f5c-a0d4-0859f7462805'),
    })),
  }, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
