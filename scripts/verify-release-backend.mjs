import assert from 'node:assert/strict'
import { readFileSync,writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const [privateDirectory,modulePath] = process.argv.slice(2)
const directory=resolve(privateDirectory)
assert(directory.endsWith('production-deploy'))
const load=name=>JSON.parse(readFileSync(resolve(directory,name),'utf8').replace(/^\uFEFF/,''))
const keys=load('api-keys.json')
const key=name=>{const value=keys.find(item=>item.name===name)?.api_key;assert(value,`Missing ${name} key`);return value}
const url='https://rixivmeipbizoxyvrvaf.supabase.co'
const options={auth:{persistSession:false,autoRefreshToken:false}}
const service=createClient(url,key('service_role'),options)
const publicClient=createClient(url,key('anon'),options)
const {buildEloPublication}=await import(pathToFileURL(resolve(modulePath)).href)
const source=await service.rpc('get_elo_source_v1')
assert(!source.error,'Installed source RPC failed')
const recomputed=buildEloPublication(source.data,randomUUID())
assert.deepEqual(recomputed.result,load('elo-before.json'),'Installed ordered source differs from pre-install formula result')
const published=await publicClient.rpc('get_elo_publication_v1')
assert(!published.error,'Public publication read failed')
assert.equal(published.data.scopeId,'global')
assert.equal(published.data.status,'current')
assert.equal(published.data.sourceRevision,published.data.publishedRevision)
assert.deepEqual(published.data.result,recomputed.result,'Published generation differs from the unchanged calculator')
const denied=await publicClient.rpc('get_elo_source_v1')
assert(denied.error,'Public client unexpectedly acquired worker source capability')
const report={status:'PASS',projectRef:'rixivmeipbizoxyvrvaf',sourceRevision:published.data.sourceRevision,
  publicationId:published.data.publicationId,plays:source.data.plays.length,processedPlays:recomputed.result.processedPlays,
  skippedPlays:recomputed.result.skippedPlays,globalResultMatchesPreInstall:true,publicWorkerDenied:true,
  formulaChanged:false,verifiedAt:new Date().toISOString()}
writeFileSync(resolve(directory,'backend-read-verification.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report))
