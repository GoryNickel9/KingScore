// Disposable loopback-only UI fixture. This tests React/SDK integration, not SQL or remote Auth.
import { createServer as httpServer } from 'node:http'
import { createServer as viteServer } from 'vite'
import react from '@vitejs/plugin-react'
import { randomUUID } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const actor = '00000000-0000-0000-0000-000000000001'
const owner = '00000000-0000-0000-0000-000000000005'
const gameId = '00000000-0000-0000-0000-000000000003'
const playerId = '00000000-0000-0000-0000-000000000006'
const initialPlay = '00000000-0000-0000-0000-000000000002'
const timestamp = '2026-10-15T12:00:00Z'
const game = { id: gameId, name: 'Gioco di prova locale', bga_id: null, image_url: null, min_players: 1, max_players: 63, created_at: timestamp }
const player = { id: playerId, name: 'Anna locale', user_id: actor, account_user_id: null, alias: null, avatar_url: null, color: null, created_at: timestamp, updated_at: timestamp, is_me: false }
const user = { id: actor, aud: 'authenticated', role: 'authenticated', email: 'admin@example.invalid', email_confirmed_at: timestamp,
  app_metadata: { role: 'admin', provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: timestamp }
const jwt = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: actor, role: 'authenticated', exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url')}.synthetic-signature`
const games = [game]; const players = [player]; const plays = new Map(); const receipts = new Map(); const requests = []
let mode = 'normal'; let revision = 0
function nextRevision() { return `v1:${String(++revision).padStart(64, '0')}` }
function newPlay(id, payload, playOwner = actor) {
  return { revision: nextRevision(), editability: { editable: true, issues: [] }, detail: {
    play: { id, user_id: playOwner, game_id: payload.game_id, played_at: payload.played_at,
      duration_minutes: payload.duration_minutes, source: payload.source, notes: payload.notes,
      location: 'Tavolo locale', bga_table_id: null, is_cooperative: payload.is_cooperative, team_won: payload.team_won, created_at: timestamp },
    game, scores: payload.scores.map((score, index) => ({ score: { ...score, id: score.id ?? randomUUID(), play_id: id, position: index+1 },
      player: players.find(item => item.id === score.player_id) ?? null })),
  } }
}
plays.set(initialPlay, newPlay(initialPlay, { game_id: gameId, played_at: '2026-10-15', duration_minutes: 30, source: 'offline',
  notes: 'Partita di un altro proprietario', is_cooperative: false, team_won: null,
  scores: [{ id: '00000000-0000-0000-0000-000000000004', player_id: playerId, score: '9007199254740993.125', winner: false, color: 'rosso', role: 'leader' }] }, owner))
function publicPlay(snapshot) { return { ...snapshot.detail.play, games: snapshot.detail.game,
  play_scores: snapshot.detail.scores.map(item => ({ ...item.score, score: item.score.score === null ? null : Number(item.score.score), players: item.player })) } }
const api = httpServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', request.headers['access-control-request-headers'] ?? 'authorization,apikey,content-type')
  response.setHeader('Access-Control-Expose-Headers', 'Content-Range')
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  const send = (value, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)) }
  if (request.method === 'OPTIONS') { response.end(); return }
  const url = new URL(request.url, 'http://127.0.0.1')
  let raw = ''; for await (const chunk of request) raw += chunk
  let body
  try { body = raw ? JSON.parse(raw) : null } catch { send({ code: 'bad-json' }, 400); return }
  if (url.pathname === '/__qa') {
    if (request.method === 'PUT') {
      if (body.mode) mode = body.mode
      if (body.role) user.app_metadata.role = body.role
    }
    send({ mode, requests, plays: [...plays.values()], receipts: receipts.size }); return
  }
  if (url.pathname === '/auth/v1/token') {
    send({ access_token: jwt, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, user }); return
  }
  if (url.pathname === '/auth/v1/user') { send(user); return }
  if (url.pathname === '/auth/v1/logout') { send({}); return }
  requests.push({ path: url.pathname, method: request.method, body })
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    const rpc = url.pathname.split('/').at(-1)
    if (rpc === 'get_play_editor_v1') {
      const snapshot = plays.get(body.p_play_id)
      if (!snapshot) { send({ code: 'PT404' }, 404); return }
      const copy = structuredClone(snapshot)
      if (mode === 'uneditable') { copy.editability = { editable: false, issues: ['source-not-supported'] }; copy.detail.play.source = null }
      send(copy); return
    }
    const previous = receipts.get(body.p_request_id)
    if (previous) {
      if (previous.raw !== raw || previous.rpc !== rpc) { send({ code: 'PT409' }, 409); return }
      send({ ...previous.value, replayed: true }); return
    }
    const old = plays.get(body.p_play_id)
    if (rpc === 'update_play_v1' || rpc === 'delete_play_v1') {
      if (!old) { send({ code: 'PT404' }, 404); return }
      if (mode === 'conflict') {
        old.detail.play.notes = 'Aggiornata da un altro dispositivo'; old.revision = nextRevision(); mode = 'normal'
      }
      if (body.p_expected_revision !== old.revision) { send({ code: 'PT409' }, 409); return }
    }
    let value
    if (rpc === 'delete_play_v1') { plays.delete(body.p_play_id); value = { play_id: body.p_play_id, deleted: true, replayed: false } }
    else if (['create_play_v1','update_play_v1','import_bga_play_v1'].includes(rpc)) {
      const id = body.p_play_id ?? randomUUID(); const snapshot = newPlay(id, body.p_payload, old?.detail.play.user_id ?? actor)
      if (body.p_metadata) Object.assign(snapshot.detail.play, body.p_metadata)
      plays.set(id, snapshot); value = { play_id: id, revision: snapshot.revision, replayed: false }
      if (rpc === 'import_bga_play_v1') value.skipped = false
    } else { send({ code: 'PT404' }, 404); return }
    receipts.set(body.p_request_id, { rpc, raw, value })
    if (mode === 'lost-response') {
      mode = 'normal'
      // Deliver a truncated receipt after commit so Chromium cannot silently retry an empty connection.
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"play_id":'); return
    }
    send(value); return
  }
  const table = url.pathname.split('/').at(-1)
  if (request.method === 'POST' && ['games','players'].includes(table)) {
    const row = { ...(table === 'games' ? game : player), ...body, id: randomUUID() }
    ;(table === 'games' ? games : players).push(row); send(row); return
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') { send({ code: 'fixture-forbids-legacy-dml' }, 403); return }
  let rows = table === 'games' ? games : table === 'players' ? players : table === 'plays' ? [...plays.values()].map(publicPlay) : []
  for (const [key,value] of url.searchParams) if (value.startsWith('eq.')) rows = rows.filter(row => String(row[key]) === value.slice(3))
  response.setHeader('Content-Range', `0-${Math.max(0,rows.length-1)}/${rows.length}`)
  send(request.headers.accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows)
})
await new Promise(resolve => api.listen(0, '127.0.0.1', resolve))
const apiUrl = `http://127.0.0.1:${api.address().port}`
const vite = await viteServer({ configFile: false, envDir: false, plugins: [react()],
  define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(apiUrl), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('synthetic-key'), 'import.meta.env.VITE_ATOMIC_PLAY_WRITES': JSON.stringify('true') },
  server: { host: '127.0.0.1', port: 0, headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*; img-src 'self' data:; font-src 'self' data:; frame-src 'none'" } },
})
await vite.listen()
const report = { app: `http://127.0.0.1:${vite.httpServer.address().port}`, api: apiUrl, actor, owner, gameId, playerId, initialPlay, fixture: 'synthetic-ui-only', pid: process.pid }
mkdirSync('.work', { recursive: true }); writeFileSync(resolve('.work/web-ui-fixture.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
async function stop() { await vite.close(); api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); process.exit(0) }
process.on('SIGINT', () => { void stop() }); process.on('SIGTERM', () => { void stop() })
