// Local PostgreSQL only. No Supabase URL, dotenv, account tokens or remote SDK.
/* global process */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assignPositions } from '../../src/utils/elo/positions.ts';

const [pgBin, portText, reportDirectory] = process.argv.slice(2);
assert(pgBin && reportDirectory && /^\d+$/.test(portText), 'Expected PGbin, port and report directory');
const port = Number(portText);
assert(port > 0 && port < 65536);
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('PG')));
environment.PGPASSFILE = join(resolve(reportDirectory), 'empty.pgpass');
environment.PGCONNECT_TIMEOUT = '5';
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${literal(JSON.stringify(value))}::jsonb`;
const account = '90000000-0000-0000-0000-000000000001';
const game = '90000000-0000-0000-0000-000000000002';
const player = '90000000-0000-0000-0000-000000000003';
const request = n => `90000000-0000-0000-0001-${String(n).padStart(12, '0')}`;
const claims = { sub: account, app_metadata: { role: 'admin' } };
const auth = `SET ROLE authenticated; SET request.jwt.claims = ${literal(JSON.stringify(claims))};`;
const payload = {
  game_id: game, played_at: '2026-10-13', duration_minutes: 25, source: 'offline', notes: 'concurrency fixture',
  is_cooperative: false, team_won: null,
  scores: [{ id: null, player_id: player, score: 1.25, winner: true, color: 'red', role: 'mage' }],
};
const report = { status: 'FAIL', node: process.version, v8: process.versions.v8, rankingCases: 0, concurrencyChecks: [] };

function session(sql, onOutput = () => {}) {
  const child = spawn(join(pgBin, 'psql.exe'), ['-X', '-w', '-h', '127.0.0.1', '-p', String(port),
    '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-A', '-t', '-q'],
  { env: environment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  const timeout = setTimeout(() => child.kill(), 20000);
  const promise = new Promise((fulfill, reject) => {
    child.on('error', reject);
    child.stdout.on('data', data => { stdout += data; onOutput(stdout); });
    child.stderr.on('data', data => { stderr += data; });
    child.on('close', code => { clearTimeout(timeout); fulfill({ code, stdout, stderr }); });
    child.stdin.on('error', reject);
    child.stdin.end(sql);
  });
  return promise;
}
async function query(sql) {
  const result = await session(sql);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}
async function gatedRace(lockSql, actions) {
  let signal; const ready = new Promise(fulfill => { signal = fulfill; });
  const blocker = session(`BEGIN; ${lockSql}; SELECT 'LOCK_READY'; SELECT pg_sleep(1); COMMIT;`,
    output => { if (output.includes('LOCK_READY')) signal(); });
  // Reject a broken barrier immediately; never wait forever for a READY message.
  await Promise.race([ready, blocker.then(result => { throw new Error(`Barrier ended: ${result.stderr}`); })]);
  const results = await Promise.all(actions.map(action => session(auth + action)));
  assert.equal((await blocker).code, 0);
  return results;
}

async function main() {
try {
  [report.postgres] = await query('SELECT to_jsonb(version());');
  await query(`INSERT INTO auth.users(id) VALUES (${literal(account)});
    INSERT INTO public.games(id,name) VALUES (${literal(game)},'Concurrent fixture');
    INSERT INTO public.players(id,name) VALUES (${literal(player)},'Concurrent fixture'); SELECT to_jsonb(true);`);
  const create = `SELECT public.create_play_v1(${literal(request(1))}, ${json(payload)});`;
  const createResults = await gatedRace(
    `SELECT pg_advisory_xact_lock(hashtextextended(${literal(account + '/' + request(1))},0))`, [create, create]);
  assert(createResults.every(result => result.code === 0), JSON.stringify(createResults));
  const created = createResults.map(result => JSON.parse(result.stdout.trim()));
  assert.equal(new Set(created.map(result => result.play_id)).size, 1);
  assert.deepEqual(created.map(result => result.replayed).sort(), [false, true]);
  const playId = created[0].play_id;
  report.concurrencyChecks.push('same create request: one commit and one replay');

  const updatePayload = { ...payload, notes: 'concurrent update' };
  const updates = [2, 3].map(n => `SELECT public.update_play_v1(${literal(request(n))},${literal(playId)},
    ${literal(created[0].revision)},${json(updatePayload)});`);
  const updateResults = await gatedRace(`SELECT id FROM public.plays WHERE id=${literal(playId)} FOR UPDATE`, updates);
  assert.equal(updateResults.filter(result => result.code === 0).length, 1);
  const loser = updateResults.find(result => result.code !== 0);
  assert.match(loser.stderr, /PT409/);
  const [{ scores, receipts }] = await query(`SELECT json_build_object('scores',(SELECT count(*) FROM public.play_scores WHERE play_id=${literal(playId)}),
    'receipts',(SELECT count(*) FROM kingscore_private.play_write_receipts WHERE actor_id=${literal(account)}));`);
  assert.equal(scores, 1); assert.equal(receipts, 2);
  report.concurrencyChecks.push('two updates with one revision: one commit and one conflict, no partial rows');

  const [snapshot] = await query(auth + `SELECT public.get_play_editor_v1(${literal(playId)});`);
  const deletes = [4, 5].map(n => `SELECT public.delete_play_v1(${literal(request(n))},${literal(playId)},${literal(snapshot.revision)});`);
  const deleteResults = await gatedRace(`SELECT id FROM public.plays WHERE id=${literal(playId)} FOR UPDATE`, deletes);
  assert.equal(deleteResults.filter(result => result.code === 0).length, 1);
  assert.match(deleteResults.find(result => result.code !== 0).stderr, /PT404/);
  const winnerIndex = deleteResults.findIndex(result => result.code === 0);
  const [deleteReplay] = await query(auth + deletes[winnerIndex]);
  assert.equal(deleteReplay.deleted, true); assert.equal(deleteReplay.replayed, true);
  report.concurrencyChecks.push('two deletes: one deletion, one missing target; winner retries after deletion');

  const [capabilities] = await query("SELECT json_build_object('bga',to_regprocedure('public.import_bga_play_v1(uuid,jsonb,jsonb,jsonb)') IS NOT NULL,'web',to_regprocedure('public.create_web_play_v1(uuid,jsonb)') IS NOT NULL);");
  if (capabilities.bga) {
    const metadata = { location: 'Original BGA location', bga_table_id: 'concurrent-bga-table' };
    const imports = [11,12].map(n => `SELECT public.import_bga_play_v1(${literal(request(n))},${json(payload)},${json(metadata)},'[2]'::jsonb);`);
    const results = await gatedRace(`SELECT pg_advisory_xact_lock(hashtextextended(${literal('import-bga/' + account + '/' + metadata.bga_table_id)},0))`,imports);
    assert(results.every(result => result.code === 0), JSON.stringify(results));
    const values = results.map(result => JSON.parse(result.stdout.trim()));
    assert.equal(new Set(values.map(value => value.play_id)).size,1);
    assert.deepEqual(values.map(value => value.skipped).sort(),[false,true]);
    const [rows] = await query(`SELECT json_build_object('plays',(SELECT count(*) FROM public.plays WHERE user_id=${literal(account)} AND bga_table_id=${literal(metadata.bga_table_id)}),
      'position',(SELECT "position" FROM public.play_scores WHERE play_id=${literal(values[0].play_id)}));`);
    assert.equal(rows.plays,1); assert.equal(rows.position,2);
    report.concurrencyChecks.push('two BGA requests for one table: one import and one skip, external position preserved');
    const retryMetadata = { ...metadata, bga_table_id: 'same-request-bga-table' };
    const sameRequest = `SELECT public.import_bga_play_v1(${literal(request(13))},${json(payload)},${json(retryMetadata)},'[null]'::jsonb);`;
    const sameResults = await gatedRace(`SELECT pg_advisory_xact_lock(hashtextextended(${literal(account + '/' + request(13))},0))`,[sameRequest,sameRequest]);
    assert(sameResults.every(result => result.code === 0),JSON.stringify(sameResults));
    const sameValues = sameResults.map(result => JSON.parse(result.stdout.trim()));
    assert.deepEqual(sameValues.map(value => value.replayed).sort(),[false,true]);
    assert.equal(sameValues[0].play_id,sameValues[1].play_id);
    report.concurrencyChecks.push('same BGA request: one commit and one receipt replay');
  }
  if (capabilities.web) {
    const exactPayload = { ...payload, scores: [{ ...payload.scores[0], score: '9007199254740993.125' }] };
    const [webPlay] = await query(auth + `SELECT public.create_web_play_v1(${literal(request(21))},${json(exactPayload)});`);
    const concurrent = [
      `SELECT public.update_web_play_v1(${literal(request(22))},${literal(webPlay.play_id)},${literal(webPlay.revision)},${json({ ...exactPayload,notes:'web writer' })});`,
      `SELECT public.update_play_v1(${literal(request(23))},${literal(webPlay.play_id)},${literal(webPlay.revision)},${json({ ...payload,notes:'Android writer' })});`,
    ];
    const results = await gatedRace(`SELECT id FROM public.plays WHERE id=${literal(webPlay.play_id)} FOR UPDATE`,concurrent);
    assert.equal(results.filter(result => result.code === 0).length,1);
    assert.match(results.find(result => result.code !== 0).stderr,/PT409/);
    report.concurrencyChecks.push('web and Android updates share the same revision and parent lock: one commit and one conflict');
  }

  // Compare the actual unmodified web function, not a duplicate reference implementation.
  const cases = [];
  const states = [
    { score: null, winner: false }, { score: 0, winner: false },
    { score: 5, winner: false }, { score: null, winner: true },
  ];
  for (let length = 1; length <= 5; length++) {
    for (let pattern = 0; pattern < 4 ** length; pattern++) {
      let remaining = pattern;
      const scores = Array.from({ length }, (_, index) => {
        const state = states[remaining % 4]; remaining = Math.floor(remaining / 4);
        return { ...state, index };
      });
      cases.push({ scores, is_cooperative: false, team_won: null });
    }
  }
  let seed = 0x4b53434f;
  function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; }
  for (let iteration = 0; iteration < 252; iteration++) {
    const scores = Array.from({ length: 1 + iteration % 63 }, (_, index) => ({
      index, score: random() % 3 === 0 ? null : (random() % 101 - 50) / 4, winner: random() % 5 === 0,
    }));
    cases.push({ scores, is_cooperative: iteration % 4 === 0, team_won: iteration % 4 === 0 ? iteration % 8 === 0 : null });
  }
  for (let start = 0; start < cases.length; start += 100) {
    const batch = cases.slice(start, start + 100);
    const values = batch.map((value, index) => `(${start + index},${json(value)})`).join(',');
    const results = await query(`SELECT json_build_object('index',c.index,'ranking',r.ranking)
      FROM (VALUES ${values}) AS c(index,payload) CROSS JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('index',(item->>'index')::integer,'position',"position") ORDER BY ordinality) AS ranking
        FROM kingscore_private.ranked_play_scores(c.payload) WITH ORDINALITY AS ranked(item,"position",ordinality)
      ) r ORDER BY c.index;`);
    for (const result of results) {
      const value = cases[result.index];
      const expected = assignPositions(value.scores, { cooperative: value.is_cooperative, teamWon: value.team_won })
        .map(({ index, position }) => ({ index, position }));
      assert.deepEqual(result.ranking, expected, `Web ranking differs for case ${result.index}: ${JSON.stringify(value)}`);
      report.rankingCases++;
    }
  }
  report.status = 'PASS';
  console.log(`PASS: ${report.concurrencyChecks.length} concurrency checks; ${report.rankingCases} web ranking cases`);
} finally {
  await writeFile(join(resolve(reportDirectory), 'concurrency-report.json'), JSON.stringify(report, null, 2) + '\n');
}
}

main().catch(error => { console.error(error); process.exitCode = 1; });
