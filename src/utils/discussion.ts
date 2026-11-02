export interface Mention { user_id: string; label: string }
export interface DiscussionNotification {
  id: string; recipient_id: string; actor_name: string; play_id: string; comment_id: string
  kind: 'reply' | 'mention' | 'reaction'; emoji: string | null; created_at: string; read_at: string | null
}
export interface NotificationFeed { items: DiscussionNotification[]; unread_count: number; has_more: boolean }
function comparePosition(a: DiscussionNotification, b: DiscussionNotification): number {
  const milliseconds = Date.parse(a.created_at) - Date.parse(b.created_at)
  if (milliseconds !== 0) return milliseconds
  // PostgreSQL retains microseconds; Date.parse alone truncates the cursor precision.
  const fraction = (time: string) => (time.match(/\.(\d+)/)?.[1] ?? '').padEnd(9, '0')
  const left = fraction(a.created_at), right = fraction(b.created_at)
  if (left !== right) return left < right ? -1 : 1
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1
}
export function mergeNotificationRefresh(previous: NotificationFeed, page: NotificationFeed): NotificationFeed {
  if (previous.items.length <= 40 || !page.has_more) return page
  const boundary = page.items[page.items.length - 1]
  const older = previous.items.filter(n => comparePosition(n, boundary) < 0)
  return { ...page, has_more: previous.has_more, items: [...page.items, ...older].map(n =>
    page.unread_count === 0 && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n) }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function parseMentions(value: unknown): Mention[] {
  if (!Array.isArray(value) || value.length > 10) throw new Error('Invalid mentions')
  const result = value.map((m: unknown) => {
    if (!m || typeof m !== 'object' || !('user_id' in m) || !('label' in m) ||
      typeof m.user_id !== 'string' || !uuid.test(m.user_id) || typeof m.label !== 'string' ||
      !m.label.trim() || [...m.label].length > 80 || /[\p{Cc}]/u.test(m.label)) throw new Error('Invalid mention')
    return { user_id: m.user_id, label: m.label }
  })
  if (new Set(result.map(m => m.user_id)).size !== result.length) throw new Error('Duplicate mention')
  return result
}
export function retainedMentions(content: string, mentions: Mention[]): Mention[] {
  return mentions.filter(m => content.includes(`@${m.label}`))
}
export function mentionQuery(content: string, caret: number, mentions: Mention[]) {
  const match = /(?:^|\s)@([^@\n]{0,80})$/u.exec(content.slice(0, caret))
  if (!match || mentions.some(m => match[1] === m.label || match[1].startsWith(`${m.label} `))) return null
  return { start: caret - match[1].length - 1, end: caret, query: match[1] }
}
export function insertMention(content: string, caret: number, mentions: Mention[], target: Mention) {
  const query = mentionQuery(content, caret, mentions)
  if (!query || mentions.length >= 10) return null
  const prefix = content.slice(0, query.start) + `@${target.label} `
  const text = prefix + content.slice(query.end)
  if ([...text].length > 1000) return null
  return { content: text, caret: prefix.length, mentions: [...mentions.filter(m => m.user_id !== target.user_id), target] }
}
export function notificationText(n: DiscussionNotification): string {
  return n.kind === 'reply' ? `${n.actor_name} ha risposto al tuo commento`
    : n.kind === 'mention' ? `${n.actor_name} ti ha menzionato in un commento`
      : `${n.actor_name} ha reagito ${n.emoji ?? ''} al tuo commento`
}
export function parseNotificationFeed(value: unknown, accountId: string): NotificationFeed {
  if (!value || typeof value !== 'object' || !('items' in value) || !('unread_count' in value) || !('has_more' in value) ||
    !Array.isArray(value.items) || value.items.length > 40 || !Number.isSafeInteger(value.unread_count) ||
    (value.unread_count as number) < 0 || typeof value.has_more !== 'boolean') throw new Error('Invalid notification feed')
  const items = value.items.map((row: unknown) => {
    if (!row || typeof row !== 'object') throw new Error('Invalid notification')
    const n = row as Record<string, unknown>
    if (!['id', 'play_id', 'comment_id'].every(k => typeof n[k] === 'string' && uuid.test(n[k] as string)) ||
      n.recipient_id !== accountId || typeof n.actor_name !== 'string' || !['reply', 'mention', 'reaction'].includes(n.kind as string) ||
      !(n.emoji === null || typeof n.emoji === 'string') || typeof n.created_at !== 'string' || !Number.isFinite(Date.parse(n.created_at)) ||
      !(n.read_at === null || (typeof n.read_at === 'string' && Number.isFinite(Date.parse(n.read_at))))) throw new Error('Invalid notification')
    return n as unknown as DiscussionNotification
  })
  if (new Set(items.map(n => n.id)).size !== items.length || (value.has_more && items.length !== 40)) throw new Error('Invalid page')
  return { items, unread_count: value.unread_count as number, has_more: value.has_more }
}
