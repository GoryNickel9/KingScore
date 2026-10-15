import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, i) => [process.argv[i * 2 + 2], process.argv[i * 2 + 3]]))
const directory = resolve(args['--run-dir'])
const port = args['--port']
assert.match(port, /^[0-9]+$/)
const psql = join(resolve(args['--postgres-bin']), 'psql.exe')
const connection = ['-X', '-w', '-qAt', '-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', 'kingscore_elo_local_tests', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(PG|POSTGRES|HTTPS?_PROXY|ALL_PROXY|NODE_OPTIONS)/i.test(key)))
environment.PGPASSFILE = join(directory, 'empty.pgpass')
environment.PGCONNECT_TIMEOUT = '5'
const quote = value => `'${String(value).replaceAll("'", "''")}'`
const json = value => `${quote(JSON.stringify(value))}::jsonb`
const owner = '00000000-0000-0000-0000-000000000101'
const other = '00000000-0000-0000-0000-000000000102'
const game = '00000000-0000-0000-0000-000000000201'
const secondGame = '00000000-0000-0000-0000-000000000202'
const a = '00000000-0000-0000-0000-000000000301'
const b = '00000000-0000-0000-0000-000000000302'
const c = '00000000-0000-0000-0000-000000000303'
let sequence = 1000
const id = () => `00000000-0000-0000-0000-${String(++sequence).padStart(12, '0')}`
const children = new Set()
const cases = []
let currentCase
let decodeEloRead
const report = { status: 'FAIL', mode: 'local-elo-publication-prototype', host: '127.0.0.1', remoteContacted: false, cases,
  formulaChanged: false, sourceSha256: {}, failure: null, startedAt: new Date().toISOString() }

function raw(sql) {
  const result = spawnSync(psql, connection, { input: `${sql}\n`, encoding: 'utf8', env: environment, timeout: 20_000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
  if (result.error) throw result.error
  return result
}
function sql(statement) {
  const result = raw(statement)
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
function query(statement) { return JSON.parse(sql(statement).split('\n').at(-1)) }
function rejected(statement, code) {
  const result = raw(statement)
  assert.notEqual(result.status, 0, 'Expected database rejection')
  if (code) assert.match(result.stderr, new RegExp(code))
}
function snapshot(scope = owner) {
  return query(`SET ROLE local_elo_worker; SELECT ${scope === 'global' ? 'elo_local.snapshot_global()' : `elo_local.snapshot(${quote(scope)}::uuid)`}`)
}
function rawRead(scope = owner) {
  return query(`SET ROLE local_elo_reader; SELECT ${scope === 'global' ? 'elo_local.read_global()' : `elo_local.read(${quote(scope)}::uuid)`}`)
}
function read(scope = owner) { return decodeEloRead(rawRead(scope), scope) }
const publishSql = body => `SET ROLE local_elo_worker; SELECT elo_local.publish(${json(body)})`
function publish(body) { return query(publishSql(body)) }
function reset() {
  sql(`TRUNCATE elo_local.heads, elo_local.publications, public.plays, public.play_scores, public.players, public.games CASCADE;
    UPDATE elo_local.source_clock SET revision=0;
    INSERT INTO public.games VALUES (${quote(game)},'Game'),(${quote(secondGame)},'Second game');
    INSERT INTO public.players VALUES (${quote(a)},'Anna',NULL),(${quote(b)},'Bruno',NULL),(${quote(c)},'Carlo',NULL)`)
}
function play({ scope = owner, gameId = game, day = '2026-10-15', playId = id(), scores = [{ player: a, value: 10, winner: true }, { player: b, value: 5, winner: false }] } = {}) {
  const rows = scores.map((row, index) => `(${quote(id())},${quote(playId)},${quote(row.player)},${row.value === null ? 'NULL' : row.value},${row.winner === null ? 'NULL' : !!row.winner},${!!row.draw},${row.position ?? index + 1},${index})`)
  sql(`BEGIN; INSERT INTO public.plays(id,user_id,game_id,played_at) VALUES (${quote(playId)},${quote(scope)},${gameId === null ? 'NULL' : quote(gameId)},${quote(day)});
    ${rows.length ? `INSERT INTO public.play_scores(id,play_id,player_id,score,winner,draw,position,ordinal) VALUES ${rows.join(',')};` : ''} COMMIT`)
  return playId
}
function start(statement, name = 'elo-proof-session') {
  const child = spawn(psql, connection, { env: { ...environment, PGAPPNAME: name }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  children.add(child)
  let stdout = ''; let stderr = ''; const readyWaiters = []
  child.stdout.on('data', bytes => { stdout += bytes; readyWaiters.forEach(wake => wake()) })
  child.stderr.on('data', bytes => { stderr += bytes })
  const finished = new Promise((accept, fail) => {
    child.once('error', fail)
    child.once('close', status => { children.delete(child); accept({ status, get stdout() { return stdout }, get stderr() { return stderr } }) })
  })
  const timer = setTimeout(() => child.kill(), 20_000)
  const completion = finished.finally(() => clearTimeout(timer))
  child.stdin.write(statement)
  return { child, completion, ready: async () => {
    let timeout
    try {
      await Promise.race([new Promise((accept, fail) => {
        const check = () => { if (stdout.includes('elo-test-ready')) accept() }
        readyWaiters.push(check); check()
        timeout = setTimeout(() => fail(new Error('Transaction barrier timed out')), 10_000)
      }), completion.then(result => { throw new Error(`Transaction ended before barrier: ${result.stderr}`) })])
    } finally { clearTimeout(timeout) }
  } }
}
async function hold(statement) {
  const session = start(`BEGIN; ${statement}; SELECT 'elo-test-ready';\n`)
  await session.ready()
  return { finish: async (commit = true) => {
    session.child.stdin.end(`${commit ? 'COMMIT' : 'ROLLBACK'};\n\\q\n`)
    const result = await session.completion
    assert.equal(result.status, 0, result.stderr)
  } }
}
async function expectLockWait(applicationName) {
  for (let attempt = 0; attempt < 8; attempt++) {
    if (sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(applicationName)} AND wait_event_type='Lock')`) === 't') return
    await new Promise(accept => setTimeout(accept, 20))
  }
  assert.fail(`${applicationName} must actually wait on the other transaction`)
}
async function test(name, operation) {
  currentCase = name
  await operation()
  cases.push({ name, status: 'PASS' })
  console.log(`[${name}] PASS`)
}

try {
  assert.equal(sql("SELECT current_database() || ':' || current_setting('kingscore.local_test',true) || ':' || host(inet_server_addr())"), 'kingscore_elo_local_tests:elo-publication-v1:127.0.0.1')
  const pinned = { 'src/utils/elo/simulation.ts': '6928038ff5fe0ccbb3b8807a12ac7268ebe033741d9692192d9a36c930996b7f',
    'src/utils/elo/positions.ts': '65d5c06f4d94ecb714c468db5607c9ac9258c8ea3a8d21b1657b82e007d2d6d5' }
  for (const [file, expected] of Object.entries(pinned)) {
    const actual = createHash('sha256').update(readFileSync(file)).digest('hex')
    assert.equal(actual, expected, `Legacy source changed: ${file}`)
    report.sourceSha256[file] = actual
  }
  const { buildEloPublication } = await import(pathToFileURL(join(directory, 'publication.mjs')).href)
  ;({ decodeEloRead } = await import(pathToFileURL(join(directory, 'read-model.mjs')).href))
  const { generalStandings, gameStandings, generalHistory, gameHistory } = await import(pathToFileURL(join(directory, 'projections.mjs')).href)
  const build = (scope = owner) => buildEloPublication(snapshot(scope), randomUUID())

  await test('missing-generation-is-explicit', () => { reset(); assert.equal(read().status, 'missing'); assert.equal(read().result, null) })
  await test('publish-complete-generation-with-current-formula', () => {
    reset(); play(); play({ scores: [{ player: a, value: 2 }, { player: b, value: 3, winner: true }] })
    const body = build(); assert.equal(body.result.gamePlayers[game][a].rating, 997); assert.equal(body.result.gamePlayers[game][b].rating, 1003)
    assert.equal(publish(body).replayed, false); assert.deepEqual(read().result, body.result); assert.equal(read().status, 'current')
  })
  await test('snapshot-orders-plays-but-preserves-null-sensitive-score-array', () => {
    reset(); play({ day: '2026-10-16' }); play({ day: '2026-10-15', scores: [{ player: c, value: null }, { player: a, value: null }, { player: b, value: 5 }] })
    const source = snapshot(); assert.deepEqual(source.plays.map(row => row.played_at), ['2026-10-15', '2026-10-16'])
    assert.deepEqual(source.plays[0].play_scores.map(row => row.player_id), [c, a, b])
    const body = buildEloPublication(source, randomUUID()); publish(body); assert.deepEqual(read().result, body.result)
  })
  await test('source-mutation-rejects-old-calculation-and-hides-old-cache', () => {
    reset(); const p = play(); const old = build(); publish(old)
    sql(`UPDATE public.play_scores SET winner=NOT winner WHERE play_id=${quote(p)}`)
    assert.equal(read().status, 'stale'); assert.equal(read().result, null)
    const before = sql('SELECT count(*) FROM elo_local.publications'); rejected(publishSql({ ...old, publicationId: randomUUID() }), '40001')
    assert.equal(sql('SELECT count(*) FROM elo_local.publications'), before)
    const fresh = build(); publish(fresh); assert.deepEqual(read().result, fresh.result)
  })
  await test('ABA-edit-still-invalidates-the-old-revision', () => {
    reset(); const p = play(); const source = snapshot(); const body = buildEloPublication(source, randomUUID())
    sql(`UPDATE public.plays SET notes='temporary' WHERE id=${quote(p)}; UPDATE public.plays SET notes=NULL WHERE id=${quote(p)}`)
    assert.deepEqual(snapshot().plays, source.plays)
    assert.notEqual(snapshot().sourceRevision, body.sourceRevision); rejected(publishSql(body), '40001')
  })
  await test('source-transaction-rollback-restores-both-input-and-revision', () => {
    reset(); play(); const source = snapshot(); const body = buildEloPublication(source, randomUUID())
    rejected(`BEGIN; UPDATE public.play_scores SET score=999; INSERT INTO public.play_scores(id,play_id,player_id,ordinal) VALUES (${quote(id())},${quote(id())},${quote(a)},0); COMMIT`, '23503')
    assert.deepEqual(snapshot(), source); publish(body); assert.equal(read().status, 'current')
  })
  await test('source-snapshot-does-not-see-half-of-uncommitted-edit', async () => {
    reset(); const p = play(); const source = snapshot()
    const transaction = await hold(`UPDATE public.plays SET notes='new' WHERE id=${quote(p)}; UPDATE public.play_scores SET winner=NOT winner WHERE play_id=${quote(p)}`)
    assert.deepEqual(snapshot(), source)
    await transaction.finish(); assert.notEqual(snapshot().sourceRevision, source.sourceRevision)
    rejected(publishSql(buildEloPublication(source, randomUUID())), '40001')
  })
  await test('failed-head-swap-rolls-back-publication-and-retains-prior-head', () => {
    reset(); play(); const old = build(); publish(old); const next = build()
    sql("CREATE FUNCTION elo_local.fail_head() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected head failure'; END $$; CREATE TRIGGER fail_head BEFORE UPDATE ON elo_local.heads FOR EACH ROW EXECUTE FUNCTION elo_local.fail_head()")
    try { rejected(publishSql(next)); assert.equal(read().publicationId, old.publicationId); assert.equal(sql(`SELECT count(*) FROM elo_local.publications WHERE publication_id=${quote(next.publicationId)}`), '0') }
    finally { sql('DROP TRIGGER fail_head ON elo_local.heads; DROP FUNCTION elo_local.fail_head()') }
  })
  await test('readers-see-only-prior-complete-generation-before-publish-commit', async () => {
    reset(); play(); const old = build(); publish(old); const next = build()
    const transaction = await hold(publishSql(next))
    assert.equal(read().publicationId, old.publicationId); assert.deepEqual(read().result, old.result)
    await transaction.finish(); assert.equal(read().publicationId, next.publicationId); assert.deepEqual(read().result, next.result)
  })
  await test('lost-publish-response-replays-without-a-second-generation', () => {
    reset(); play(); const body = build(); publish(body)
    assert.equal(publish(JSON.parse(JSON.stringify(body))).replayed, true)
    assert.equal(sql('SELECT count(*) FROM elo_local.publications'), '1'); assert.equal(read().publicationId, body.publicationId)
  })
  await test('replaying-an-old-receipt-never-rewinds-the-published-head', () => {
    reset(); play(); const old = build(); publish(old)
    sql("UPDATE public.players SET alias='Anna nuova' WHERE name='Anna'")
    const fresh = build(); publish(fresh); assert.equal(publish(old).replayed, true)
    assert.equal(read().publicationId, fresh.publicationId); assert.deepEqual(read().result, fresh.result)
  })
  await test('receipt-replay-after-edit-confirms-commit-without-claiming-freshness', () => {
    reset(); play(); const body = build(); publish(body); sql("UPDATE public.games SET name='Renamed'")
    assert.equal(publish(body).replayed, true); assert.equal(read().status, 'stale'); assert.equal(read().result, null)
  })
  await test('publication-uuid-cannot-be-reused-with-another-content-or-owner', () => {
    reset(); play(); const body = build(); publish(body)
    rejected(publishSql({ ...body, result: { ...body.result, skippedPlays: 1 } }), '23505')
    rejected(publishSql({ ...body, scopeId: other }), '23505'); assert.deepEqual(read().result, body.result)
  })
  await test('two-publishers-for-the-same-uuid-serialize-and-return-one-replay', async () => {
    reset(); play(); const body = build(); const first = await hold(publishSql(body))
    const second = start(`${publishSql(body)};\n\\q\n`, 'elo-proof-second-publisher'); second.child.stdin.end()
    await expectLockWait('elo-proof-second-publisher')
    await first.finish(); const result = await second.completion; assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout.trim()).replayed, true); assert.equal(sql('SELECT count(*) FROM elo_local.publications'), '1')
  })
  await test('publisher-waits-for-source-writer-then-rejects-the-obsolete-calculation', async () => {
    reset(); play(); const body = build()
    const writer = await hold('UPDATE public.play_scores SET winner=NOT winner')
    const publisher = start(`${publishSql(body)};\n\\q\n`, 'elo-proof-publisher-after-source'); publisher.child.stdin.end()
    await expectLockWait('elo-proof-publisher-after-source')
    await writer.finish(); const result = await publisher.completion
    assert.notEqual(result.status, 0); assert.match(result.stderr, /40001/)
    assert.equal(read().status, 'missing'); assert.equal(sql('SELECT count(*) FROM elo_local.publications'), '0')
  })
  await test('source-writer-waits-for-publish-then-marks-the-generation-stale', async () => {
    reset(); play(); const old = build(); publish(old); const fresh = build()
    const publisher = await hold(publishSql(fresh))
    const writer = start('SET ROLE local_elo_writer; UPDATE public.play_scores SET winner=NOT winner;\n\\q\n', 'elo-proof-source-after-publisher'); writer.child.stdin.end()
    await expectLockWait('elo-proof-source-after-publisher')
    assert.equal(read().publicationId, old.publicationId); assert.equal(read().status, 'current')
    await publisher.finish(); const result = await writer.completion; assert.equal(result.status, 0, result.stderr)
    assert.equal(read().publicationId, fresh.publicationId); assert.equal(read().status, 'stale'); assert.equal(read().result, null)
  })
  await test('overlapping-owner-histories-do-not-overwrite-each-other', () => {
    reset(); play(); play({ scope: other, scores: [{ player: b, value: 10, winner: true }, { player: a, value: 1 }] })
    const first = build(owner); const second = build(other); publish(first); publish(second)
    assert.equal(read(owner).result.gamePlayers[game][a].rating, 1024)
    assert.equal(read(other).result.gamePlayers[game][a].rating, 976)
    assert.deepEqual(read(owner).result, first.result); assert.deepEqual(read(other).result, second.result)
  })
  await test('move-to-another-game-removes-the-old-game-from-the-generation', () => {
    reset(); const p = play(); publish(build()); sql(`UPDATE public.plays SET game_id=${quote(secondGame)} WHERE id=${quote(p)}`)
    const body = build(); publish(body); assert.deepEqual(Object.keys(read().result.gamePlayers), [secondGame])
  })
  await test('historical-owner-transfer-invalidates-both-scope-results', () => {
    reset(); const p = play(); publish(build(owner)); publish(build(other))
    sql(`UPDATE public.plays SET user_id=${quote(other)} WHERE id=${quote(p)}`)
    assert.equal(read(owner).status, 'stale'); assert.equal(read(other).status, 'stale')
    publish(build(owner)); publish(build(other)); assert.deepEqual(read(owner).result.generalPlayers, {})
    assert.equal(read(other).result.processedPlays, 1)
  })
  await test('deleting-last-game-cascades-and-publishes-an-empty-generation', () => {
    reset(); play(); publish(build()); sql(`DELETE FROM public.games WHERE id=${quote(game)}`)
    assert.equal(read().status, 'stale'); const body = build(); publish(body)
    assert.deepEqual(read().result.generalPlayers, {}); assert.deepEqual(read().result.gamePlayers, {}); assert.deepEqual(read().result.gameHistory, [])
  })
  await test('deleting-a-player-cascades-and-removes-obsolete-player-ratings', () => {
    reset(); play(); publish(build()); sql(`DELETE FROM public.players WHERE id=${quote(a)}`)
    const body = build(); assert.equal(body.result.skippedPlays, 1); publish(body)
    assert.deepEqual(read().result.generalPlayers, {}); assert.deepEqual(read().result.generalHistory, [])
  })
  await test('renamed-player-invalidates-and-refreshes-history-metadata', () => {
    reset(); play(); publish(build()); sql(`UPDATE public.players SET alias='Alias aggiornato' WHERE id=${quote(a)}`)
    assert.equal(read().status, 'stale'); publish(build())
    assert.equal(read().result.gameHistory.find(row => row.playerId === a).playerName, 'Alias aggiornato')
  })
  await test('truncate-and-empty-history-do-not-return-old-generals', () => {
    reset(); play(); publish(build()); sql('TRUNCATE public.plays CASCADE'); assert.equal(read().status, 'stale')
    publish(build()); assert.deepEqual(read().result.generalPlayers, {}); assert.deepEqual(read().result.generalHistory, [])
  })
  await test('incompatible-score-fails-before-publication-and-retains-stale-status', () => {
    reset(); play(); publish(build()); sql("UPDATE public.play_scores SET score='NaN'::numeric")
    const count = sql('SELECT count(*) FROM elo_local.publications'); assert.throws(() => build(), /score/)
    assert.equal(read().status, 'stale'); assert.equal(sql('SELECT count(*) FROM elo_local.publications'), count)
  })
  await test('incomplete-or-invalid-envelope-cannot-change-current-generation', () => {
    reset(); play(); const body = build(); publish(body)
    for (const candidate of [{ ...body, publicationId: randomUUID(), algorithm: 'unknown' },
      { ...body, publicationId: randomUUID(), sourceRevision: Number(body.sourceRevision) },
      { ...body, publicationId: randomUUID(), result: { gamePlayers: {} } }]) rejected(publishSql(candidate))
    assert.equal(read().publicationId, body.publicationId)
  })
  await test('worker-reader-and-source-writer-permissions-are-separated', () => {
    reset(); play(); const body = build()
    rejected(`SET ROLE local_elo_reader; SELECT elo_local.publish(${json(body)})`, '42501')
    rejected(`SET ROLE local_elo_reader; SELECT elo_local.snapshot(${quote(owner)}::uuid)`, '42501')
    rejected('SET ROLE local_elo_worker; UPDATE public.play_scores SET score=0', '42501')
    rejected('SET ROLE local_elo_worker; DELETE FROM elo_local.publications', '42501')
    rejected('SET ROLE local_elo_writer; SELECT * FROM elo_local.source_clock', '42501')
    sql("SET ROLE local_elo_writer; UPDATE public.players SET alias='writer change'")
    assert.notEqual(snapshot().sourceRevision, body.sourceRevision)
  })
  await test('revision-beyond-javascript-safe-integer-stays-exact', () => {
    reset(); play(); sql("UPDATE elo_local.source_clock SET revision=9007199254740993")
    const body = build(); assert.equal(body.sourceRevision, '9007199254740993'); publish(body)
    assert.equal(read().publishedRevision, '9007199254740993')
  })
  await test('global-missing-read-has-exact-envelope-and-no-publish-side-effect', () => {
    reset()
    const revision = snapshot('global').sourceRevision
    assert.deepEqual(read('global'), { scopeId: 'global', algorithm: null, status: 'missing',
      sourceRevision: revision, publishedRevision: null, publicationId: null, result: null })
    assert.equal(sql('SELECT count(*) FROM elo_local.publications'), '0')
    assert.equal(sql('SELECT count(*) FROM elo_local.heads'), '0')
  })
  await test('global-current-empty-generation-is-distinct-from-missing', () => {
    reset(); const body = build('global'); publish(body)
    const value = read('global')
    assert.equal(value.status, 'current'); assert.equal(value.algorithm, 'kingscore-elo-legacy-v1')
    assert.deepEqual(value.result, { gamePlayers: {}, generalPlayers: {}, gameHistory: [], generalHistory: [], processedPlays: 0, skippedPlays: 0 })
    assert.equal(read(owner).status, 'missing')
  })
  await test('global-ratings-recompute-all-owners-instead-of-merging-owner-ratings', () => {
    reset(); play(); play({ scope: other, scores: [{ player: b, value: 10, winner: true }, { player: a, value: 1 }] })
    const first = build(owner); const second = build(other); const global = build('global')
    publish(first); publish(second); publish(global)
    assert.equal(global.result.processedPlays, 2)
    assert.equal(read(owner).result.gamePlayers[game][a].rating, 1024)
    assert.equal(read(other).result.gamePlayers[game][a].rating, 976)
    assert.equal(read('global').result.gamePlayers[game][a].rating, 997)
    assert.equal(read('global').result.gamePlayers[game][b].rating, 1003)
    assert.deepEqual(read('global').result, global.result)
    assert.equal(sql('SELECT count(*) FROM elo_local.heads'), '3')
  })
  await test('global-snapshot-orders-cross-owner-plays-by-date-then-id-and-preserves-score-order', () => {
    reset()
    const low = '00000000-0000-0000-0000-000000009001'
    const high = '00000000-0000-0000-0000-000000009002'
    const earlier = '00000000-0000-0000-0000-000000009003'
    play({ scope: other, playId: high })
    play({ scope: owner, playId: low, scores: [{ player: c, value: null }, { player: a, value: null }, { player: b, value: 5 }] })
    play({ scope: other, playId: earlier, day: '2026-10-14' })
    const source = snapshot('global')
    assert.equal(source.scopeId, 'global'); assert.deepEqual(source.plays.map(row => row.id), [earlier, low, high])
    assert.deepEqual(source.plays[1].play_scores.map(row => row.player_id), [c, a, b])
    assert.equal(snapshot(owner).plays.length, 1); assert.equal(snapshot(other).plays.length, 2)
    const body = buildEloPublication(source, randomUUID()); publish(body); assert.deepEqual(read('global').result, body.result)
  })
  await test('decoder-rejects-actual-sql-owner-envelope-when-global-is-required', () => {
    reset(); play(); publish(build(owner)); publish(build('global'))
    assert.throws(() => decodeEloRead(rawRead(owner), 'global'))
    assert.throws(() => decodeEloRead(rawRead('global'), owner))
    assert.equal(read('global').status, 'current'); assert.equal(read(owner).status, 'current')
  })
  await test('global-publication-turns-stale-after-another-owner-edits-and-recovers-as-one-generation', () => {
    reset(); play(); const p = play({ scope: other }); const old = build('global'); publish(old)
    sql(`UPDATE public.play_scores SET winner=NOT winner WHERE play_id=${quote(p)}`)
    const dirty = read('global')
    assert.equal(dirty.status, 'stale'); assert.equal(dirty.scopeId, 'global')
    assert.equal(dirty.algorithm, 'kingscore-elo-legacy-v1'); assert.equal(dirty.result, null)
    assert.equal(dirty.publicationId, old.publicationId); assert.equal(dirty.publishedRevision, old.sourceRevision)
    rejected(publishSql({ ...old, publicationId: randomUUID() }), '40001')
    const fresh = build('global'); publish(fresh)
    assert.equal(read('global').status, 'current'); assert.deepEqual(read('global').result, fresh.result)
  })
  await test('global-and-owner-read-paths-work-in-read-only-transactions-without-dml', () => {
    reset(); play(); play({ scope: other }); publish(build(owner)); publish(build('global'))
    const fingerprint = () => sql(`SELECT md5(jsonb_build_object(
      'clock',(SELECT jsonb_agg(to_jsonb(t)) FROM elo_local.source_clock t),
      'heads',(SELECT jsonb_agg(to_jsonb(t) ORDER BY scope_id) FROM elo_local.heads t),
      'publications',(SELECT jsonb_agg(to_jsonb(t) ORDER BY publication_id) FROM elo_local.publications t)
    )::text)`)
    const before = fingerprint()
    for (const [scope, expression] of [['global', 'elo_local.read_global()'], [owner, `elo_local.read(${quote(owner)}::uuid)`]]) {
      const value = query(`BEGIN READ ONLY; SET LOCAL ROLE local_elo_reader; SELECT ${expression}; COMMIT`)
      assert.equal(decodeEloRead(value, scope).status, 'current')
    }
    const globalSnapshot = query('BEGIN READ ONLY; SET LOCAL ROLE local_elo_worker; SELECT elo_local.snapshot_global(); COMMIT')
    assert.equal(globalSnapshot.scopeId, 'global'); assert.equal(globalSnapshot.plays.length, 2)
    assert.equal(fingerprint(), before)
    rejected('SET ROLE local_elo_reader; UPDATE public.play_scores SET score=0', '42501')
    rejected('SET ROLE local_elo_reader; SELECT elo_local.snapshot_global()', '42501')
    rejected("SET ROLE local_elo_reader; SELECT elo_local.read_scope('global')", '42501')
    rejected("SET ROLE local_elo_worker; SELECT elo_local.snapshot_scope('global')", '42501')
  })
  await test('all-four-projections-share-one-sql-global-generation-and-hide-stale-data', () => {
    reset(); play(); play({ scope: other, gameId: secondGame }); const body = build('global'); publish(body)
    const current = read('global')
    const views = [generalStandings(current), gameStandings(current, game), generalHistory(current), gameHistory(current, game)]
    for (const view of views) {
      assert.equal(view.scopeId, 'global'); assert.equal(view.publicationId, body.publicationId)
      assert.equal(view.publishedRevision, body.sourceRevision); assert.equal(view.sourceRevision, body.sourceRevision)
      assert.equal(view.status, 'current'); assert.equal(view.algorithm, body.algorithm)
    }
    assert.equal(views[0].data.length, 2); assert.equal(views[1].data.length, 2)
    assert.equal(views[2].data.length, 4); assert.equal(views[3].data.length, 2)
    assert.equal(views[0].data.find(row => row.playerId === a).rating, 1024)
    assert.equal(views[0].data.find(row => row.playerId === a).gamesPlayed, 2)
    assert.equal(views[1].data.find(row => row.playerId === a).rating, 1024)
    assert.equal(generalHistory(current, a).data.length, 2); assert.equal(gameHistory(current, secondGame, b).data.length, 1)
    sql("UPDATE public.players SET alias='Renamed after publication' WHERE name='Anna'")
    const dirty = read('global')
    for (const view of [generalStandings(dirty), gameStandings(dirty, game), generalHistory(dirty), gameHistory(dirty, game)]) {
      assert.equal(view.status, 'stale'); assert.equal(view.data, null); assert.equal(view.publicationId, body.publicationId)
    }
    const missing = read(owner)
    for (const view of [generalStandings(missing), gameStandings(missing, game), generalHistory(missing), gameHistory(missing, game)]) {
      assert.equal(view.status, 'missing'); assert.equal(view.data, null); assert.equal(view.publicationId, null)
    }
  })
  await test('global-replay-does-not-replace-a-newer-global-or-owner-head', () => {
    reset(); play(); const old = build('global'); publish(old)
    sql("UPDATE public.players SET alias='Global rename' WHERE name='Anna'")
    const fresh = build('global'); const ownerBody = build(owner); publish(fresh); publish(ownerBody)
    assert.equal(publish(old).replayed, true)
    assert.equal(read('global').publicationId, fresh.publicationId); assert.equal(read(owner).publicationId, ownerBody.publicationId)
  })
  await test('scope-validation-rejects-noncanonical-or-unknown-values-before-head-swap', () => {
    reset(); play(); const body = build('global'); publish(body)
    for (const scope of ['GLOBAL', 'global ', '', 'all', 'AAAAAAAA-0000-0000-0000-000000000000']) {
      rejected(publishSql({ ...body, publicationId: randomUUID(), scopeId: scope }), '22023')
    }
    assert.equal(read('global').publicationId, body.publicationId)
    assert.equal(sql('SELECT count(*) FROM elo_local.heads'), '1')
  })
  await test('complete-history-over-1000-plays-is-never-treated-as-a-partial-cache', () => {
    reset()
    sql(`BEGIN; INSERT INTO public.plays(id,user_id,game_id,played_at)
      SELECT ('00000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid, ${quote(owner)}, ${quote(game)}, '2026-10-15'::date
      FROM generate_series(100000,101199) i;
      INSERT INTO public.play_scores(id,play_id,player_id,score,winner,draw,position,ordinal)
      SELECT ('00000000-0000-0000-0000-' || lpad((i*2+j)::text,12,'0'))::uuid,
        ('00000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,
        CASE WHEN j=0 THEN ${quote(a)}::uuid ELSE ${quote(b)}::uuid END,
        CASE WHEN j=0 THEN 10 ELSE 5 END, j=0, false, j+1, j
      FROM generate_series(100000,101199) i CROSS JOIN generate_series(0,1) j; COMMIT`)
    const source = snapshot(); assert.equal(source.plays.length, 1200)
    const body = buildEloPublication(source, randomUUID()); publish(body)
    assert.equal(read().result.processedPlays, 1200)
    assert.equal(read().result.gameHistory.length, 2400); assert.equal(read().result.generalHistory.length, 2400)
    assert.deepEqual(read().result, body.result)
  })
  report.status = 'PASS'
} catch (error) {
  report.failure = `${currentCase ?? 'preflight'}: ${error.stack ?? error}`
  console.error(report.failure)
} finally {
  for (const child of children) child.kill()
  report.finishedAt = new Date().toISOString()
  writeFileSync(join(directory, 'acceptance-report.json'), JSON.stringify(report, null, 2) + '\n')
}
if (report.status !== 'PASS') process.exitCode = 1
