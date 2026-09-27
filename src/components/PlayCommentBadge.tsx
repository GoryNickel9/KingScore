import { MessageCircle } from 'lucide-react'

interface PlayCommentBadgeProps {
  count: number
}

export const PlayCommentBadge = ({ count }: PlayCommentBadgeProps) => {
  if (count < 1) return null

  const label = `${count} ${count === 1 ? 'commento' : 'commenti'}`

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-cyan-500/15 px-2 py-1 text-xs font-medium text-cyan-300"
      aria-label={label}
      title={label}
    >
      <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
      {count}
    </span>
  )
}
