import { describe, it, expect } from 'vitest'
import { insertMention, mentionQuery, parseMentions, retainedMentions, notificationText, parseNotificationFeed, mergeNotificationRefresh } from './discussion'

const a = '00000000-0000-0000-0000-000000000001'
const b = '00000000-0000-0000-0000-000000000002'
const anna = { user_id: a, label: 'Anna Rossi' }
const notification = { id: b, recipient_id: a, actor_name: 'Bruno', play_id: a, comment_id: b,
  kind: 'reply' as const, emoji: null, created_at: '2026-11-02T12:00:00+00:00', read_at: null }
describe('discussion contracts', () => {
  it('keeps expanded history when new notifications arrive, including microsecond cursors', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ ...notification,
      id: `00000000-0000-0000-0000-${String(100 - i).padStart(12, '0')}` }))
    const newRow = { ...notification, id: '00000000-0000-0000-0000-000000000999' }
    const page = { items: [newRow, ...rows.slice(0, 39)], unread_count: 2, has_more: true }
    const merged = mergeNotificationRefresh({ items: rows, unread_count: 1, has_more: false }, page)
    expect(merged.items).toHaveLength(51)
    expect(merged.items[40]).toEqual(rows[39])
    const boundary = { ...notification, created_at: '2026-11-02T12:00:00.000002+00:00' }
    const older = { ...newRow, created_at: '2026-11-02T12:00:00.000001+00:00' }
    const micro = mergeNotificationRefresh({ items: [...rows, older], unread_count: 1, has_more: false },
      { items: [boundary], unread_count: 1, has_more: true })
    expect(micro.items).toContainEqual(older)
  })
  it('uses stable account IDs and rejects malformed, excessive and duplicate mentions', () => {
    expect(parseMentions([anna])).toEqual([anna])
    for (const value of [null, {}, [{ user_id: 'name', label: 'Anna' }], [anna, anna],
      [{ ...anna, label: '\nAnna' }], Array(11).fill(anna)]) expect(() => parseMentions(value)).toThrow()
  })
  it('finds the mention at the caret, preserving text after it and multiword labels', () => {
    expect(mentionQuery('Ciao @Anna Ro resto', 13, [])?.query).toBe('Anna Ro')
    expect(mentionQuery('mail@example.org', 16, [])).toBeNull()
    const next = insertMention('Ciao @An resto', 8, [], anna)!
    expect(next.content).toBe('Ciao @Anna Rossi  resto')
    expect(next.caret).toBe(17)
    expect(next.mentions).toEqual([anna])
    expect(mentionQuery(next.content, next.caret, next.mentions)).toBeNull()
    expect(insertMention('x'.repeat(995) + ' @', 997, [], anna)).toBeNull()
  })
  it('removes recipients whose text is deleted and never infers recipients from a typed name', () => {
    expect(retainedMentions('Ciao', [anna])).toEqual([])
    expect(retainedMentions('Ciao @Anna Rossi', [anna])).toEqual([anna])
    expect(retainedMentions('Ciao @Anna Rossi', [])).toEqual([])
  })
  it('formats all events without confusing a reply with a reaction', () => {
    expect(notificationText(notification)).toContain('ha risposto')
    expect(notificationText({ ...notification, kind: 'mention' })).toContain('ti ha menzionato')
    expect(notificationText({ ...notification, kind: 'reaction', emoji: '❤️' })).toContain('ha reagito ❤️')
  })
  it('rejects data for another account, invalid counts, cursors, timestamps and duplicate IDs', () => {
    const feed = { items: [notification], unread_count: 1, has_more: false }
    expect(parseNotificationFeed(feed, a)).toEqual(feed)
    for (const value of [{ ...feed, unread_count: -1 }, { ...feed, unread_count: 1.5 }, { ...feed, has_more: true },
      { ...feed, items: [notification, notification] }, { ...feed, items: [{ ...notification, created_at: 'bad' }] }]) {
      expect(() => parseNotificationFeed(value, a)).toThrow()
    }
    expect(() => parseNotificationFeed(feed, b)).toThrow()
  })
})
