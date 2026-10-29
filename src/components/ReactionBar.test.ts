import { createElement } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReactionBar } from './ReactionBar'
import type { PlayReactionsModel } from '../hooks/usePlayReactions'

const base: PlayReactionsModel = { rows: [], userId: 'me', loading: false, saving: false, error: false, reload: vi.fn(), react: vi.fn() }
describe('ReactionBar', () => {
  it('hides all unused emojis and offers a closed picker for signed-in users', () => {
    const html = renderToStaticMarkup(createElement(ReactionBar, { model: base, commentId: 'c' }))
    expect(html).toContain('Reagisci')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('aria-pressed')
    expect(html).not.toContain('👍')
    expect(html).not.toContain('❤️')
    expect(html).not.toContain('Scegli una reazione')
  })
  it('shows only used emojis, grouping multiple users into the same count', () => {
    const rows = [
      { id: '1', play_id: 'p', comment_id: 'c', user_id: 'me', emoji: '👍' },
      { id: '2', play_id: 'p', comment_id: 'c', user_id: 'other', emoji: '👍' },
    ]
    const html = renderToStaticMarkup(createElement(ReactionBar, { model: { ...base, rows }, commentId: 'c' }))
    expect(html).toContain('👍, 2 reazioni, tua reazione')
    expect(html.match(/aria-pressed=/g)).toHaveLength(1)
    expect(html).not.toContain('❤️')
    expect(html).not.toContain('😂')
  })
  it('shows accessible counts, own selection and separates note and comment reactions', () => {
    const rows = [{ id: '1', play_id: 'p', comment_id: 'c', user_id: 'me', emoji: '👍' },
      { id: '2', play_id: 'p', comment_id: null, user_id: 'other', emoji: '❤️' }]
    const comment = renderToStaticMarkup(createElement(ReactionBar, { model: { ...base, rows }, commentId: 'c' }))
    expect(comment).toContain('👍, 1 reazioni, tua reazione')
    expect(comment).toContain('aria-pressed="true"')
    const notes = renderToStaticMarkup(createElement(ReactionBar, { model: { ...base, rows } }))
    expect(notes).toContain('❤️, 1 reazioni')
    expect(notes).not.toContain('tua reazione')
  })
  it('disables writes after an uncertain result and exposes reread', () => {
    const html = renderToStaticMarkup(createElement(ReactionBar, { model: { ...base, error: true } }))
    expect(html.match(/disabled=""/g)).toHaveLength(1)
    expect(html).toContain('Rileggi reazioni')
  })
  it('anonymous readers see existing counts without mutation controls for empty emojis', () => {
    const rows = [{ id: '1', play_id: 'p', comment_id: null, user_id: 'other', emoji: '❤️' }]
    const html = renderToStaticMarkup(createElement(ReactionBar, { model: { ...base, rows, userId: undefined } }))
    expect(html.match(/<button/g)).toHaveLength(1)
    expect(html).toContain('disabled=""')
  })
})
