/** One global generation; the platform MUST keep verify_jwt enabled. */
import { createClient } from 'npm:@supabase/supabase-js@2'
import { runEloWorker } from '../../../src/utils/elo/worker.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } }
)

function isServiceRoleRequest(req: Request): boolean {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return false
  try {
    // This role restriction supplements gateway signature verification.
    const base64 = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/')
    if (!base64) return false
    return JSON.parse(atob(base64))?.role === 'service_role'
  } catch { return false }
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)
  if (!isServiceRoleRequest(req)) return json({ ok: false, error: 'Service role required' }, 403)
  try {
    // CAS and immutable receipts protect concurrent workers; no SELECT/INSERT lease race.
    const summary = await runEloWorker(async (name, args) => {
      const { data, error, status } = await supabase.rpc(name, args)
      return { data, error, status }
    })
    console.log(`[nightly-elo-recalc] ${summary.status}; snapshots=${summary.attempts}`)
    return json({ ok: true, ...summary }, summary.status === 'pending' ? 202 : 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ELO worker failed'
    console.error(`[nightly-elo-recalc] ${message}`)
    return json({ ok: false, error: message }, 500)
  }
})
