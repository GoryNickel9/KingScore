/** Backup e ricalcolo atomico dopo una modifica delle regole. Nessuna scrittura implicita. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { DbGame, DbPlay, DbPlayScore, DbPlayerRating, DbPlayerGeneralRating, DbEloHistory } from '../src/types/rows.ts'
import { assignPositions } from '../src/utils/elo/positions.ts'
import { simulateAllPlays } from '../src/utils/elo/simulation.ts'
import type { SimulationPlay } from '../src/utils/elo/simulation.ts'
import { PILI_PILI_GAME_ID } from '../src/utils/elo/gameRules.ts'

interface Snapshot {
  games: DbGame[]
  plays: DbPlay[]
  scores: DbPlayScore[]
  players: { id: string; name: string; alias: string | null }[]
  gameRatings: DbPlayerRating[]
  generalRatings: DbPlayerGeneralRating[]
  history: DbEloHistory[]
}
type Rating = Pick<DbPlayerRating, 'game_id' | 'player_id' | 'rating' | 'games_played' | 'wins' | 'losses' | 'draws' | 'last_played_at'>
type General = Pick<DbPlayerGeneralRating, 'user_id' | 'player_id' | 'rating' | 'games_played' | 'wins' | 'losses' | 'draws' | 'last_played_at'>
type History = Omit<DbEloHistory, 'id' | 'created_at'>
interface Payload {
  positions: { id: string; position: number }[]
  gameRatings: Rating[]
  generalRatings: General[]
  history: History[]
}

const snapshotSql = `SELECT body, md5(body::text) AS hash FROM (SELECT jsonb_build_object(
  'games', (SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY id),'[]') FROM public.games g),
  'plays', (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.plays p),
  'scores', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.play_scores s),
  'players', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'alias',alias) ORDER BY id),'[]') FROM public.players),
  'gameRatings', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.player_ratings r),
  'generalRatings', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.player_general_ratings r),
  'history', (SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY id),'[]') FROM public.elo_history h)
) body) s`

async function query<T>(directory: string, name: string, sql: string): Promise<T[]> {
  const path = join(directory, name)
  await writeFile(path, sql, { flag: 'wx' })
  const stdout = execFileSync('supabase.exe', ['db', 'query', '--linked', '--file', path, '--output', 'json'], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const parsed = JSON.parse(stdout) as { rows: T[] }
  assert(Array.isArray(parsed.rows))
  return parsed.rows
}

const save = (path: string, value: unknown) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })

async function backup(): Promise<void> {
  const directory = join(homedir(), 'Documents', 'KingScore Backups', `ranking-rules-2026-10-15-${randomUUID()}`)
  await mkdir(directory, { recursive: true })
  const [snapshot] = await query<{ body: Snapshot; hash: string }>(directory, 'before-migration.sql', snapshotSql)
  await save(join(directory, 'before-migration.json'), snapshot)
  console.log(JSON.stringify({ directory, plays: snapshot.body.plays.length, games: snapshot.body.games.length }))
}

async function prepare(directory: string): Promise<void> {
  await readFile(join(directory, 'before-migration.json'), 'utf8')
  const [snapshot] = await query<{ body: Snapshot; hash: string }>(directory, 'before-recalculation.sql', snapshotSql)
  await save(join(directory, 'before-recalculation.json'), snapshot)
  const source = snapshot.body
  assert(source.games.every(g => typeof g.lower_score_wins === 'boolean' && typeof g.shared_score_positions === 'boolean'), 'Migrazione non applicata')
  assert(source.plays.every(p => p.user_id), 'Partite senza proprietario: intervento da rivedere')
  const payload: Payload = { positions: [], gameRatings: [], generalRatings: [], history: [] }
  const owners = [...new Set(source.plays.map(p => p.user_id!))]
  const playerNames = new Map(source.players.map(p => [p.id, { name: p.name, alias: p.alias }]))
  const games = new Map(source.games.map(g => [g.id, g]))
  const positions = new Map<string, number>()
  for (const ownerId of owners) {
    const plays = source.plays.filter(p => p.user_id === ownerId)
      .sort((a, b) => a.played_at.localeCompare(b.played_at) || a.id.localeCompare(b.id))
      .map(p => ({ ...p, game_id: p.game_id ?? '', games: games.get(p.game_id ?? '') ?? null,
        play_scores: source.scores.filter(s => s.play_id === p.id).map(s => ({ ...s, player_id: s.player_id!, players: playerNames.get(s.player_id!) })) }))
    const unchanged = JSON.stringify(plays)
    const sim = simulateAllPlays(plays as SimulationPlay[])
    assert.equal(JSON.stringify(plays), unchanged, 'Input modificato')
    assert.deepEqual(simulateAllPlays(plays as SimulationPlay[]), sim, 'Replay non deterministico')
    for (const play of plays) {
      for (const score of assignPositions(play.play_scores, { gameId: play.game_id, game: play.games,
        cooperative: play.is_cooperative ?? false, teamWon: play.team_won })) positions.set(score.id, score.position)
    }
    for (const [gameId, players] of Object.entries(sim.gamePlayers)) {
      if (!gameId) continue
      for (const p of Object.values(players)) {
        assert.equal(p.wins + p.draws + p.losses, p.gamesPlayed)
        assert(!payload.gameRatings.some(r => r.game_id === gameId && r.player_id === p.playerId), 'Rating condiviso tra più proprietari: rivedere intervento')
        payload.gameRatings.push({ game_id: gameId, player_id: p.playerId, rating: p.rating, games_played: p.gamesPlayed,
          wins: p.wins, losses: p.losses, draws: p.draws, last_played_at: p.lastPlayedAt })
      }
    }
    for (const p of Object.values(sim.generalPlayers)) payload.generalRatings.push({
      user_id: ownerId, player_id: p.playerId, rating: p.rating, games_played: p.gamesPlayed,
      wins: p.wins, losses: p.losses, draws: p.draws, last_played_at: p.lastPlayedAt,
    })
    payload.history.push(...sim.gameHistory.filter(h => h.gameId).map(h => ({
      play_id: h.playId, game_id: h.gameId, player_id: h.playerId, player_name: h.playerName,
      rating: h.rating, rating_change: h.ratingChange, date: h.date, is_general: false, games_played: null, user_id: ownerId,
    })), ...sim.generalHistory.map(h => ({
      play_id: h.playId, game_id: null, player_id: h.playerId, player_name: h.playerName,
      rating: h.rating, rating_change: h.ratingChange, date: h.date, is_general: true, games_played: h.gamesPlayed, user_id: ownerId,
    })))
  }
  payload.positions = [...positions].map(([id, position]) => ({ id, position }))
  assert.equal(payload.gameRatings.length, source.gameRatings.length, 'Rating residui o mancanti da verificare')
  assert.equal(payload.generalRatings.length, source.generalRatings.length, 'ELO generali residui o mancanti da verificare')
  await save(join(directory, 'expected.json'), payload)
  const delimiter = `$recalc_${randomUUID().replace(/-/g, '')}$`
  const json = JSON.stringify(payload)
  assert(!json.includes(delimiter))
  const sql = `BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
LOCK TABLE public.games,public.players,public.plays,public.play_scores,public.player_ratings,public.player_general_ratings,public.elo_history IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ DECLARE snapshot_hash_seen text; BEGIN
  SELECT hash INTO snapshot_hash_seen FROM (${snapshotSql}) x;
  IF snapshot_hash_seen IS DISTINCT FROM '${snapshot.hash}' THEN RAISE EXCEPTION 'Snapshot cambiato, ricalcolo annullato'; END IF;
  IF EXISTS (SELECT 1 FROM public.elo_recalc_runs WHERE status='running' AND started_at>now()-interval '10 minutes') THEN RAISE EXCEPTION 'Job già attivo'; END IF;
END $guard$;
CREATE TEMP TABLE rankings_payload ON COMMIT DROP AS SELECT ${delimiter}${json}${delimiter}::jsonb body;
UPDATE public.play_scores s SET position=x.position FROM jsonb_to_recordset((SELECT body->'positions' FROM rankings_payload)) x(id uuid,position int) WHERE s.id=x.id AND s.position IS DISTINCT FROM x.position;
INSERT INTO public.player_ratings(game_id,player_id,rating,games_played,wins,losses,draws,last_played_at)
SELECT game_id,player_id,rating,games_played,wins,losses,draws,last_played_at FROM jsonb_to_recordset((SELECT body->'gameRatings' FROM rankings_payload)) x(game_id uuid,player_id uuid,rating int,games_played int,wins int,losses int,draws int,last_played_at timestamptz)
ON CONFLICT(player_id,game_id) DO UPDATE SET rating=excluded.rating,games_played=excluded.games_played,wins=excluded.wins,losses=excluded.losses,draws=excluded.draws,last_played_at=excluded.last_played_at;
INSERT INTO public.player_general_ratings(user_id,player_id,rating,games_played,wins,losses,draws,last_played_at)
SELECT user_id,player_id,rating,games_played,wins,losses,draws,last_played_at FROM jsonb_to_recordset((SELECT body->'generalRatings' FROM rankings_payload)) x(user_id uuid,player_id uuid,rating int,games_played int,wins int,losses int,draws int,last_played_at timestamptz)
ON CONFLICT(player_id,user_id) DO UPDATE SET rating=excluded.rating,games_played=excluded.games_played,wins=excluded.wins,losses=excluded.losses,draws=excluded.draws,last_played_at=excluded.last_played_at;
DELETE FROM public.elo_history WHERE play_id IN (SELECT id FROM public.plays);
INSERT INTO public.elo_history(play_id,game_id,player_id,player_name,rating,rating_change,date,is_general,games_played,user_id)
SELECT play_id,game_id,player_id,player_name,rating,rating_change,date,is_general,games_played,user_id FROM jsonb_to_recordset((SELECT body->'history' FROM rankings_payload)) x(play_id uuid,game_id uuid,player_id uuid,player_name text,rating int,rating_change int,date timestamptz,is_general boolean,games_played int,user_id uuid);
DO $check$ BEGIN
  IF (SELECT count(*) FROM public.elo_history) <> (SELECT jsonb_array_length(body->'history') FROM rankings_payload) THEN RAISE EXCEPTION 'Cache incompleta'; END IF;
  IF EXISTS (SELECT 1 FROM public.player_ratings WHERE wins+draws+losses <> games_played) OR EXISTS (SELECT 1 FROM public.player_general_ratings WHERE wins+draws+losses <> games_played) THEN RAISE EXCEPTION 'Contatori incoerenti'; END IF;
END $check$;
COMMIT; SELECT 'committed' AS status;`
  await writeFile(join(directory, 'apply.sql'), sql, { flag: 'wx' })
  console.log(JSON.stringify({ directory, positionsChanged: payload.positions.filter(p => source.scores.find(s => s.id === p.id)?.position !== p.position).length,
    cacheRows: payload.history.length, owners: owners.length,
    piliPili: payload.gameRatings.filter(r => r.game_id === PILI_PILI_GAME_ID).map(r => ({
      name: playerNames.get(r.player_id!)?.alias || playerNames.get(r.player_id!)?.name, ...r,
    })),
  }, null, 2))
}

async function verify(directory: string): Promise<void> {
  const before = JSON.parse(await readFile(join(directory, 'before-recalculation.json'), 'utf8')) as { body: Snapshot }
  const expected = JSON.parse(await readFile(join(directory, 'expected.json'), 'utf8')) as Payload
  const [after] = await query<{ body: Snapshot; hash: string }>(directory, 'after.sql', snapshotSql)
  await save(join(directory, 'after.json'), after)
  for (const key of ['games', 'plays', 'players'] as const) assert.deepEqual(after.body[key], before.body[key], `${key} modificati`)
  assert.equal(after.body.scores.length, before.body.scores.length)
  for (const row of after.body.scores) {
    const original = before.body.scores.find(s => s.id === row.id)!
    const target = expected.positions.find(s => s.id === row.id)
    assert.deepEqual(row, { ...original, position: target?.position ?? original.position }, 'Punteggio o altri dati modificati')
  }
  for (const row of expected.gameRatings) {
    const saved = after.body.gameRatings.find(r => r.game_id === row.game_id && r.player_id === row.player_id)!
    for (const key of ['rating', 'games_played', 'wins', 'losses', 'draws'] as const) assert.equal(saved[key], row[key])
  }
  for (const row of expected.generalRatings) {
    const saved = after.body.generalRatings.find(r => r.user_id === row.user_id && r.player_id === row.player_id)!
    for (const key of ['rating', 'games_played', 'wins', 'losses', 'draws'] as const) assert.equal(saved[key], row[key])
  }
  const normalize = (row: History) => ({ play_id: row.play_id, player_id: row.player_id, game_id: row.game_id,
    player_name: row.player_name, rating: row.rating, rating_change: row.rating_change,
    date: new Date(row.date).toISOString(), is_general: row.is_general, games_played: row.games_played, user_id: row.user_id })
  const key = (row: History) => `${row.play_id}/${row.player_id}/${row.is_general}`
  assert.deepEqual(after.body.history.map(normalize).sort((a, b) => key(a).localeCompare(key(b))), expected.history.map(normalize).sort((a, b) => key(a).localeCompare(key(b))))
  console.log(JSON.stringify({ verified: true, directory, gameRatings: expected.gameRatings.length,
    generalRatings: expected.generalRatings.length, cacheRows: expected.history.length,
    piliPili: after.body.gameRatings.filter(r => r.game_id === PILI_PILI_GAME_ID).map(r => ({
      name: after.body.players.find(p => p.id === r.player_id)?.alias,
      rating: r.rating, games: r.games_played, wins: r.wins, draws: r.draws, losses: r.losses,
    })),
  }, null, 2))
}

if (process.argv[2] === 'backup') await backup()
else if (process.argv[2] === 'prepare' && process.argv[3]) await prepare(resolve(process.argv[3]))
else if (process.argv[2] === 'verify' && process.argv[3]) await verify(resolve(process.argv[3]))
else throw new Error('Uso: recalculate-rankings.ts backup | prepare <directory> | verify <directory>')
