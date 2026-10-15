import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Preparation only: never opens a database connection or executes the generated SQL.
const directory = resolve(process.argv[2] ?? '')
assert(directory.endsWith('production-deploy'), 'Private deployment directory required')
const load = name => JSON.parse(readFileSync(resolve(directory,name),'utf8').replace(/^\uFEFF/,''))
const backup = load('application-baseline.json')
const source = load('source-before.json')
const order = load('participant-order.json')
const result = load('elo-before.json')
const capture = load('capture-report.json')
assert.equal(capture.status,'PASS')
assert.equal(source.scopeId,'global')
assert.equal(source.plays.length,backup.tables.plays.length)
assert.equal(order.length,backup.tables.play_scores.length)
const quote = value => `'${String(value).replaceAll("'","''")}'`
const json = value => `${quote(JSON.stringify(value))}::jsonb`
const sourceTables = ['games','players','plays','play_scores']
const current = name => name === 'play_scores'
  ? `(SELECT COALESCE(jsonb_agg(to_jsonb(s)||jsonb_build_object('score',s.score::text) ORDER BY id),'[]') FROM public.play_scores s)`
  : `(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.${name} r)`
const guard = sourceTables.map(name => `IF ${current(name)} IS DISTINCT FROM ${json(backup.tables[name])} THEN RAISE EXCEPTION 'Source changed since verified capture: ${name}; recapture before installation'; END IF;`).join('\n')
const migration = name => readFileSync(new URL(`./atomic-play-migrations/${name}`,import.meta.url),'utf8')
  .replace(/^BEGIN;\r?$/gm,'').replace(/^COMMIT;\r?$/gm,'')
const publication = {publicationId:randomUUID(),scopeId:'global',sourceRevision:'0',algorithm:capture.algorithm,result}
const sql = `-- Generated from a verified read-only baseline; contains private application data.
BEGIN;
SET LOCAL standard_conforming_strings=on;
SET LOCAL timezone='UTC';
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
LOCK TABLE ONLY public.games,ONLY public.players,ONLY public.plays,ONLY public.play_scores IN ACCESS EXCLUSIVE MODE;
DO $release_guard$ BEGIN
${guard}
IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.plays'::regclass
  AND confrelid='public.games'::regclass AND contype='f' AND confdeltype='c' AND convalidated) THEN
  RAISE EXCEPTION 'Verified game deletion cascade required for web cutover';
END IF;
END $release_guard$;
${migration('01-install-rpcs.sql')}
${migration('02-elo-publication.sql')}
UPDATE public.play_scores s SET elo_ordinal=o.ordinal
FROM jsonb_to_recordset(${json(order)}) AS o(id uuid,play_id uuid,ordinal integer)
WHERE s.id=o.id AND s.play_id=o.play_id;
DO $verify_backfill$ BEGIN
IF EXISTS(SELECT 1 FROM public.play_scores WHERE elo_ordinal IS NULL OR elo_ordinal<0)
 OR EXISTS(SELECT 1 FROM public.play_scores GROUP BY play_id,elo_ordinal HAVING count(*)>1) THEN
 RAISE EXCEPTION 'Incomplete or ambiguous participant order backfill'; END IF;
IF (SELECT COALESCE(jsonb_agg((to_jsonb(s)-'elo_ordinal')||jsonb_build_object('score',s.score::text) ORDER BY id),'[]')
 FROM public.play_scores s) IS DISTINCT FROM ${json(backup.tables.play_scores)} THEN
 RAISE EXCEPTION 'Backfill changed historical score data'; END IF;
END $verify_backfill$;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
DO $publish_initial$ BEGIN
PERFORM public.publish_elo_v1(${json(publication)} || jsonb_build_object('sourceRevision',
 (SELECT revision::text FROM kingscore_elo.source_clock WHERE singleton)));
END $publish_initial$;
${migration('03-cutover-writers.sql')}
NOTIFY pgrst,'reload schema';
SELECT jsonb_build_object('status','PASS','sourceRevision',(SELECT revision::text FROM kingscore_elo.source_clock),
 'publicationId',${quote(publication.publicationId)},'plays',(SELECT count(*) FROM public.plays),
 'scores',(SELECT count(*) FROM public.play_scores)) AS installation;
COMMIT;
`
writeFileSync(resolve(directory,'install-guarded.sql'),sql)
writeFileSync(resolve(directory,'install-manifest.json'),JSON.stringify({prepared:true,executed:false,
  projectRef:'rixivmeipbizoxyvrvaf',publicationId:publication.publicationId,
  sqlSha256:createHash('sha256').update(sql).digest('hex'),baselineResultSha256:capture.resultSha256},null,2)+'\n')
console.log('Guarded SQL prepared privately; no database changes executed.')
