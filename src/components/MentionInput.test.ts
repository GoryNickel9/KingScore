import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
vi.mock('../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))
import { MentionText, MentionInput } from './MentionInput'
const person = { user_id: '00000000-0000-0000-0000-000000000001', label: 'Anna (A)' }
describe('mention rendering', () => {
  it('highlights literal labels while escaping HTML and regex characters', () => {
    const html = renderToStaticMarkup(createElement(MentionText, { content: '@Anna (A) <script>alert(1)</script>', mentions: [person] }))
    expect(html).toContain('>@Anna (A)</span>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })
  it('shows a labelled input and removable selected people with stable IDs', () => {
    const html = renderToStaticMarkup(createElement(MentionInput, { value: 'Ciao @Anna (A)', mentions: [person], onChange: vi.fn(), label: 'Commento' }))
    expect(html).toContain('<label')
    expect(html).toContain('Rimuovi menzione di Anna (A)')
    expect(html).toContain('Massimo 10 persone')
  })
})
