/**
 * Job notturno di ricalcolo ELO — vedi docs/automazione-aggiornamento-elo-notturno.md
 *
 * Ricalcola per ogni utente con almeno una partita: player_ratings,
 * player_general_ratings e l'intera cache elo_history, riusando la stessa
 * pipeline bulk del frontend (src/utils/elo/recalc.ts → core puro in
 * src/utils/elo/simulation.ts): fonte unica di verità dell'algoritmo.
 *
 * Pianificazione consigliata (dashboard Supabase → Edge Functions →
 * Schedules): tutti i giorni alle 00:00, timezone Europe/Rome.
 *
 * Sicurezza: la piattaforma applica verify_jwt; in più questa funzione
 * accetta solo JWT con role "service_role" (le invocazioni pianificate
 * usano proprio quel token), così nemmeno l'anon key può lanciarla.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import { performFullRecalc } from '../../../src/utils/elo/recalc.ts'

const STALE_RUN_MINUTES = 10
const MAX_PLAYS = 10000

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
)

function isServiceRoleRequest(req: Request): boolean {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return false
  try {
    // Decodifica il payload del JWT (la firma è già stata verificata dalla piattaforma)
    const base64 = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/')
    if (!base64) return false
    const payload = JSON.parse(atob(base64))
    return payload?.role === 'service_role'
  } catch {
    return false
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

Deno.serve(async (req) => {
  if (!isServiceRoleRequest(req)) {
    return json({ ok: false, error: 'Forbidden: richiesto JWT service_role' }, 403)
  }

  // ── Guardia anti-sovrapposizione ────────────────────────────────────────────
  // Un'esecuzione "running" più recente di STALE_RUN_MINUTES blocca rilanci
  // concorrenti; quelle più vecchie sono considerate stale e ignorate.
  const staleCutoff = new Date(Date.now() - STALE_RUN_MINUTES * 60_000).toISOString()
  const { data: activeRun } = await supabase
    .from('elo_recalc_runs')
    .select('id, started_at')
    .eq('status', 'running')
    .gte('started_at', staleCutoff)
    .limit(1)
    .maybeSingle()

  if (activeRun) {
    return json({ ok: true, skipped: true, reason: `esecuzione già attiva dalle ${activeRun.started_at}` })
  }

  const { data: run } = await supabase
    .from('elo_recalc_runs')
    .insert({ status: 'running' })
    .select('id')
    .single()

  if (!run) {
    return json({ ok: false, error: 'Impossibile registrare l\'esecuzione in elo_recalc_runs' }, 500)
  }

  try {
    // Tutti gli utenti con almeno una partita
    const { data: playUsers, error: usersError } = await supabase
      .from('plays')
      .select('user_id')
      .not('user_id', 'is', null)
      .limit(MAX_PLAYS)
    if (usersError) throw new Error(usersError.message)

    const userIds = [...new Set((playUsers ?? []).map((row: { user_id: string }) => row.user_id))]

    const results: Array<Record<string, unknown>> = []
    for (const userId of userIds) {
      const summary = await performFullRecalc(supabase, userId)
      results.push({ userId, ...summary })
      console.log(
        `[nightly-elo-recalc] utente ${userId}: ${summary.playsProcessed} partite processate, ` +
        `${summary.games} giochi, ${summary.historyEntries} righe storico, ${summary.durationMs} ms`
      )
    }

    await supabase
      .from('elo_recalc_runs')
      .update({
        status: 'succeeded',
        finished_at: new Date().toISOString(),
        summary: { users: userIds.length, results }
      })
      .eq('id', run.id)

    return json({ ok: true, users: userIds.length, results })
  } catch (error) {
    await supabase
      .from('elo_recalc_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        summary: { error: String(error) }
      })
      .eq('id', run.id)
    console.error('[nightly-elo-recalc] ESECUZIONE FALLITA:', error)
    return json({ ok: false, error: String(error) }, 500)
  }
})
