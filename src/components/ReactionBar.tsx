import { useEffect, useId, useRef, useState } from 'react'
import type { PlayReactionsModel } from '../hooks/usePlayReactions'
import { REACTION_EMOJIS } from '../utils/playReactions'

export function ReactionBar({ model, commentId = null }: { model: PlayReactionsModel; commentId?: string | null }) {
  const [choosing, setChoosing] = useState(false)
  const pickerId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  const enabled = !!model.userId && !model.loading && !model.saving && !model.error
  useEffect(() => {
    if (enabled && restoreFocus.current) { restoreFocus.current = false; trigger.current?.focus() }
  }, [enabled])
  const closePicker = () => { setChoosing(false); trigger.current?.focus() }
  const rows = model.rows.filter(row => row.comment_id === commentId)
  return (
    <div className="mt-3" aria-label="Reazioni">
      <div className="flex flex-wrap gap-1">
        {REACTION_EMOJIS.map(emoji => {
          const count = rows.filter(row => row.emoji === emoji).length
          const selected = rows.some(row => row.user_id === model.userId && row.emoji === emoji)
          if (count === 0) return null
          return <button key={emoji} type="button" aria-pressed={selected}
            aria-label={`${emoji}, ${count} reazioni${selected ? ', tua reazione' : ''}`}
            disabled={!enabled}
            onClick={() => void model.react(commentId, emoji)}
            className={`min-h-11 min-w-11 rounded-lg border px-2 text-sm focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50 ${selected ? 'border-emerald-400 bg-emerald-500/15 text-white' : 'border-slate-600 text-slate-200 hover:bg-slate-700'}`}>
            {emoji}{count > 0 && ` ${count}`}
          </button>
        })}
        {model.userId && <button type="button" ref={trigger} disabled={!enabled}
          aria-expanded={choosing && enabled} aria-controls={choosing && enabled ? pickerId : undefined}
          onClick={() => setChoosing(!choosing)}
          className="min-h-11 rounded-lg px-3 text-sm text-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50">
          Reagisci
        </button>}
      </div>
      {choosing && enabled && <div id={pickerId} role="group" aria-label="Scegli una reazione"
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); closePicker() } }}
        className="mt-2 rounded-lg border border-slate-600 bg-slate-900 p-2">
        <div className="flex flex-wrap gap-1">
          {REACTION_EMOJIS.map(emoji => <button type="button" key={emoji} aria-label={`Reagisci con ${emoji}`}
            aria-pressed={rows.some(row => row.user_id === model.userId && row.emoji === emoji)}
            onClick={() => { restoreFocus.current = true; setChoosing(false); void model.react(commentId, emoji) }}
            className="min-h-11 min-w-11 rounded-lg border border-slate-600 px-2 text-sm text-white hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-emerald-400">
            {emoji}
          </button>)}
        </div>
        <button type="button" onClick={closePicker}
          className="min-h-11 rounded px-3 text-sm text-slate-300 focus-visible:ring-2 focus-visible:ring-emerald-400">Chiudi</button>
      </div>}
      {(model.loading || model.saving) && <p role="status" className="mt-2 text-sm text-slate-300">Aggiornamento reazioni…</p>}
      {model.error && <div role="alert" className="mt-2 text-sm text-red-300">
        Reazioni non confermate. Rileggi prima di riprovare.
        <button type="button" onClick={() => void model.reload()} className="min-h-11 rounded px-2 underline focus-visible:ring-2 focus-visible:ring-emerald-400">Rileggi reazioni</button>
      </div>}
    </div>
  )
}
