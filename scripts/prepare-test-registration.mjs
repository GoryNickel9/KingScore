import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync,writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Generate a narrow, expiring exception only after the owner approved the three test accounts.
const directory=resolve(process.argv[2]??'')
assert(directory.endsWith('production-deploy'))
const load=name=>JSON.parse(readFileSync(resolve(directory,name),'utf8').replace(/^\uFEFF/,''))
const state=load('live-qa-state.json')
assert.equal(state.accounts.length,0)
assert.match(state.marker,/^ksqa-[0-9]+$/)
state.allowedAccounts??=[['admin','admin'],['owner','admin'],['reader','user']].map(([tag,role])=>({id:randomUUID(),email:`${state.marker}-${tag}@kingscore-test.invalid`,tag,role}))
assert.equal(state.allowedAccounts.length,3)
const expiresAt=state.registrationExceptionExpiresAt??new Date(Date.now()+2*60*60*1000).toISOString()
const hooks=load('auth-hook-readonly.json').rows
assert.equal(hooks.length,1)
assert.equal(hooks[0].proname,'enforce_registration_window')
const original=hooks[0].definition
assert(original.includes("RAISE EXCEPTION 'Registrations are closed'"))
const quoted=value=>`'${String(value).replaceAll("'","''")}'`
// GoTrue applies custom app_metadata only AFTER inserting auth.users.
const conditions=state.allowedAccounts.map(account=>`(NEW.id=${quoted(account.id)}::uuid AND NEW.email=${quoted(account.email)})`).join(' OR ')
const modified=original.replace(/BEGIN\r?\n/,`BEGIN\n  IF statement_timestamp()<${quoted(expiresAt)}::timestamptz AND (${conditions}) THEN RETURN NEW; END IF;\n`)
assert.notEqual(modified,original)
const guard=definition=>`DO $guard$ BEGIN IF pg_get_functiondef('public.enforce_registration_window()'::regprocedure) IS DISTINCT FROM ${quoted(definition)} THEN RAISE EXCEPTION 'Registration hook changed; inspect before replacement'; END IF; END $guard$;`
writeFileSync(resolve(directory,'registration-exception.sql'),`BEGIN;\n${guard(original)}\n${modified};\nCOMMIT;\n`)
writeFileSync(resolve(directory,'restore-registration.sql'),`BEGIN;\n${guard(modified)}\n${original};\nCOMMIT;\n`)
writeFileSync(resolve(directory,'registration-hook-original.sql'),original+';\n')
writeFileSync(resolve(directory,'registration-hook-modified.sql'),modified+';\n')
state.registrationExceptionExpiresAt=expiresAt
writeFileSync(resolve(directory,'live-qa-state.json'),JSON.stringify(state,null,2)+'\n')
console.log('Prepared three exact-ID/email exceptions with a two-hour expiry; public registration setting remains unchanged.')
