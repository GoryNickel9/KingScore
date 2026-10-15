import assert from 'node:assert/strict'
import { randomUUID,randomBytes } from 'node:crypto'
import { readFileSync,writeFileSync,existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

// Explicitly authorized, limited live smoke test. All mutations target tagged temporary assets.
const [operation,privateDirectory]=process.argv.slice(2)
assert(['prepare','cleanup'].includes(operation),'Choose prepare or cleanup explicitly')
const directory=resolve(privateDirectory)
assert(directory.endsWith('production-deploy'))
const load=name=>JSON.parse(readFileSync(resolve(directory,name),'utf8').replace(/^\uFEFF/,''))
const keys=load('api-keys.json')
const key=name=>{const value=keys.find(item=>item.name===name)?.api_key;assert(value);return value}
const url='https://rixivmeipbizoxyvrvaf.supabase.co'
const options={auth:{persistSession:false,autoRefreshToken:false}}
const service=createClient(url,key('service_role'),options)
const statePath=resolve(directory,'live-qa-state.json')
const state=existsSync(statePath)?load('live-qa-state.json'):{marker:`ksqa-${Date.now()}`,accounts:[],players:[],plays:[],comments:[],game:null,cleaned:false}
assert.match(state.marker,/^ksqa-[0-9]+$/)
const save=()=>writeFileSync(statePath,JSON.stringify(state,null,2)+'\n')
const cases=[]
async function success(result,label){const value=await result;assert(!value.error,`${label} failed (${value.error?.code??value.status??'unknown'})`);return value.data}
async function signIn(account){const client=createClient(url,key('anon'),options);await success(client.auth.signInWithPassword({email:account.email,password:account.password}),'Temporary sign-in');return client}
async function worker(){const response=await fetch(`${url}/functions/v1/nightly-elo-recalc`,{method:'POST',headers:{Authorization:`Bearer ${key('service_role')}`,apikey:key('service_role'),'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(60000)});assert.equal(response.status,200,'Worker HTTPS invocation failed');const body=await response.json();assert.equal(body.ok,true);return body}
async function test(name,action){await action();cases.push({name,status:'PASS'})}
try {
  if(operation==='prepare') {
    assert.equal(state.accounts.length,0,'Existing temporary test state must be inspected or cleaned before preparing again')
    save()
    assert.equal(state.allowedAccounts?.length,3,'Prepare the explicit temporary registration allowlist first')
    for(const {tag,role,id,email}of state.allowedAccounts){
      const password=randomBytes(24).toString('base64url')+'aA1!'
      const {user}=await success(service.auth.admin.createUser({id,email,password,email_confirm:true,app_metadata:{role},user_metadata:{name:`${state.marker} ${tag}`}}),'Temporary account creation')
      assert.equal(user.id,id,'Auth did not preserve the explicitly allowed temporary ID')
      state.accounts.push({id:user.id,email,password,tag});save()
    }
    const [adminAccount,ownerAccount,readerAccount]=state.accounts
    const admin=await signIn(adminAccount),owner=await signIn(ownerAccount),reader=await signIn(readerAccount)
    state.game=await success(service.from('games').insert({name:state.marker,min_players:2,max_players:4}).select('id,name').single(),'Temporary game creation');save()
    for(const [index,account]of [adminAccount,ownerAccount].entries()){
      const player=await success(service.from('players').insert({name:`${state.marker}-${index}`,user_id:ownerAccount.id,account_user_id:account.id,is_me:false}).select('id,name').single(),'Temporary player creation')
      state.players.push(player);save()
    }
    const payload={game_id:state.game.id,played_at:'2026-10-15',duration_minutes:5,source:'offline',notes:state.marker,is_cooperative:false,team_won:null,
      scores:state.players.map((player,index)=>({id:null,player_id:player.id,score:index===0?'12.5':'2',winner:index===0,color:null,role:null}))}
    const requestId=randomUUID()
    const created=await success(owner.rpc('create_play_v1',{p_request_id:requestId,p_payload:payload}),'Atomic play creation')
    state.plays.push(created.play_id);save()
    await test('authenticated-create-and-exact-request-replay',async()=>{const replay=await success(owner.rpc('create_play_v1',{p_request_id:requestId,p_payload:payload}),'Create replay');assert.equal(replay.play_id,created.play_id);assert.equal(replay.replayed,true)})
    await test('administrator-updates-another-owner-play-and-conflict-is-rejected',async()=>{
      const snapshot=await success(admin.rpc('get_play_editor_v1',{p_play_id:created.play_id}),'Cross-owner editor read')
      assert.equal(snapshot.detail.play.user_id,ownerAccount.id)
      const update={...payload,notes:`${state.marker} updated`,scores:snapshot.detail.scores.map(({score})=>({id:score.id,player_id:score.player_id,score:score.score,winner:score.winner,color:score.color,role:score.role}))}
      await success(admin.rpc('update_play_v1',{p_request_id:randomUUID(),p_play_id:created.play_id,p_expected_revision:snapshot.revision,p_payload:update}),'Cross-owner atomic update')
      const conflict=await admin.rpc('update_play_v1',{p_request_id:randomUUID(),p_play_id:created.play_id,p_expected_revision:snapshot.revision,p_payload:update})
      assert.equal(conflict.error?.code,'PT409')
    })
    await test('ordinary-account-cannot-write-plays-and-legacy-direct-write-is-denied',async()=>{
      const forbidden=await reader.rpc('create_play_v1',{p_request_id:randomUUID(),p_payload:payload});assert.equal(forbidden.error?.code,'42501')
      const direct=await admin.from('plays').update({notes:'Denied QA direct write'}).eq('id',created.play_id);assert.equal(direct.error?.code,'42501')
    })
    await test('ordinary-account-creates-edits-and-deletes-only-own-comment',async()=>{
      const comment=await success(reader.from('play_comments').insert({play_id:created.play_id,user_id:readerAccount.id,author_name:'Must be replaced',content:state.marker}).select().single(),'Own comment creation');state.comments.push(comment.id);save()
      assert.equal(comment.user_id,readerAccount.id)
      assert.notEqual(comment.author_name,'Must be replaced')
      await success(reader.from('play_comments').update({content:`${state.marker} edited`}).eq('id',comment.id).select().single(),'Own comment edit')
      const deleted=await success(admin.from('play_comments').delete().eq('id',comment.id).select('id'),'Foreign comment delete check');assert.equal(deleted.length,0)
      const still=await success(reader.from('play_comments').select('id').eq('id',comment.id).single(),'Own comment retained');assert.equal(still.id,comment.id)
      await success(reader.from('play_comments').delete().eq('id',comment.id),'Own comment delete');state.comments=[];save()
    })
    await test('server-worker-publishes-a-current-global-generation-over-HTTPS',async()=>{
      await worker();const publication=await success(reader.rpc('get_elo_publication_v1'),'Authenticated global read');assert.equal(publication.status,'current');assert.equal(publication.scopeId,'global');assert(publication.result.generalPlayers[state.players[0].id])
    })
    state.prepared=true;save()
  }else{
    assert.equal(state.cleaned,false,'Temporary assets already cleaned')
    const adminAccount=state.accounts.find(account=>account.tag==='admin')
    const admin=adminAccount?await signIn(adminAccount):null
    for(const id of state.plays){
      const snapshot=await success(service.from('plays').select('id,notes').eq('id',id).maybeSingle(),'Cleanup play verification')
      if(!snapshot)continue
      assert(snapshot.notes?.startsWith(state.marker),'Refusing cleanup of an unrelated play')
      const editor=await success(admin.rpc('get_play_editor_v1',{p_play_id:id}),'Cleanup editor read')
      await success(admin.rpc('delete_play_v1',{p_request_id:randomUUID(),p_play_id:id,p_expected_revision:editor.revision}),'Atomic temporary play deletion')
    }
    for(const player of state.players){assert(player.name.startsWith(state.marker));await success(service.from('players').delete().eq('id',player.id).eq('name',player.name),'Temporary player removal')}
    if(state.game){assert.equal(state.game.name,state.marker);await success(service.from('games').delete().eq('id',state.game.id).eq('name',state.marker),'Temporary game removal')}
    for(const account of state.accounts){
      const {user}=await success(service.auth.admin.getUserById(account.id),'Temporary account verification')
      assert.equal(user.email,account.email);assert(user.email.startsWith(state.marker)&&user.email.endsWith('@kingscore-test.invalid'))
      await success(service.auth.admin.deleteUser(account.id),'Temporary account removal')
    }
    await worker()
    const publication=await success(service.rpc('get_elo_publication_v1'),'Final global read')
    assert.equal(publication.status,'current');assert.deepEqual(publication.result,load('elo-before.json'),'Temporary tests changed the original ELO result')
    state.cleaned=true;state.accounts=state.accounts.map(account=>{const cleaned={...account};delete cleaned.password;return cleaned});save()
    cases.push({name:'all-temporary-assets-removed-and-original-ELO-restored',status:'PASS'})
  }
  const report={status:'PASS',operation,remoteContacted:true,limitedTemporaryDataOnly:true,cases,prepared:state.prepared??false,cleaned:state.cleaned,at:new Date().toISOString()}
  writeFileSync(resolve(directory,`live-qa-${operation}-report.json`),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
}catch(error){
  writeFileSync(resolve(directory,`live-qa-${operation}-report.json`),JSON.stringify({status:'FAIL',operation,cases,message:error.message,cleanupRequired:!state.cleaned},null,2)+'\n')
  console.error(`Limited live smoke test failed: ${error.message}. Temporary state retained for explicit cleanup.`);process.exitCode=1
}
