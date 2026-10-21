import type { usePlayWrites } from '../hooks/usePlayWrites'

export function PlayWriteStatus({ writes }: { writes: ReturnType<typeof usePlayWrites> }) {
  const { state, coordinator } = writes
  if (state.phase === 'ready' && !state.message) return null
  return <div role={state.phase === 'pending' || state.message ? 'alert' : 'status'} className="rounded-lg border border-slate-600 bg-slate-800 p-4 text-slate-200 space-y-3">
    {state.phase === 'checking' && <p>Verifica account e salvataggi…</p>}
    {state.phase === 'busy' && <p>Operazione in corso. Attendi la conferma prima di chiudere la pagina.</p>}
    {state.message && <p>{state.message}</p>}
    {state.phase === 'pending' && <>
      <p>Un salvataggio precedente non ha ancora una conferma. Verificane l’esito prima di inviarne un altro.</p>
      <button type="button" className="px-4 py-3 rounded-lg bg-emerald-600 text-white" onClick={() => { void coordinator.recover() }}>Verifica salvataggio precedente</button>
    </>}
    {state.phase === 'unavailable' && <button type="button" className="px-4 py-3 rounded-lg bg-slate-700" onClick={() => { void coordinator.initialize() }}>Verifica disponibilità</button>}
  </div>
}
