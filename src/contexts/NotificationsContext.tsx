import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import { mergeNotificationRefresh, parseNotificationFeed, type NotificationFeed } from '../utils/discussion'
import { NotificationsContext } from '../hooks/useNotifications'

const empty: NotificationFeed = { items: [], unread_count: 0, has_more: false }
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const accountId = user?.id
  const [state, setState] = useState({ accountId, feed: empty, loading: true, error: false, busy: false })
  const generation = useRef(0)
  const inFlight = useRef(false)
  const mutating = useRef(false)
  const invalidate = useCallback(() => { generation.current++; inFlight.current = false; mutating.current = false }, [])
  const load = useCallback(async (after?: { created_at: string; id: string }, preservePages = false) => {
    if (!accountId || inFlight.current || mutating.current) return
    const stamp = generation.current
    inFlight.current = true
    setState(s => ({ ...s, loading: true }))
    try {
      const { data, error } = await supabase.rpc('notification_feed', after ? { p_before_time: after.created_at, p_before_id: after.id } : {})
      if (error) throw error
      const feed = parseNotificationFeed(data, accountId)
      if (stamp !== generation.current) return
      setState(s => ({ accountId, loading: false, error: false, busy: s.busy,
        feed: after ? { ...feed, items: [...s.feed.items, ...feed.items].filter((n, i, all) => all.findIndex(x => x.id === n.id) === i) }
          : preservePages ? mergeNotificationRefresh(s.feed, feed) : feed }))
    } catch {
      if (stamp === generation.current) setState(s => ({ ...s, loading: false, error: true }))
    } finally { if (stamp === generation.current) inFlight.current = false }
  }, [accountId])
  useEffect(() => {
    invalidate()
    setState({ accountId, feed: empty, loading: !!accountId, error: false, busy: false })
    void load()
    const refreshVisible = () => { if (document.visibilityState === 'visible') void load(undefined, true) }
    const timer = window.setInterval(refreshVisible, 30_000)
    window.addEventListener('focus', refreshVisible)
    document.addEventListener('visibilitychange', refreshVisible)
    window.addEventListener('kingscore:notifications-read', refreshVisible)
    return () => {
      invalidate()
      window.clearInterval(timer); window.removeEventListener('focus', refreshVisible)
      document.removeEventListener('visibilitychange', refreshVisible)
      window.removeEventListener('kingscore:notifications-read', refreshVisible)
    }
  }, [accountId, load, invalidate])
  const markRead = async (id?: string) => {
    if (!accountId || mutating.current) return
    const stamp = ++generation.current
    inFlight.current = false
    mutating.current = true
    setState(s => ({ ...s, busy: true, loading: false }))
    try {
      const { error } = await supabase.rpc('mark_notifications_read', id ? { p_id: id } : {})
      if (error) throw error
      if (stamp === generation.current) {
        setState(s => ({ ...s, feed: { ...s.feed,
          unread_count: id ? Math.max(0, s.feed.unread_count - (s.feed.items.some(n => n.id === id && !n.read_at) ? 1 : 0)) : 0,
          items: s.feed.items.map(n => (!id || n.id === id) ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n) } }))
        // Other tabs refresh immediately; other devices refresh at their next poll.
        try { localStorage.setItem('kingscore:notifications-read', String(Date.now())) } catch { /* Storage may be disabled. Polling still synchronizes reads. */ }
      }
    } finally { if (stamp === generation.current) { mutating.current = false; setState(s => ({ ...s, busy: false })) } }
  }
  useEffect(() => {
    const handler = (e: StorageEvent) => { if (e.key === 'kingscore:notifications-read') void load(undefined, true) }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [load])
  const current = state.accountId === accountId ? state : { accountId, feed: empty, loading: !!accountId, error: false, busy: false }
  return <NotificationsContext.Provider value={{ ...current.feed, loading: current.loading, error: current.error, busy: current.busy,
    refresh: () => load(), more: () => current.feed.has_more ? load(current.feed.items[current.feed.items.length - 1]) : Promise.resolve(), markRead }}>{children}</NotificationsContext.Provider>
}
