// HTTP/SDK/decoder fixture test; no browser or remote Auth/SQL is exercised here.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { once } from 'node:events'
import { build } from 'esbuild'
import { createClient } from '@supabase/supabase-js'

const fixture = spawn(process.execPath, ['scripts/web-play-ui-fixture.mjs'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
let info
const output = []
const checks = []
try {
  info = await new Promise((resolve, reject) => {
    let text = ''
    const timeout = setTimeout(() => reject(new Error('Local fixture startup timed out')), 30_000)
    fixture.once('exit', code => { clearTimeout(timeout); reject(new Error(`Local fixture exited with ${code}`)) })
    fixture.stderr.on('data', chunk => output.push(String(chunk)))
    fixture.stdout.on('data', chunk => {
      text += String(chunk)
      const line = text.split('\n').find(line => line.startsWith('{"app":'))
      if (line) { clearTimeout(timeout); resolve(JSON.parse(line)) }
    })
  })
  for (const url of [info.api, info.app]) {
    const parsed = new URL(url)
    assert.equal(parsed.hostname, '127.0.0.1')
    assert.equal(parsed.protocol, 'http:')
  }
  const bundled = await build({ entryPoints: ['src/utils/elo/readClient.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
    define: { 'import.meta.env.VITE_ATOMIC_PLAY_WRITES': '"true"' } })
  const readers = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
  const projectionBundle = await build({ entryPoints: ['src/utils/elo/projections.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
  const projections = await import(`data:text/javascript;base64,${Buffer.from(projectionBundle.outputFiles[0].text).toString('base64')}`)
  const client = createClient(info.api, 'synthetic-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const mode = async eloMode => {
    const response = await fetch(`${info.api}/__qa`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eloMode, clearRequests: true }) })
    assert.equal(response.status, 200)
  }

  await mode('current')
  const read = await readers.readGlobalElo(client)
  assert.equal(read.status, 'current')
  assert.equal(read.publicationId, info.publicationId)
  for (const view of [projections.generalStandings(read), projections.gameStandings(read, info.gameId), projections.generalHistory(read), projections.gameHistory(read, info.gameId)]) {
    assert.equal(view.scopeId, 'global')
    assert.equal(view.publicationId, info.publicationId)
    assert.equal(view.publishedRevision, read.publishedRevision)
  }
  assert.equal(read.result.gamePlayers[info.gameId][info.playerId].rating, 997)
  assert.equal(read.result.gamePlayers[info.gameId][info.secondPlayerId].rating, 1003)
  assert.equal(read.result.processedPlays, 2)
  checks.push('all four views retain one global publication identity across two historical owners')
  const detailGame = projections.gameHistory(read, info.gameId).data.filter(point => point.playId === info.initialPlay)
  const detailGeneral = projections.generalHistory(read).data.filter(point => point.playId === info.initialPlay)
  assert.equal(detailGame.find(point => point.playerId === info.playerId).ratingChange, 24)
  assert.equal(detailGeneral.find(point => point.playerId === info.playerId).ratingChange, 24)
  checks.push('match detail game/general deltas come from the same publication')
  const { data: games, error: gamesError } = await client.from('games').select('id,name,image_url')
  const { data: players, error: playersError } = await client.from('players').select('id,avatar_url')
  assert.equal(gamesError, null); assert.equal(playersError, null)
  assert.equal(games[0].name, 'Gioco di prova locale')
  const avatar = client.storage.from('player-images').getPublicUrl(players.find(player => player.id === info.secondPlayerId).avatar_url).data.publicUrl
  for (const image of [games[0].image_url, avatar]) {
    assert.equal(new URL(image).origin, info.api)
    const response = await fetch(image)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /image\/svg\+xml/)
  }
  checks.push('game and player image metadata resolves only to served loopback images')

  for (const status of ['stale', 'missing']) {
    await mode(status)
    const read = await readers.readGlobalElo(client)
    assert.equal(read.status, status)
    for (const view of [projections.generalStandings(read), projections.gameStandings(read, info.gameId), projections.generalHistory(read), projections.gameHistory(read, info.gameId)]) assert.equal(view.data, null)
    assert.ok(readers.eloReadStatus(read).length > 0)
    checks.push(`${status} exposes nonempty status text and no projected ratings/history`)
  }
  for (const status of ['wrong-owner', 'partial']) {
    await mode(status)
    await assert.rejects(() => readers.readGlobalElo(client), /Invalid ELO read response/)
    const audit = await (await fetch(`${info.api}/__qa`)).json()
    assert.equal(audit.requests.length, 1)
    assert.equal(audit.requests[0].path, '/rest/v1/rpc/get_elo_publication_v1')
    checks.push(`${status} rejected without any legacy read, write or retry`)
  }
  await mode('current')
  await readers.readGlobalElo(client)
  const audit = await (await fetch(`${info.api}/__qa`)).json()
  assert.deepEqual(audit.requests.map(request => [request.method, request.path, request.body]), [['POST', '/rest/v1/rpc/get_elo_publication_v1', {}]])
  assert.equal(audit.requests[0].publication.publicationId, info.publicationId)
  checks.push('current reader sends exactly one no-argument RPC and no legacy call or recalculation')
  const report = { status: 'passed', transport: 'real SDK over loopback HTTP', browser: 'not-exercised', remoteAuth: false, remoteDatabase: false, checks }
  mkdirSync('.work', { recursive: true })
  writeFileSync(resolve('.work/web-elo-read-validation.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  if (fixture.exitCode === null) { fixture.kill('SIGTERM'); await once(fixture, 'exit') }
  if (output.length) console.error(output.join(''))
}
