import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'

// Read-only release operation. Outputs contain application data and must remain private.
const [privateDirectory, publicationModule] = process.argv.slice(2)
assert(privateDirectory && publicationModule, 'Private output directory and bundled publication module required')
const directory = resolve(privateDirectory)
assert(directory.endsWith('production-deploy'), 'Dedicated private deployment directory required')
const keys = JSON.parse(readFileSync(resolve(directory, 'api-keys.json'), 'utf8').replace(/^\uFEFF/, ''))
const anon = keys.find(key => key.name === 'anon')?.api_key
assert(anon, 'Project public key unavailable')
const client = createClient('https://rixivmeipbizoxyvrvaf.supabase.co', anon, { auth: { persistSession:false, autoRefreshToken:false } })
const { buildEloPublication } = await import(pathToFileURL(resolve(publicationModule)).href)
async function capture() {
  const rows = []
  let count
  for (let from = 0; ; from += 250) {
    const page = await client.from('plays').select('*, play_scores(*, players(*))', {count:'exact'})
      .order('played_at').order('id').range(from, from+249)
    assert(!page.error && page.data && Number.isSafeInteger(page.count), 'Source read failed')
    count ??= page.count
    assert.equal(page.count,count,'Source changed during paginated capture')
    rows.push(...page.data)
    if (rows.length >= count) break
    assert(page.data.length,'Incomplete source read')
  }
  assert.equal(rows.length,count)
  return rows
}
const plays = await capture()
assert.deepEqual(await capture(),plays,'Source or returned participant order changed during capture; recapture explicitly')
const backup = JSON.parse(readFileSync(resolve(directory,'management-baseline-response.json'),'utf8').replace(/^\uFEFF/,'')).rows[0].baseline
assert.equal(backup.transactionReadOnly,'on')
writeFileSync(resolve(directory,'application-baseline.json'),JSON.stringify(backup))
assert.equal(plays.length,backup.tables.plays.length,'Public source does not match complete database baseline')
const expectedScores = new Map(backup.tables.play_scores.map(score => [score.id,score]))
const order = []
for (const play of plays) {
  for (const [ordinal,score] of play.play_scores.entries()) {
    const expected = expectedScores.get(score.id)
    assert(expected && expected.play_id === play.id && expected.player_id === score.player_id,'Source membership mismatch')
    assert.equal(expected.score === null ? null : Number(expected.score),score.score,'Source numeric value changed')
    assert.equal(expected.winner,score.winner,'Source outcome changed')
    assert.equal(expected.position,score.position,'Source position changed')
    order.push({id:score.id,play_id:play.id,ordinal})
    expectedScores.delete(score.id)
  }
}
assert.equal(expectedScores.size,0,'Orphan, hidden or truncated participant rows require an explicit decision')
const source = {scopeId:'global',sourceRevision:'0',plays}
const publication = buildEloPublication(source,randomUUID())
writeFileSync(resolve(directory,'source-before.json'),JSON.stringify(source))
writeFileSync(resolve(directory,'participant-order.json'),JSON.stringify(order))
writeFileSync(resolve(directory,'elo-before.json'),JSON.stringify(publication.result))
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const report = {status:'PASS',readOnly:true,projectRef:'rixivmeipbizoxyvrvaf',plays:plays.length,scores:order.length,
  processedPlays:publication.result.processedPlays,skippedPlays:publication.result.skippedPlays,
  participantOrderSha256:digest(order),resultSha256:digest(publication.result),algorithm:publication.algorithm}
writeFileSync(resolve(directory,'capture-report.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report))
