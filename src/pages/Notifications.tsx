import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Bell } from 'lucide-react'
import { useNotifications } from '../hooks/useNotifications'
import { notificationText, type DiscussionNotification } from '../utils/discussion'

export default function Notifications() {
  const model = useNotifications()
  const navigate = useNavigate()
  const open = async (n: DiscussionNotification) => {
    try { await model.markRead(n.id) } catch { toast.error('Non è stato possibile segnare la notifica come letta') }
    void navigate(`/plays/${n.play_id}#comment-${n.comment_id}`)
  }
  return <section className="mx-auto max-w-3xl space-y-5" aria-labelledby="notifications-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 id="notifications-title" className="flex items-center gap-3 text-2xl font-bold text-white"><Bell aria-hidden="true" />Notifiche</h1>
      <button disabled={model.busy || model.unread_count === 0} onClick={() => void model.markRead().catch(() => toast.error('Impossibile aggiornare le notifiche'))}
        className="min-h-11 rounded-lg px-3 text-emerald-300 hover:bg-slate-800 disabled:opacity-50">Segna tutte come lette</button>
    </div>
    <div className="flex items-center justify-between gap-3 text-slate-300">
      <p aria-live="polite">{model.error ? 'Conteggio non aggiornato' : `${model.unread_count} non lette`}</p>
      <button disabled={model.loading} onClick={() => void model.refresh()} className="min-h-11 rounded-lg px-3 text-emerald-300 disabled:opacity-50">Aggiorna</button>
    </div>
    {model.error && <p role="alert" className="rounded-lg bg-red-950/40 p-4 text-red-200">Impossibile aggiornare le notifiche. Premi Aggiorna per riprovare.</p>}
    {model.loading && <p role="status" className="text-slate-400">Caricamento notifiche…</p>}
    {!model.loading && !model.error && model.items.length === 0 && <p className="rounded-xl bg-slate-800 p-6 text-slate-300">Non hai ancora notifiche. Qui troverai risposte, reazioni ai tuoi commenti e menzioni.</p>}
    <ul className="divide-y divide-slate-700 overflow-hidden rounded-xl bg-slate-800">
      {model.items.map(n => <li key={n.id}>
        <button disabled={model.busy} onClick={() => void open(n)} className="w-full p-5 text-left hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400 disabled:opacity-50">
          <span className={`block ${n.read_at ? 'text-slate-300' : 'font-semibold text-white'}`}>{notificationText(n)}</span>
          <span className="mt-2 block text-sm text-slate-400">{!n.read_at && <span className="mr-3 text-emerald-300">Non letta</span>}<time dateTime={n.created_at}>{new Date(n.created_at).toLocaleString('it-IT')}</time></span>
        </button>
      </li>)}
    </ul>
    {model.has_more && <button disabled={model.loading} onClick={() => void model.more()} className="min-h-11 rounded-lg bg-slate-800 px-5 text-emerald-300 disabled:opacity-50">Carica precedenti</button>}
  </section>
}
