// Real local PostgREST/JWT checks, never GoTrue login or a cloud-project test.
/* global process */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, createHash, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:net';
import { open, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const [pgBin, pgPortText, directoryArgument, executableArgument] = process.argv.slice(2);
const workspace = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const directory = resolve(directoryArgument || '.');
const executable = resolve(executableArgument || '.');
assert(pgBin && /^\d+$/.test(pgPortText || '') && Number(pgPortText) > 0 && Number(pgPortText) < 65536, 'Expected local PostgreSQL bin and port');
assert(directory.startsWith(resolve(workspace, '.work', 'atomic-play-tests') + sep), 'Report directory must belong to this isolated harness');
assert(executable.startsWith(workspace + sep) && executable.endsWith('.exe'), 'Expected workspace-local PostgREST executable');
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('PG')));
environment.PGPASSFILE = join(directory, 'empty.pgpass');
environment.PGCONNECT_TIMEOUT = '5';
const report = {
  status: 'FAIL', host: '127.0.0.1', gatewayPort: null, pgPort: Number(pgPortText),
  node: process.version, postgrestVersion: null, postgrestBinarySha256: null,
  postgresVersion: null, eloStateUnchanged: false,
  tokenIssuance: 'synthetic-local-HS256', goTrueLoginTested: false, cloudProjectTested: false,
  cases: [], caseCount: 0, ownGatewayStopped: true, failureCase: null,
};
const accountA = 'e1000000-0000-0000-0000-000000000001';
const accountB = 'e1000000-0000-0000-0000-000000000002';
const ordinaryAccount = 'e1000000-0000-0000-0000-000000000003';
const game = 'e2000000-0000-0000-0000-000000000001';
const players = ['e3000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000002'];
const legacyPlay = 'e4000000-0000-0000-0000-000000000001';
const requestId = number => `e8000000-0000-0000-0000-${String(number).padStart(12, '0')}`;
const exact = '9007199254740993.1250000000000001';
const exactMarker = '__SYNTHETIC_EXACT_NUMERIC__';
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const encodeBody = value => JSON.stringify(value).replaceAll(`"${exactMarker}"`, exact);
const payload = (score = exactMarker) => ({
  game_id: game, played_at: '2026-10-13', duration_minutes: 0, source: 'offline', notes: 'HTTP fixture 😀',
  is_cooperative: false, team_won: null,
  scores: [
    { id: null, player_id: players[0], score, winner: true, color: 'blue', role: 'mage' },
    { id: null, player_id: players[1], score: null, winner: false, color: null, role: null },
  ],
});
let gateway;
let gatewayExit;
let outputLog;
let errorLog;
let activeCase = 'bootstrap';
let baseUrl;
const eloSnapshotSql = `SELECT jsonb_build_object(
  'ratings',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.player_ratings t),
  'general',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.player_general_ratings t),
  'history',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.elo_history t),
  'runs',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.elo_recalc_runs t));`;

async function localProcess(program, args, input) {
  const child = spawn(program, args, { env: environment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  const timeout = setTimeout(() => child.kill(), 15000);
  return new Promise((fulfill, reject) => {
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.stdin.on('error', reject);
    child.on('close', code => { clearTimeout(timeout); fulfill({ code, stdout, stderr }); });
    child.stdin.end(input);
  });
}
async function sql(statement) {
  const result = await localProcess(join(pgBin, 'psql.exe'), ['-X', '-w', '-h', '127.0.0.1', '-p', pgPortText,
    '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-q'], statement);
  assert.equal(result.code, 0, 'Local synthetic SQL setup/check failed');
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}
async function freeLoopbackPort() {
  const server = createServer();
  await new Promise((fulfill, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', fulfill); });
  const port = server.address().port;
  await new Promise((fulfill, reject) => server.close(error => error ? reject(error) : fulfill()));
  return port;
}
function signedToken(secret, subject, admin, extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { role: 'authenticated', aud: 'authenticated', sub: subject, iat: now,
    exp: now + 3600, app_metadata: admin ? { role: 'admin' } : {}, user_metadata: { name: 'Synthetic HTTP fixture' }, ...extra };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}
async function http(name, path, token, body, expectedStatus = 200, method = 'POST', extraHeaders = {}) {
  activeCase = name;
  assert(path.startsWith('/') && !path.startsWith('//'), 'Only local relative paths allowed');
  const headers = { ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  // One fetch per mutation. Only gateway readiness below retries GET requests.
  const response = await fetch(baseUrl + path, { method, headers, redirect: 'error',
    body: body === undefined ? undefined : encodeBody(body), signal: AbortSignal.timeout(5000) });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { assert.fail('Gateway returned non-JSON response'); }
  const statuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  const code = /^[A-Za-z0-9_]{1,16}$/.test(data?.code || '') ? data.code : null;
  report.cases.push({ name, method, status: response.status, code });
  report.caseCount = report.cases.length;
  assert(statuses.includes(response.status), `Unexpected HTTP status for ${name}: ${response.status}`);
  return { data, raw, status: response.status };
}
const rpc = (name, fn, token, body, status = 200) => http(name, `/rpc/${fn}`, token, body, status);
function checkCode(response, expected) { assert.equal(response.data.code, expected, 'Unexpected gateway error code'); }
function checkRawExact(raw) {
  const escaped = exact.replaceAll('.', '\\.');
  assert(new RegExp(`"score"\\s*:\\s*${escaped}(?=\\s*[,}])`).test(raw), 'Exact NUMERIC decimal must survive raw HTTP JSON');
}
function editPayload(editor, score = exact) {
  const play = editor.detail.play;
  return { game_id: play.game_id, played_at: play.played_at, duration_minutes: play.duration_minutes,
    source: play.source, notes: play.notes, is_cooperative: play.is_cooperative, team_won: play.team_won,
    scores: editor.detail.scores.map(({ score: row }) => ({ id: row.id, player_id: row.player_id,
      score: row.player_id === players[0] ? score : null, winner: row.winner, color: row.color, role: row.role })) };
}

async function main() {
  const version = await localProcess(executable, ['--version']);
  assert.equal(version.code, 0, 'PostgREST version command failed');
  report.postgrestVersion = version.stdout.trim();
  assert(/^PostgREST\s+14\.1\b/.test(report.postgrestVersion), 'Expected verified PostgREST 14.1');
  report.postgrestBinarySha256 = createHash('sha256').update(await readFile(executable)).digest('hex');
  [report.postgresVersion] = await sql('SELECT to_jsonb(version());');
  await sql(`INSERT INTO auth.users(id,email) VALUES (${literal(accountA)},'http-admin-a@synthetic.invalid'),
    (${literal(accountB)},'http-admin-b@synthetic.invalid'),(${literal(ordinaryAccount)},'http-user@synthetic.invalid');
    INSERT INTO public.games(id,name) VALUES (${literal(game)},'HTTP synthetic game');
    INSERT INTO public.players(id,user_id,name) VALUES (${literal(players[0])},${literal(accountB)},'HTTP player one'),
      (${literal(players[1])},${literal(ordinaryAccount)},'HTTP player two');
    INSERT INTO public.plays(id,user_id,game_id,played_at,location,notes,duration_minutes,source,bga_table_id,created_at,is_cooperative)
      VALUES (${literal(legacyPlay)},${literal(accountA)},${literal(game)},'2026-10-12','Legacy location','Legacy notes',45,'offline','http-legacy-table','2026-01-01T10:00:00Z',false);
    INSERT INTO public.play_scores(id,play_id,player_id,score,winner,color,role,position) VALUES
      ('e5000000-0000-0000-0000-000000000001',${literal(legacyPlay)},${literal(players[0])},1.25,true,'red','leader',1),
      ('e5000000-0000-0000-0000-000000000002',${literal(legacyPlay)},${literal(players[1])},null,false,null,null,2);
    INSERT INTO public.player_ratings(player_id,game_id,rating,games_played) VALUES (${literal(players[0])},${literal(game)},1234,17);
    INSERT INTO public.player_general_ratings(player_id,user_id,rating,games_played) VALUES (${literal(players[0])},${literal(accountA)},1345,19);
    INSERT INTO public.elo_history(play_id,game_id,player_id,player_name,rating,rating_change,date)
      VALUES (${literal(legacyPlay)},${literal(game)},${literal(players[0])},'HTTP player one',1234,12,'2026-10-12T12:00:00Z');
    INSERT INTO public.elo_recalc_runs(status,summary) VALUES ('succeeded','{"http-sentinel":true}');
    SELECT to_jsonb(true);`);
  const [eloBefore] = await sql(eloSnapshotSql);
  const secret = randomBytes(64).toString('hex');
  const adminA = signedToken(secret, accountA, true);
  report.gatewayPort = await freeLoopbackPort();
  baseUrl = `http://127.0.0.1:${report.gatewayPort}`;
  const config = join(directory, 'postgrest-http.conf');
  await writeFile(config, `db-uri = "postgresql://postgres@127.0.0.1:${pgPortText}/postgres"\ndb-schemas = "public"\ndb-anon-role = "anon"\nserver-host = "127.0.0.1"\nserver-port = ${report.gatewayPort}\njwt-secret = "${secret}"\ndb-pool = 5\nlog-level = "error"\n`, { mode: 0o600 });
  outputLog = await open(join(directory, 'postgrest.stdout.log'), 'w', 0o600);
  errorLog = await open(join(directory, 'postgrest.stderr.log'), 'w', 0o600);
  gateway = spawn(executable, [config], { env: environment, windowsHide: true, stdio: ['ignore', outputLog.fd, errorLog.fd] });
  report.ownGatewayStopped = false;
  gatewayExit = new Promise(fulfill => { gateway.once('error', () => fulfill()); gateway.once('close', fulfill); });
  const deadline = Date.now() + 15000;
  let ready = false;
  while (Date.now() < deadline) {
    if (gateway.exitCode !== null || gateway.signalCode !== null) break;
    try {
      // A signed GET also rules out a different gateway winning the port race.
      const response = await fetch(baseUrl + '/plays?limit=0', { method: 'GET', headers: { Authorization: `Bearer ${adminA}` },
        redirect: 'error', signal: AbortSignal.timeout(1000) });
      await response.text();
      if (response.ok) { ready = true; break; }
    } catch { /* Startup only; GET can retry without replaying a mutation. */ }
    await new Promise(fulfill => setTimeout(fulfill, 100));
  }
  assert(ready, 'Own local gateway did not become ready');
  const adminB = signedToken(secret, accountB, true);
  const ordinary = signedToken(secret, ordinaryAccount, false);
  const spoof = signedToken(secret, ordinaryAccount, false, { user_metadata: { role: 'admin' } });
  const wrongSignature = signedToken(randomBytes(64).toString('hex'), accountA, true);
  const expired = signedToken(secret, accountA, true, { exp: Math.floor(Date.now() / 1000) - 60 });
  const createArgs = { p_request_id: requestId(1), p_payload: payload() };
  await rpc('anonymous create denied', 'create_play_v1', null, createArgs, [401, 403]);
  for (const [name, fn, args] of [
    ['ordinary create denied', 'create_play_v1', createArgs],
    ['ordinary editor denied', 'get_play_editor_v1', { p_play_id: legacyPlay }],
    ['ordinary update denied', 'update_play_v1', { p_request_id: requestId(2), p_play_id: legacyPlay, p_expected_revision: 'opaque', p_payload: payload() }],
    ['ordinary delete denied', 'delete_play_v1', { p_request_id: requestId(3), p_play_id: legacyPlay, p_expected_revision: 'opaque' }],
  ]) checkCode(await rpc(name, fn, ordinary, args, 403), '42501');
  checkCode(await rpc('user_metadata cannot grant admin', 'create_play_v1', spoof, createArgs, 403), '42501');
  await rpc('wrong HS256 signature rejected', 'create_play_v1', wrongSignature, createArgs, 401);
  await rpc('expired signed JWT rejected', 'create_play_v1', expired, createArgs, 401);

  const created = (await rpc('Android numeric create', 'create_play_v1', adminA, createArgs)).data;
  assert.equal(created.replayed, false); assert.match(created.revision, /^v1:/);
  let numericEditor = await rpc('Android editor exact numeric JSON', 'get_play_editor_v1', adminA, { p_play_id: created.play_id });
  checkRawExact(numericEditor.raw);
  assert.equal(numericEditor.data.detail.scores.find(s => s.score.player_id === players[1]).score.score, null);
  const [storedExact] = await sql(`SELECT to_jsonb(score::text) FROM public.play_scores WHERE play_id=${literal(created.play_id)} AND player_id=${literal(players[0])};`);
  assert.equal(storedExact, exact, 'Database NUMERIC is exact');
  const createReplay = (await rpc('Android create replay', 'create_play_v1', adminA, createArgs)).data;
  assert.equal(createReplay.play_id, created.play_id); assert.equal(createReplay.replayed, true);
  checkCode(await rpc('request key content conflict', 'create_play_v1', adminA,
    { ...createArgs, p_payload: { ...payload(), notes: 'Different explicit request' } }, 409), 'PT409');
  const numericUpdated = (await rpc('Android exact numeric atomic update', 'update_play_v1', adminA,
    { p_request_id: requestId(13), p_play_id: created.play_id, p_expected_revision: numericEditor.data.revision,
      p_payload: { ...editPayload(numericEditor.data, exactMarker), notes: 'Android numeric update' } })).data;
  numericEditor = await rpc('Android updated editor keeps exact numeric JSON', 'get_play_editor_v1', adminA, { p_play_id: created.play_id });
  checkRawExact(numericEditor.raw);
  assert.equal(numericEditor.data.revision, numericUpdated.revision);

  const webCreateArgs = { p_request_id: requestId(4), p_payload: payload(exact) };
  const webCreated = (await rpc('Browser decimal-text create', 'create_web_play_v1', adminB, webCreateArgs)).data;
  const webEditor = (await rpc('Browser editor returns exact decimal text', 'get_web_play_editor_v1', adminB, { p_play_id: webCreated.play_id })).data;
  assert.equal(webEditor.detail.scores.find(s => s.score.player_id === players[0]).score.score, exact);
  const browserUpdateArgs = { p_request_id: requestId(5), p_play_id: created.play_id,
    p_expected_revision: numericEditor.data.revision, p_payload: { ...editPayload(numericEditor.data), notes: 'Other admin edit 😀' } };
  const browserUpdated = (await rpc('Browser admin updates another owner', 'update_web_play_v1', adminB, browserUpdateArgs)).data;
  const after = await rpc('Updated numeric editor preserves owner and score metadata', 'get_play_editor_v1', adminA, { p_play_id: created.play_id });
  checkRawExact(after.raw);
  assert.equal(after.data.detail.play.user_id, accountA); assert.equal(after.data.detail.play.notes, 'Other admin edit 😀');
  assert.equal(after.data.detail.scores.find(s => s.score.player_id === players[0]).score.color, 'blue');
  assert.equal(after.data.detail.scores.find(s => s.score.player_id === players[0]).score.role, 'mage');
  checkCode(await rpc('optimistic revision conflict is HTTP409', 'update_web_play_v1', adminB,
    { ...browserUpdateArgs, p_request_id: requestId(6) }, 409), 'PT409');

  const legacyBefore = (await rpc('Read cross-owner legacy metadata', 'get_web_play_editor_v1', adminB, { p_play_id: legacyPlay })).data;
  const legacyPayload = { ...editPayload(legacyBefore, '1.25'), notes: 'Legacy notes edited' };
  await rpc('Cross-owner legacy atomic update', 'update_web_play_v1', adminB,
    { p_request_id: requestId(7), p_play_id: legacyPlay, p_expected_revision: legacyBefore.revision, p_payload: legacyPayload });
  const legacyAfter = (await rpc('Legacy noneditable fields and IDs preserved', 'get_web_play_editor_v1', adminB, { p_play_id: legacyPlay })).data;
  for (const key of ['user_id', 'location', 'bga_table_id', 'created_at']) assert.equal(legacyAfter.detail.play[key], legacyBefore.detail.play[key]);
  assert.deepEqual(legacyAfter.detail.scores.map(s => s.score.id), legacyBefore.detail.scores.map(s => s.score.id));
  assert.equal(legacyAfter.detail.scores.find(s => s.score.player_id === players[0]).score.color, 'red');
  assert.equal(legacyAfter.detail.scores.find(s => s.score.player_id === players[0]).score.role, 'leader');

  const validPlayBody = { user_id: accountA, game_id: game, played_at: '2026-10-13', source: 'offline' };
  const validScoreBody = { play_id: legacyPlay, player_id: players[0], score: 1, winner: false };
  for (const [table, body, selector] of [['plays', validPlayBody, `id=eq.${legacyPlay}`], ['play_scores', validScoreBody, `play_id=eq.${legacyPlay}`]]) {
    await http(`cutover blocks direct ${table} POST`, `/${table}`, adminA, body, 403, 'POST');
    await http(`cutover blocks direct ${table} PATCH`, `/${table}?${selector}`, adminA, table === 'plays' ? { notes: 'Blocked' } : { score: 2 }, 403, 'PATCH');
    await http(`cutover blocks direct ${table} DELETE`, `/${table}?${selector}`, adminA, undefined, 403, 'DELETE');
  }
  await rpc('legacy replace RPC disabled', 'replace_play_scores', adminA, { p_play_id: legacyPlay, p_scores: [] }, [403, 404]);
  await http('private receipts not in public schema', '/play_write_receipts', adminA, undefined, 404, 'GET');
  await rpc('private helper not in public RPC schema', 'require_play_admin', adminA, {}, 404);
  await http('private profile selection forbidden', '/play_write_receipts', adminA, undefined, 406, 'GET', { 'Accept-Profile': 'kingscore_private' });

  const importArgs = { p_request_id: requestId(8), p_payload: payload(1.25),
    p_metadata: { location: 'HTTP BGA location 😀', bga_table_id: 'http-bga-table' }, p_positions: [7, null] };
  const imported = (await rpc('BGA atomic import', 'import_bga_play_v1', adminA, importArgs)).data;
  assert.equal(imported.skipped, false); assert.equal(imported.replayed, false);
  const importEditor = (await rpc('BGA external positions and metadata preserved', 'get_play_editor_v1', adminA, { p_play_id: imported.play_id })).data;
  assert.equal(importEditor.detail.play.location, importArgs.p_metadata.location); assert.equal(importEditor.detail.play.bga_table_id, 'http-bga-table');
  assert.equal(importEditor.detail.scores.find(s => s.score.player_id === players[0]).score.position, 7);
  assert.equal(importEditor.detail.scores.find(s => s.score.player_id === players[1]).score.position, null);
  const importReplay = (await rpc('BGA receipt replay', 'import_bga_play_v1', adminA, importArgs)).data;
  assert.equal(importReplay.play_id, imported.play_id); assert.equal(importReplay.replayed, true);
  const skipped = (await rpc('BGA other request deduplicates actor and table', 'import_bga_play_v1', adminA,
    { ...importArgs, p_request_id: requestId(9), p_metadata: { ...importArgs.p_metadata, location: 'Must not overwrite' } })).data;
  assert.equal(skipped.play_id, imported.play_id); assert.equal(skipped.skipped, true);
  const unchangedImport = (await rpc('BGA dedup leaves existing content intact', 'get_play_editor_v1', adminA, { p_play_id: imported.play_id })).data;
  assert.deepEqual(unchangedImport, importEditor);

  const deleteArgs = { p_request_id: requestId(10), p_play_id: created.play_id, p_expected_revision: browserUpdated.revision };
  const deleted = (await rpc('Atomic delete through HTTP', 'delete_play_v1', adminA, deleteArgs)).data;
  assert.equal(deleted.deleted, true); assert.equal(deleted.replayed, false);
  const deleteReplay = (await rpc('Delete receipt after target removed', 'delete_play_v1', adminA, deleteArgs)).data;
  assert.equal(deleteReplay.deleted, true); assert.equal(deleteReplay.replayed, true);
  checkCode(await rpc('Missing delete target is HTTP404', 'delete_play_v1', adminA, { ...deleteArgs, p_request_id: requestId(11) }, 404), 'PT404');
  checkCode(await rpc('Missing editor target is HTTP404', 'get_play_editor_v1', adminA, { p_play_id: created.play_id }, 404), 'PT404');
  const updateReplay = (await rpc('Update receipt after subsequent delete', 'update_web_play_v1', adminB, browserUpdateArgs)).data;
  assert.equal(updateReplay.play_id, created.play_id); assert.equal(updateReplay.revision, browserUpdated.revision); assert.equal(updateReplay.replayed, true);
  checkCode(await rpc('Invalid payload maps to HTTP400', 'create_play_v1', adminA,
    { p_request_id: requestId(12), p_payload: { ...payload(), duration_minutes: -1 } }, 400), '22023');
  activeCase = 'ELO database sentinels unchanged';
  const [eloAfter] = await sql(eloSnapshotSql);
  assert.deepEqual(eloAfter, eloBefore, 'HTTP writes must not recalculate ratings, erase unrelated history or enqueue ELO jobs');
  report.eloStateUnchanged = true;
  report.status = 'PASS';
}

async function run() {
try { await main(); }
catch {
  report.failureCase = activeCase;
  report.status = 'FAIL';
  process.exitCode = 1;
  console.error(`FAIL: local HTTP case ${activeCase}. See local gateway logs.`);
} finally {
  if (gateway && gateway.exitCode === null && gateway.signalCode === null) gateway.kill();
  if (gatewayExit) {
    let timeout;
    const closed = await Promise.race([gatewayExit.then(() => true), new Promise(fulfill => { timeout = setTimeout(() => fulfill(false), 5000); })]);
    clearTimeout(timeout);
    report.ownGatewayStopped = closed;
    if (!closed) { report.status = 'FAIL'; report.failureCase = 'stop-own-gateway'; process.exitCode = 1; }
  }
  await outputLog?.close(); await errorLog?.close();
  await writeFile(join(directory, 'http-report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(`${report.status}: ${report.caseCount} local HTTP checks; own gateway stopped: ${report.ownGatewayStopped}`);
}
}
run().catch(() => { process.exitCode = 1; console.error('FAIL: local HTTP cleanup or report writing.'); });
