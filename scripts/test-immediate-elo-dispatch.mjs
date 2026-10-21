// Real PostgreSQL on loopback; the dispatcher is a transactional queue-table mock.
// Never reads credentials, connects to Supabase or sends HTTP requests.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'

const bin = 'C:/Program Files/PostgreSQL/17/bin'
const run = resolve('.work/immediate-elo-dispatch', randomUUID())
const cluster = join(run, 'cluster')
mkdirSync(run, { recursive: true })
const environment = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(PG|POSTGRES|PGRST|NODE_OPTIONS)/i.test(k)))
environment.PGPASSFILE = join(run, 'empty.pgpass')
writeFileSync(environment.PGPASSFILE, '')
const listener = createServer()
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
const port = listener.address().port
await new Promise(resolve => listener.close(resolve))
function command(executable, args, options = {}) {
  const result = spawnSync(join(bin, executable + '.exe'), args, {
    env: environment, encoding: 'utf8', windowsHide: true, timeout: 60_000, ...options,
  })
  if (result.error || result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Local process failed')
  return result.stdout?.trim() ?? ''
}
const args = ['-X', '-w', '-qAt', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
const sql = query => command('psql', args, { input: query })
const report = { status: 'FAIL', remoteContacted: false, postgres: '17', cases: [], serverStopped: false }
const state = () => JSON.parse(sql(`SELECT json_build_object('revision',revision,'requests',(SELECT count(*) FROM kingscore_elo.dispatch_log)) FROM kingscore_elo.source_clock;`))
function test(name, operation) { operation(); report.cases.push(name); console.log('PASS ' + name) }
let started = false
try {
  command('initdb', ['-D', cluster, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--locale=C'])
  command('pg_ctl', ['-D', cluster, '-l', join(run, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'], { stdio: 'ignore' })
  started = true
  sql(`
    CREATE SCHEMA kingscore_elo;
    CREATE TABLE kingscore_elo.source_clock(singleton boolean PRIMARY KEY,revision bigint NOT NULL);
    INSERT INTO kingscore_elo.source_clock VALUES(true,0);
    CREATE TABLE kingscore_elo.dispatch_log(id bigserial PRIMARY KEY);
    CREATE FUNCTION kingscore_elo.request_refresh() RETURNS bigint LANGUAGE plpgsql AS $$
    DECLARE request_id bigint;
    BEGIN
      IF current_setting('kingscore_test.fail_dispatch',true)='true' THEN RAISE EXCEPTION 'synthetic network queue failure'; END IF;
      INSERT INTO kingscore_elo.dispatch_log DEFAULT VALUES RETURNING id INTO request_id;
      RETURN request_id;
    END $$;
    CREATE FUNCTION kingscore_elo.mark_dirty() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
    CREATE TABLE plays(id int PRIMARY KEY,value int DEFAULT 0);
    CREATE TABLE play_scores(id int PRIMARY KEY,value int DEFAULT 0);
    CREATE TABLE games(id int PRIMARY KEY,value int DEFAULT 0);
    CREATE TABLE player_ratings(id int PRIMARY KEY,value int DEFAULT 0);
    INSERT INTO plays VALUES(1,0); INSERT INTO play_scores VALUES(1,0); INSERT INTO games VALUES(1,0); INSERT INTO player_ratings VALUES(1,0);
    CREATE TRIGGER dirty BEFORE INSERT OR UPDATE OR DELETE ON plays FOR EACH STATEMENT EXECUTE FUNCTION kingscore_elo.mark_dirty();
    CREATE TRIGGER dirty BEFORE INSERT OR UPDATE OR DELETE ON play_scores FOR EACH STATEMENT EXECUTE FUNCTION kingscore_elo.mark_dirty();
    CREATE TRIGGER dirty BEFORE INSERT OR UPDATE OR DELETE ON games FOR EACH STATEMENT EXECUTE FUNCTION kingscore_elo.mark_dirty();
  `)
  sql(readFileSync('supabase/migrations/20261022010000_dispatch_elo_after_source_commit.sql', 'utf8'))
  test('one dispatch for multiple source statements in a committed transaction', () => {
    sql('BEGIN; UPDATE plays SET value=value+1; UPDATE play_scores SET value=value+1; UPDATE games SET value=value+1; COMMIT;')
    assert.deepEqual(state(), { revision: 3, requests: 1 })
  })
  test('a subsequent transaction queues its own refresh', () => {
    sql('UPDATE plays SET value=value+1;')
    assert.deepEqual(state(), { revision: 4, requests: 2 })
  })
  test('rollback discards both revision and queued dispatch', () => {
    sql('BEGIN; UPDATE plays SET value=value+1; UPDATE play_scores SET value=value+1; ROLLBACK;')
    assert.deepEqual(state(), { revision: 4, requests: 2 })
  })
  test('savepoint rollback does not suppress the next valid dispatch', () => {
    sql('BEGIN; SAVEPOINT attempt; UPDATE plays SET value=value+1; ROLLBACK TO SAVEPOINT attempt; UPDATE play_scores SET value=value+1; COMMIT;')
    assert.deepEqual(state(), { revision: 5, requests: 3 })
  })
  test('queue failure preserves saved data and dirty revision for cron recovery', () => {
    sql("BEGIN; SET LOCAL kingscore_test.fail_dispatch='true'; UPDATE plays SET value=value+1; COMMIT;")
    assert.deepEqual(state(), { revision: 6, requests: 3 })
    assert.equal(sql('SELECT value FROM plays WHERE id=1;'), '3')
  })
  test('publication writes do not recursively dispatch', () => {
    sql('UPDATE player_ratings SET value=value+1;')
    assert.deepEqual(state(), { revision: 6, requests: 3 })
  })
  test('trigger remains SECURITY DEFINER with an empty search_path', () => {
    assert.equal(sql("SELECT prosecdef AND proconfig=ARRAY['search_path=\"\"'] FROM pg_proc WHERE oid='kingscore_elo.mark_dirty()'::regprocedure;"), 't')
  })
  report.status = 'PASS'
} finally {
  if (started) { command('pg_ctl', ['-D', cluster, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' }); report.serverStopped = true }
  writeFileSync(join(run, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  writeFileSync('.work/immediate-elo-dispatch-validation.json', JSON.stringify(report, null, 2) + '\n')
}
