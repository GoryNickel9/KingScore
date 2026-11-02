import { Bell } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useNotifications } from '../hooks/useNotifications'
export function NotificationBell() {
  const { unread_count: count, error } = useNotifications()
  return <Link to="/notifications" aria-label={error ? 'Notifiche, aggiornamento non riuscito' : `Notifiche, ${count} non lette`}
    className="relative flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-emerald-400">
    <Bell className="h-5 w-5" aria-hidden="true" />
    {(count > 0 || error) && <span aria-hidden="true" className="absolute right-0 top-0 rounded-full bg-emerald-500 px-1.5 text-xs font-semibold text-slate-950">{error ? '!' : count > 99 ? '99+' : count}</span>}
  </Link>
}
