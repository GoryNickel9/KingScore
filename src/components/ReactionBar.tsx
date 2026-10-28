import type { PlayReactionsModel } from '../hooks/usePlayReactions'
import { REACTION_EMOJIS } from '../utils/playReactions'

export function ReactionBar({ model, commentId = null }: { model: PlayReactionsModel; commentId?: string | null }) {
  const rows = model.rows.filter(row => row.comment_id === commentId)
  return (
    <div className="mt-3" aria-label="Reazioni">
      <div className="flex flex-wrap gap-1">
        {REACTION_EMOJIS.map(emoji => {
          const count = rows.filter(row => row.emoji === emoji).length
          const selected = rows.some(row => row.user_id === model.userId && row.emoji === emoji)
          if (!model.userId && count === 0) return null
          return <button key={emoji} type="button" aria-pressed={selected}
            aria-label={`${emoji}, ${count} reazioni${selected ? ', tua reazione' : ''}`}
            disabled={!model.userId || model.loading || model.saving || model.error}
            onClick={() => void model.react(commentId, emoji)}
            className={`min-h-11 min-w-11 rounded-lg border px-2 text-sm focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50 ${selected ? 'border-emerald-400 bg-emerald-500/15 text-white' : 'border-slate-600 text-slate-200 hover:bg-slate-700'}`}>
            {emoji}{count > 0 && ` ${count}`}
          </button>
        })}
      </div>
      {(model.loading || model.saving) && <p role="status" className="mt-2 text-sm text-slate-300">Aggiornamento reazioni…</p>}
      {model.error && <div role="alert" className="mt-2 text-sm text-red-300">
        Reazioni non confermate. Rileggi prima di riprovare.
        <button type="button" onClick={() => void model.reload()} className="min-h-11 rounded px-2 underline focus-visible:ring-2 focus-visible:ring-emerald-400">Rileggi reazioni</button>
      </div>}
    </div>
  )
}
