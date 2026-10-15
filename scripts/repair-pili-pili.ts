/** Rettifica mirata: prepare genera backup e SQL atomico; verify controlla il risultato. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import type { DbEloHistory, DbPlay, DbPlayerGeneralRating, DbPlayerRating, DbPlayScore } from '../src/types/rows.ts'
import type { Database } from '../src/types/db.ts'
import { PILI_PILI_GAME_ID } from '../src/utils/elo/gameRules.ts'
import { assignPositions } from '../src/utils/elo/positions.ts'
import { simulateAllPlays } from '../src/utils/elo/simulation.ts'
import type { SimulationPlay } from '../src/utils/elo/simulation.ts'
import { fetchAllPages } from '../src/utils/pagination.ts'

const gameId = PILI_PILI_GAME_ID
const snapshotSql = `WITH owners AS (
  SELECT DISTINCT user_id FROM public.plays WHERE game_id = '${gameId}'
), owned_plays AS (
  SELECT p.* FROM public.plays p WHERE user_id IN (SELECT user_id FROM owners)
), snapshot AS (SELECT jsonb_build_object(
  'plays', (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id), '[]') FROM owned_plays p),
  'scores', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id), '[]') FROM public.play_scores s WHERE play_id IN (SELECT id FROM owned_plays)),
  'players', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'alias', alias) ORDER BY id), '[]') FROM public.players WHERE id IN (SELECT player_id FROM public.play_scores WHERE play_id IN (SELECT id FROM owned_plays))),
  'gameRatings', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id), '[]') FROM public.player_ratings r WHERE game_id IN (SELECT game_id FROM owned_plays)),
  'generalRatings', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id), '[]') FROM public.player_general_ratings r WHERE user_id IN (SELECT user_id FROM owners)),
  'history', (SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY id), '[]') FROM public.elo_history h WHERE user_id IN (SELECT user_id FROM owners) OR game_id = '${gameId}')
) AS body)
SELECT body, md5(body::text) AS hash FROM snapshot`

interface Snapshot {
  plays: DbPlay[]
  scores: DbPlayScore[]
  players: { id: string; name: string; alias: string | null }[]
  gameRatings: DbPlayerRating[]
  generalRatings: DbPlayerGeneralRating[]
  history: DbEloHistory[]
}

interface Payload {
  ownerId: string
  positions: { id: string; play_id: string; player_id: string; position: number }[]
  gameRatings: { game_id: string; player_id: string; rating: number }[]
  generalRatings: { user_id: string; player_id: string; rating: number }[]
  history: Omit<DbEloHistory, 'id' | 'created_at'>[]
}

async function query<T>(directory: string, name: string, sql: string): Promise<T[]> {
  const path = join(directory, name)
  await writeFile(path, sql, { flag: 'wx' })
  const stdout = execFileSync('supabase.exe', ['db', 'query', '--linked', '--file', path, '--output', 'json'], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const result = JSON.parse(stdout) as { rows: T[] }
  assert(Array.isArray(result.rows), 'Risposta SQL non valida')
  return result.rows
}

function targetsHistory(row: Pick<DbEloHistory, 'game_id' | 'is_general' | 'user_id' | 'player_id'>, payload: Payload) {
  return (!row.is_general && row.game_id === gameId) ||
    (row.is_general && row.user_id === payload.ownerId && payload.generalRatings.some(p => p.player_id === row.player_id))
}

async function prepare(): Promise<void> {
  const directory = join(tmpdir(), `kingscore-pili-pili-repair-${randomUUID()}`)
  await mkdir(directory)
  const [backup] = await query<{ body: Snapshot; hash: string }>(directory, 'snapshot-before.sql', snapshotSql)
  await writeFile(join(directory, 'backup.json'), `${JSON.stringify(backup, null, 2)}\n`, { flag: 'wx' })
  const [runs] = await query<{ active: number }>(directory, 'check-active-recalc.sql',
    "SELECT count(*)::int AS active FROM public.elo_recalc_runs WHERE status='running' AND started_at > now() - interval '10 minutes'")
  assert.equal(runs.active, 0, 'Ricalcolo già attivo: riprovare dopo la conclusione')
  const piliPlays = backup.body.plays.filter(p => p.game_id === gameId)
  assert(piliPlays.length > 0, 'Nessuna partita di Pili Pili')
  const ownerIds = [...new Set(piliPlays.map(p => p.user_id))]
  assert.equal(ownerIds.length, 1, 'Questo intervento richiede un solo proprietario per evitare sovrapposizioni nei rating condivisi')
  const ownerId = ownerIds[0]
  assert(ownerId, 'Proprietario mancante')
  config({ path: '.env.local', quiet: true })
  assert(process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY, 'Configurazione mancante')
  assert.equal(new URL(process.env.VITE_SUPABASE_URL).host, 'rixivmeipbizoxyvrvaf.supabase.co')
  const client = createClient<Database>(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => {
      assert.equal((init?.method ?? 'GET').toUpperCase(), 'GET', 'La preparazione consente solo GET')
      return fetch(input, init)
    } },
  })
  const plays = await fetchAllPages((from, to) => client.from('plays')
    .select('id,game_id,played_at,play_scores(id,play_id,player_id,winner,position,score,players(name,alias))', { count: 'exact' })
    .eq('user_id', ownerId).order('played_at', { ascending: true }).order('id', { ascending: true }).range(from, to))
  assert.deepEqual(plays.map(p => p.id).sort(), backup.body.plays.map(p => p.id).sort(), 'Lettura REST incompleta')
  for (const play of plays) {
    const rows = (play.play_scores ?? []).map(({ id, play_id, player_id, score, winner, position }) => ({ id, play_id, player_id, score, winner, position }))
    const stored = backup.body.scores.filter(s => s.play_id === play.id)
      .map(({ id, play_id, player_id, score, winner, position }) => ({ id, play_id, player_id, score, winner, position }))
    assert.deepEqual(rows.sort((a, b) => a.id.localeCompare(b.id)), stored.sort((a, b) => a.id.localeCompare(b.id)), 'Punteggi cambiati o incompleti')
  }
  const sim = simulateAllPlays(plays as unknown as SimulationPlay[])
  const affectedPlayers = Object.keys(sim.gamePlayers[gameId])
  const otherGameDifferences = backup.body.gameRatings.filter(row => row.game_id !== gameId &&
    sim.gamePlayers[row.game_id ?? '']?.[row.player_id ?? '']?.rating !== row.rating)
  // Gli altri giochi mantengono i risultati già salvati, anche se il loro
  // storico differisce dal replay completo corrente (es. ordine nello stesso giorno).
  const currentHistory = new Map(backup.body.history.filter(h => !h.is_general).map(h => [`${h.play_id}/${h.player_id}`, h]))
  const replacementHistory = new Map(sim.gameHistory.filter(h => h.gameId === gameId).map(h => [`${h.playId}/${h.playerId}`, h]))
  const weighted = new Map<string, number>()
  const weights = new Map<string, number>()
  const gameStates = new Map<string, { rating: number; count: number }>()
  const generalHistory: Payload['history'] = []
  for (const play of plays) {
    if (!play.play_scores || play.play_scores.length < 2) continue
    for (const score of play.play_scores) {
      const playerId = score.player_id!
      const key = `${play.id}/${playerId}`
      const saved = currentHistory.get(key)
      assert(saved, `Cache per gioco mancante: ${key}`)
      const rating = play.game_id === gameId ? replacementHistory.get(key)?.rating : saved.rating
      assert(rating !== undefined, `Nuovo rating mancante: ${key}`)
      const stateKey = `${play.game_id}/${playerId}`
      const previous = gameStates.get(stateKey) ?? { rating: 1000, count: 0 }
      const sumBefore = weighted.get(playerId) ?? 0
      const countBefore = weights.get(playerId) ?? 0
      const before = countBefore ? Math.round(sumBefore / countBefore) : 1000
      const sumAfter = sumBefore + rating * (previous.count + 1) - previous.rating * previous.count
      const countAfter = countBefore + 1
      weighted.set(playerId, sumAfter)
      weights.set(playerId, countAfter)
      gameStates.set(stateKey, { rating, count: previous.count + 1 })
      if (affectedPlayers.includes(playerId)) generalHistory.push({
        play_id: play.id, game_id: null, player_id: playerId, player_name: saved.player_name,
        rating: Math.round(sumAfter / countAfter), rating_change: Math.round(sumAfter / countAfter) - before,
        date: play.played_at, is_general: true, games_played: countAfter, user_id: ownerId,
      })
    }
  }
  // Il generale finale deve coincidere con la media dei rating effettivamente
  // mantenuti nel DB, sostituendo soltanto Pili Pili.
  for (const playerId of affectedPlayers) {
    const ratings = backup.body.gameRatings.filter(r => r.player_id === playerId)
    const totalGames = ratings.reduce((sum, r) => sum + (r.games_played ?? 0), 0)
    const total = ratings.reduce((sum, r) => sum + (r.game_id === gameId ? sim.gamePlayers[gameId][playerId].rating : r.rating!) * (r.games_played ?? 0), 0)
    assert.equal(weights.get(playerId), totalGames, 'Conteggio partite diverso dai rating salvati')
    assert.equal(weighted.get(playerId), total, 'Storico per gioco incoerente con i rating finali')
  }
  const payload: Payload = {
    ownerId,
    positions: plays.filter(p => p.game_id === gameId).flatMap(p => assignPositions(p.play_scores ?? [], { gameId })
      .map(s => ({ id: s.id, play_id: p.id, player_id: s.player_id!, position: s.position }))),
    gameRatings: affectedPlayers.map(player_id => ({ game_id: gameId, player_id, rating: sim.gamePlayers[gameId][player_id].rating })),
    generalRatings: affectedPlayers.map(player_id => ({ user_id: ownerId, player_id, rating: Math.round(weighted.get(player_id)! / weights.get(player_id)!) })),
    history: [
      ...sim.gameHistory.filter(h => h.gameId === gameId).map(h => ({
        play_id: h.playId, game_id: gameId, player_id: h.playerId, player_name: h.playerName,
        rating: h.rating, rating_change: h.ratingChange, date: h.date, is_general: false, games_played: null, user_id: ownerId,
      })),
      ...generalHistory,
    ],
  }
  for (const row of payload.gameRatings) assert(backup.body.gameRatings.some(r => r.game_id === row.game_id && r.player_id === row.player_id), 'Rating da aggiornare mancante')
  for (const row of payload.generalRatings) assert(backup.body.generalRatings.some(r => r.user_id === row.user_id && r.player_id === row.player_id), 'ELO generale da aggiornare mancante')
  await writeFile(join(directory, 'expected.json'), `${JSON.stringify(payload, null, 2)}\n`, { flag: 'wx' })
  const delimiter = `$payload_${randomUUID().replace(/-/g, '')}$`
  const json = JSON.stringify(payload)
  assert(!json.includes(delimiter))
  const targetPredicate = `(NOT is_general AND game_id='${gameId}') OR (is_general AND user_id='${ownerId}' AND player_id IN (SELECT player_id FROM jsonb_to_recordset((SELECT body->'generalRatings' FROM pili_repair_payload)) AS g(player_id uuid)))`
  const sql = `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.players, public.plays, public.play_scores, public.player_ratings, public.player_general_ratings, public.elo_history IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ DECLARE current_hash text; BEGIN
  SELECT hash INTO current_hash FROM (${snapshotSql}) s;
  IF current_hash IS DISTINCT FROM '${backup.hash}' THEN RAISE EXCEPTION 'Snapshot cambiato: nessuna rettifica applicata'; END IF;
  IF EXISTS (SELECT 1 FROM public.elo_recalc_runs WHERE status='running' AND started_at > now() - interval '10 minutes') THEN RAISE EXCEPTION 'Ricalcolo attivo'; END IF;
END $guard$;
CREATE TEMP TABLE pili_repair_payload ON COMMIT DROP AS SELECT ${delimiter}${json}${delimiter}::jsonb AS body;
UPDATE public.play_scores s SET position=x.position
FROM jsonb_to_recordset((SELECT body->'positions' FROM pili_repair_payload)) AS x(id uuid, play_id uuid, player_id uuid, position int)
WHERE s.id=x.id AND s.play_id=x.play_id AND s.player_id=x.player_id AND s.position IS DISTINCT FROM x.position;
UPDATE public.player_ratings r SET rating=x.rating
FROM jsonb_to_recordset((SELECT body->'gameRatings' FROM pili_repair_payload)) AS x(game_id uuid, player_id uuid, rating int)
WHERE r.game_id=x.game_id AND r.player_id=x.player_id AND r.rating IS DISTINCT FROM x.rating;
UPDATE public.player_general_ratings r SET rating=x.rating
FROM jsonb_to_recordset((SELECT body->'generalRatings' FROM pili_repair_payload)) AS x(user_id uuid, player_id uuid, rating int)
WHERE r.user_id=x.user_id AND r.player_id=x.player_id AND r.rating IS DISTINCT FROM x.rating;
DELETE FROM public.elo_history WHERE ${targetPredicate};
INSERT INTO public.elo_history (play_id,game_id,player_id,player_name,rating,rating_change,date,is_general,games_played,user_id)
SELECT play_id,game_id,player_id,player_name,rating,rating_change,date,is_general,games_played,user_id
FROM jsonb_to_recordset((SELECT body->'history' FROM pili_repair_payload)) AS x(play_id uuid,game_id uuid,player_id uuid,player_name text,rating int,rating_change int,date timestamptz,is_general boolean,games_played int,user_id uuid);
DO $verify$ BEGIN
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset((SELECT body->'positions' FROM pili_repair_payload)) AS x(id uuid,position int) LEFT JOIN public.play_scores s ON s.id=x.id WHERE s.position IS DISTINCT FROM x.position) THEN RAISE EXCEPTION 'Posizioni non aggiornate'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset((SELECT body->'gameRatings' FROM pili_repair_payload)) AS x(game_id uuid,player_id uuid,rating int) LEFT JOIN public.player_ratings r ON r.game_id=x.game_id AND r.player_id=x.player_id WHERE r.rating IS DISTINCT FROM x.rating) THEN RAISE EXCEPTION 'Rating non aggiornati'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset((SELECT body->'generalRatings' FROM pili_repair_payload)) AS x(user_id uuid,player_id uuid,rating int) LEFT JOIN public.player_general_ratings r ON r.user_id=x.user_id AND r.player_id=x.player_id WHERE r.rating IS DISTINCT FROM x.rating) THEN RAISE EXCEPTION 'ELO generali non aggiornati'; END IF;
  IF (SELECT count(*) FROM public.elo_history WHERE ${targetPredicate}) <> (SELECT jsonb_array_length(body->'history') FROM pili_repair_payload) THEN RAISE EXCEPTION 'Cache incompleta'; END IF;
END $verify$;
COMMIT;
SELECT 'committed' AS repair_status;`
  await writeFile(join(directory, 'apply.sql'), sql, { flag: 'wx' })
  console.log(JSON.stringify({ directory, hash: backup.hash, plays: plays.length, piliPlays: piliPlays.length,
    positionChanges: payload.positions.filter(p => backup.body.scores.find(s => s.id === p.id)?.position !== p.position).length,
    gameRatings: payload.gameRatings, generalRatings: payload.generalRatings, cacheRows: payload.history.length,
    preservedOtherGameDifferences: otherGameDifferences.length }, null, 2))
}

async function verify(directory: string): Promise<void> {
  const backup = JSON.parse(await readFile(join(directory, 'backup.json'), 'utf8')) as { body: Snapshot }
  const expected = JSON.parse(await readFile(join(directory, 'expected.json'), 'utf8')) as Payload
  const [after] = await query<{ body: Snapshot; hash: string }>(directory, 'snapshot-after.sql', snapshotSql)
  await writeFile(join(directory, 'after.json'), JSON.stringify(after, null, 2), { flag: 'wx' })
  assert.deepEqual(after.body.plays, backup.body.plays, 'Partite modificate')
  assert.deepEqual(after.body.players, backup.body.players, 'Giocatori modificati')
  assert.equal(after.body.scores.length, backup.body.scores.length)
  for (const row of after.body.scores) {
    const original = backup.body.scores.find(s => s.id === row.id)!
    const target = expected.positions.find(s => s.id === row.id)
    assert.deepEqual(row, { ...original, position: target?.position ?? original.position }, 'Punteggio, flag o altro campo modificato')
  }
  assert.deepEqual(after.body.gameRatings.filter(r => r.game_id !== gameId), backup.body.gameRatings.filter(r => r.game_id !== gameId), 'Rating di altri giochi modificati')
  const affected = new Set(expected.generalRatings.map(r => r.player_id))
  assert.deepEqual(after.body.generalRatings.filter(r => !affected.has(r.player_id!)), backup.body.generalRatings.filter(r => !affected.has(r.player_id!)), 'ELO generale di altri giocatori modificato')
  assert.deepEqual(after.body.history.filter(r => !targetsHistory(r, expected)), backup.body.history.filter(r => !targetsHistory(r, expected)), 'Cache fuori ambito modificata')
  for (const row of expected.gameRatings) assert.equal(after.body.gameRatings.find(r => r.game_id === row.game_id && r.player_id === row.player_id)?.rating, row.rating)
  for (const row of expected.generalRatings) assert.equal(after.body.generalRatings.find(r => r.user_id === row.user_id && r.player_id === row.player_id)?.rating, row.rating)
  const normalize = (row: Omit<DbEloHistory, 'id' | 'created_at'>) => ({
    play_id: row.play_id, game_id: row.game_id, player_id: row.player_id, player_name: row.player_name,
    rating: row.rating, rating_change: row.rating_change, date: new Date(row.date).toISOString(),
    is_general: row.is_general, games_played: row.games_played, user_id: row.user_id,
  })
  const byKey = (a: ReturnType<typeof normalize>, b: ReturnType<typeof normalize>) => `${a.play_id}/${a.player_id}/${a.is_general}`.localeCompare(`${b.play_id}/${b.player_id}/${b.is_general}`)
  assert.deepEqual(after.body.history.filter(r => targetsHistory(r, expected)).map(normalize).sort(byKey), expected.history.map(normalize).sort(byKey), 'Cache diversa dalla simulazione')
  console.log(JSON.stringify({ verified: true, backupDirectory: directory, cacheRowsVerified: expected.history.length,
    unchangedScoreSeven: after.body.scores.filter(s => s.score === 7 && expected.positions.some(p => p.id === s.id)).length,
    ratings: expected.gameRatings.map(r => ({ name: after.body.players.find(p => p.id === r.player_id)?.alias || after.body.players.find(p => p.id === r.player_id)?.name,
      before: backup.body.gameRatings.find(p => p.game_id === gameId && p.player_id === r.player_id)?.rating,
      after: r.rating,
      generalBefore: backup.body.generalRatings.find(p => p.user_id === expected.ownerId && p.player_id === r.player_id)?.rating,
      generalAfter: expected.generalRatings.find(p => p.player_id === r.player_id)?.rating })),
  }, null, 2))
}

if (process.argv[2] === 'prepare') await prepare()
else if (process.argv[2] === 'verify' && process.argv[3]) await verify(resolve(process.argv[3]))
else throw new Error('Uso: repair-pili-pili.ts prepare | verify <directory>')
