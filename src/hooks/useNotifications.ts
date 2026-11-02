import { createContext, useContext } from 'react'
import type { NotificationFeed } from '../utils/discussion'

interface NotificationsModel extends NotificationFeed {
  loading: boolean; error: boolean; busy: boolean
  refresh: () => Promise<void>; more: () => Promise<void>; markRead: (id?: string) => Promise<void>
}
export const NotificationsContext = createContext<NotificationsModel | null>(null)
export function useNotifications() {
  const value = useContext(NotificationsContext)
  if (!value) throw new Error('NotificationsProvider required')
  return value
}
