import { useEffect, useId, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { insertMention, mentionQuery, parseMentions, retainedMentions, type Mention } from '../utils/discussion'

interface Props {
  value: string; mentions: Mention[]; onChange: (value: string, mentions: Mention[]) => void
  disabled?: boolean; label: string; inputRef?: React.RefObject<HTMLTextAreaElement | null>
  onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
}
export function MentionInput({ value, mentions, onChange, disabled, label, inputRef, onKeyDown }: Props) {
  const ownRef = useRef<HTMLTextAreaElement>(null)
  const ref = inputRef ?? ownRef
  const [caret, setCaret] = useState(value.length)
  const [suggestions, setSuggestions] = useState<Mention[]>([])
  const [failed, setFailed] = useState(false)
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const id = useId()
  const query = mentionQuery(value, caret, mentions)
  const text = query?.query
  const open = text !== undefined && text !== dismissed && mentions.length < 10 && !disabled
  useEffect(() => {
    let active = true
    setSuggestions([]); setFailed(false); setSelected(0); setSearching(open)
    if (!open || text === undefined) return
    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const { data, error } = await supabase.rpc('search_mention_users', { p_query: text })
          if (error) throw error
          // Search returns up to 20 users; each selection is limited to ten.
          if (!Array.isArray(data) || data.length > 20) throw new Error('Invalid directory')
          const rows = data.map(row => parseMentions([row])[0])
          if (active) setSuggestions(rows.filter(row => !mentions.some(m => m.user_id === row.user_id)))
        } catch { if (active) setFailed(true) }
        finally { if (active) setSearching(false) }
      })()
    }, 250)
    return () => { active = false; window.clearTimeout(timeout) }
  }, [open, text, mentions])
  const choose = (person: Mention) => {
    const next = insertMention(value, caret, mentions, person)
    if (!next) return
    onChange(next.content, next.mentions); setCaret(next.caret); setSuggestions([])
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(next.caret, next.caret) })
  }
  return <div className="space-y-2">
    <label className="block text-sm text-slate-300" htmlFor={id}>{label}</label>
    <textarea id={id} ref={ref} value={value} disabled={disabled} rows={3} maxLength={1000}
      aria-describedby={`${id}-help`} aria-controls={open ? `${id}-suggestions` : undefined}
      onChange={e => { setCaret(e.target.selectionStart); setDismissed(null); onChange(e.target.value, retainedMentions(e.target.value, mentions)) }}
      onSelect={e => setCaret(e.currentTarget.selectionStart)}
      onKeyDown={e => {
        if (open && e.key === 'Escape') { e.preventDefault(); setDismissed(text ?? ''); return }
        if (open && suggestions.length && !e.shiftKey && !e.nativeEvent.isComposing && ['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
          e.preventDefault()
          if (e.key === 'Enter') choose(suggestions[selected] ?? suggestions[0])
          else setSelected(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length)
          return
        }
        onKeyDown?.(e)
      }}
      className="w-full resize-y rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-base text-white focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50" />
    <p id={`${id}-help`} className="text-xs text-slate-400">Scrivi @ e seleziona una persona per notificarla. Massimo 10 persone.</p>
    {open && <div id={`${id}-suggestions`} className="max-h-60 overflow-y-auto rounded-lg border border-slate-600 bg-slate-800 p-1" aria-label="Persone da menzionare">
      {!searching && !failed && suggestions.length > 0 && <span className="sr-only" role="status">{suggestions.length} persone. {suggestions[selected]?.label}. Usa le frecce e Invio per selezionare.</span>}
      {searching && <p role="status" className="p-3 text-sm text-slate-300">Ricerca persone…</p>}
      {failed && <p role="alert" className="p-3 text-sm text-red-200">Ricerca persone non disponibile. Puoi comunque inviare il commento.</p>}
      {!failed && !searching && suggestions.length === 0 && <p className="p-3 text-sm text-slate-300">Nessuna persona trovata.</p>}
      {suggestions.map((person, i) => <button key={person.user_id} type="button" onMouseDown={e => e.preventDefault()} onClick={() => choose(person)}
        className={`block min-h-11 w-full rounded px-3 py-2 text-left text-white focus-visible:ring-2 focus-visible:ring-emerald-400 ${i === selected ? 'bg-slate-700' : 'hover:bg-slate-700'}`}>
        {person.label} <span className="text-xs text-slate-400">· {person.user_id.slice(-6)}</span>
      </button>)}
    </div>}
    {mentions.length > 0 && <div className="flex flex-wrap gap-2" aria-label="Persone menzionate">{mentions.map(person =>
      <button key={person.user_id} type="button" disabled={disabled} onClick={() => onChange(value, mentions.filter(m => m.user_id !== person.user_id))}
        aria-label={`Rimuovi menzione di ${person.label}`} className="min-h-11 rounded-lg bg-emerald-500/15 px-3 text-sm text-emerald-200">@{person.label} ×</button>)}</div>}
  </div>
}

export function MentionText({ content, mentions }: { content: string; mentions: Mention[] }) {
  if (!mentions.length) return <>{content}</>
  const labels = [...new Set(mentions.map(m => `@${m.label}`))].sort((a, b) => b.length - a.length)
  const pattern = new RegExp(`(${labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gu')
  return <>{content.split(pattern).map((part, i) => labels.includes(part) ? <span key={i} className="font-medium text-emerald-300">{part}</span> : part)}</>
}
