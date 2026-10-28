import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ReactionBar } from './ReactionBar'
import type { PlayReactionsModel } from '../hooks/usePlayReactions'
import { Check, MessageCircle, Pencil, Send, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import type { DbPlayComment } from '../types/rows'
import { isDesktopCommentDevice, MAX_PLAY_COMMENT_LENGTH, normalizePlayCommentContent, shouldSubmitPlayComment } from '../utils/playComments'
import { getPlayerImageUrl } from '../utils/imageUpload'

type PlayCommentWithAvatar = DbPlayComment & { author_avatar_url: string | null }

async function attachAuthorAvatars(
  comments: DbPlayComment[],
  currentUserId: string | undefined,
  currentUserAvatarPath: string | null
): Promise<PlayCommentWithAvatar[]> {
  const userIds = [...new Set(comments.map((comment) => comment.user_id))]
  const avatarByUserId = new Map<string, string | null>()

  if (userIds.length > 0) {
    try {
      const { data, error } = await supabase
        .from('players')
        .select('account_user_id, avatar_url')
        .in('account_user_id', userIds)

      if (error) throw error
      for (const player of data) {
        if (player.account_user_id) avatarByUserId.set(player.account_user_id, player.avatar_url)
      }
    } catch (error) {
      console.warn('Could not load comment author profile images:', error)
    }
  }

  return comments.map((comment) => ({
    ...comment,
    author_avatar_url: avatarByUserId.get(comment.user_id) ??
      (comment.user_id === currentUserId ? currentUserAvatarPath : null),
  }))
}

interface PlayCommentsProps {
  playId: string
  reactions: PlayReactionsModel
}

function getAuthorInitial(name: string): string {
  return name.trim().charAt(0).toLocaleUpperCase('it-IT') || 'U'
}

function formatCommentDate(date: string): string {
  return new Date(date).toLocaleString('it-IT', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

const PlayComments = ({ playId, reactions }: PlayCommentsProps) => {
  const { user } = useAuth()
  const currentUserAvatarPath = typeof user?.user_metadata?.avatar_url === 'string'
    ? user.user_metadata.avatar_url
    : null
  const [comments, setComments] = useState<PlayCommentWithAvatar[]>([])
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<PlayCommentWithAvatar | null>(null)
  const draftRef = useRef<HTMLTextAreaElement>(null)
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const submittingComment = useRef(false)
  const desktopCommentShortcut = isDesktopCommentDevice(navigator)

  const fetchComments = async (): Promise<void> => {
    setLoading(true)
    setLoadError(false)

    try {
      const { data, error } = await supabase
        .from('play_comments')
        .select('*')
        .eq('play_id', playId)
        .order('created_at', { ascending: true })

      if (error) throw error
      setComments(await attachAuthorAvatars(data, user?.id, currentUserAvatarPath))
    } catch (error) {
      console.error('Error fetching play comments:', error)
      setLoadError(true)
      toast.error('Impossibile caricare i commenti')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let isCurrent = true
    setReplyTo(null)
    setDraft('')

    const loadComments = async (): Promise<void> => {
      setLoading(true)
      setLoadError(false)
      try {
        const { data, error } = await supabase
          .from('play_comments')
          .select('*')
          .eq('play_id', playId)
          .order('created_at', { ascending: true })

        if (error) throw error
        const enrichedComments = await attachAuthorAvatars(data, user?.id, currentUserAvatarPath)
        if (!isCurrent) return
        setComments(enrichedComments)
      } catch (error) {
        if (!isCurrent) return
        console.error('Error fetching play comments:', error)
        setLoadError(true)
      } finally {
        if (isCurrent) setLoading(false)
      }
    }

    void loadComments()
    return () => {
      isCurrent = false
    }
  }, [playId, user?.id, currentUserAvatarPath])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (saving || submittingComment.current) return
    const content = normalizePlayCommentContent(draft)
    if (!content) {
      toast.error('Scrivi un commento prima di inviarlo')
      return
    }

    submittingComment.current = true
    setSaving(true)
    try {
      const { data, error } = await supabase
        .from('play_comments')
        .insert({ play_id: playId, content, parent_comment_id: replyTo?.id ?? null })
        .select('*')
        .single()

      if (error) throw error
      const [commentWithAvatar] = await attachAuthorAvatars([data], user?.id, currentUserAvatarPath)
      setComments((current) => [...current, commentWithAvatar])
      setDraft('')
      setReplyTo(null)
      toast.success('Commento pubblicato')
    } catch (error) {
      console.error('Error creating play comment:', error)
      toast.error("Impossibile pubblicare il commento. Riprova.")
    } finally {
      submittingComment.current = false
      setSaving(false)
    }
  }

  const handleEdit = async (commentId: string): Promise<void> => {
    const content = normalizePlayCommentContent(editDraft)
    if (!content) {
      toast.error('Il commento non può essere vuoto')
      return
    }

    setSaving(true)
    const { data, error } = await supabase
      .from('play_comments')
      .update({ content })
      .eq('id', commentId)
      .select('*')
      .single()

    if (error) {
      console.error('Error updating play comment:', error)
      toast.error('Impossibile modificare il commento')
    } else {
      setComments((current) => current.map((comment) => comment.id === commentId ? { ...comment, ...data } : comment))
      setEditingCommentId(null)
      setEditDraft('')
      toast.success('Commento aggiornato')
    }
    setSaving(false)
  }

  const handleDelete = async (commentId: string): Promise<void> => {
    setSaving(true)
    const { error } = await supabase
      .from('play_comments')
      .delete()
      .eq('id', commentId)

    if (error) {
      console.error('Error deleting play comment:', error)
      toast.error('Impossibile eliminare il commento')
    } else {
      setComments((current) => current.filter((comment) => comment.id !== commentId).map(comment =>
        comment.parent_comment_id === commentId ? { ...comment, parent_comment_id: null } : comment))
      if (replyTo?.id === commentId) setReplyTo(null)
      void reactions.reload()
      setDeletingCommentId(null)
      toast.success('Commento eliminato')
    }
    setSaving(false)
  }

  return (
    <section className="bg-slate-800 rounded-xl p-6 shadow-md" aria-labelledby="play-comments-title">
      <div className="flex items-center gap-3 mb-5">
        <div className="bg-emerald-500/15 p-2 rounded-lg">
          <MessageCircle className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h2 id="play-comments-title" className="text-xl font-bold text-white">Commenti</h2>
          <p className="text-sm text-slate-400">
            {comments.length === 1 ? '1 commento' : `${comments.length} commenti`}
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-slate-400 py-4" role="status">Caricamento commenti...</p>
      ) : loadError ? (
        <div className="flex flex-wrap items-center gap-3 py-3">
          <p className="text-sm text-red-300">Non è stato possibile caricare i commenti.</p>
          <button type="button" onClick={() => void fetchComments()} className="text-sm text-emerald-400 hover:text-emerald-300">
            Riprova
          </button>
        </div>
      ) : comments.length === 0 ? (
        <p className="text-slate-400 py-3">Ancora nessun commento. Inizia tu la conversazione.</p>
      ) : (
        <ul className="divide-y divide-slate-700">
          {comments.map((comment) => {
            const isAuthor = user?.id === comment.user_id
            const isEditing = editingCommentId === comment.id
            const isConfirmingDelete = deletingCommentId === comment.id

            return (
              <li key={comment.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex items-start gap-3">
                {comment.author_avatar_url ? (
                  <img
                    src={getPlayerImageUrl(supabase, comment.author_avatar_url) ?? undefined}
                    alt={`${comment.author_name} · immagine profilo`}
                    className="w-9 h-9 shrink-0 rounded-full bg-slate-700 object-cover"
                  />
                ) : (
                  <div className="w-9 h-9 shrink-0 rounded-full bg-slate-700 flex items-center justify-center text-sm font-semibold text-emerald-300" aria-hidden="true">
                    {getAuthorInitial(comment.author_name)}
                  </div>
                )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium text-white">{comment.author_name}</span>
                      <time className="text-xs text-slate-500" dateTime={comment.updated_at}>
                        {formatCommentDate(comment.updated_at)}
                        {comment.updated_at !== comment.created_at && ' · modificato'}
                      </time>
                    </div>

                    {comment.parent_comment_id && (
                      <blockquote className="mt-2 border-l-2 border-slate-500 pl-3 text-sm text-slate-300">
                        {(() => {
                          const parent = comments.find(item => item.id === comment.parent_comment_id)
                          return parent ? `In risposta a ${parent.author_name}: ${parent.content}` : 'In risposta a un commento precedente'
                        })()}
                      </blockquote>
                    )}
                    {user && (
                      <button type="button" disabled={saving} aria-label={`Rispondi a ${comment.author_name}`}
                        onClick={() => { setReplyTo(comment); draftRef.current?.focus() }}
                        className="min-h-11 rounded px-2 text-sm text-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50">
                        Rispondi
                      </button>
                    )}
                    {isEditing ? (
                      <div className="mt-3 space-y-2">
                        <textarea
                          value={editDraft}
                          onChange={(event) => setEditDraft(event.target.value)}
                          maxLength={MAX_PLAY_COMMENT_LENGTH}
                          rows={3}
                          aria-label="Modifica commento"
                          className="w-full resize-y rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs text-slate-500">{editDraft.length}/{MAX_PLAY_COMMENT_LENGTH}</span>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => { setEditingCommentId(null); setEditDraft('') }} className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-700" disabled={saving}>
                              <X className="w-4 h-4" /> Annulla
                            </button>
                            <button type="button" onClick={() => void handleEdit(comment.id)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50" disabled={saving}>
                              <Check className="w-4 h-4" /> Salva
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-300">{comment.content}</p>
                    )}

                    <ReactionBar model={reactions} commentId={comment.id} />
                    {isAuthor && !isEditing && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {isConfirmingDelete ? (
                          <>
                            <span className="text-xs text-slate-400">Eliminare questo commento?</span>
                            <button type="button" onClick={() => void handleDelete(comment.id)} disabled={saving} className="rounded-md px-2 py-1 text-xs font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-50">Elimina</button>
                            <button type="button" onClick={() => setDeletingCommentId(null)} disabled={saving} className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-700">Annulla</button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => { setEditingCommentId(comment.id); setEditDraft(comment.content); setDeletingCommentId(null) }}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-white"
                            >
                              <Pencil className="w-3 h-3" /> Modifica
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingCommentId(comment.id)}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-red-500/10 hover:text-red-300"
                            >
                              <Trash2 className="w-3 h-3" /> Elimina
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="mt-5 border-t border-slate-700 pt-5">
        {user ? (
          <form onSubmit={(event) => void handleSubmit(event)} className="space-y-3">
            {replyTo && (
              <div className="rounded-lg border border-slate-600 p-3 text-sm text-slate-300">
                <p>In risposta a {replyTo.author_name}: {replyTo.content}</p>
                <button type="button" disabled={saving} onClick={() => { setReplyTo(null); draftRef.current?.focus() }}
                  className="min-h-11 rounded px-2 text-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-400">Annulla risposta</button>
              </div>
            )}
            <label htmlFor="new-play-comment" className="block text-sm font-medium text-slate-300">Lascia un commento</label>
            <textarea
              id="new-play-comment"
              ref={draftRef}
              disabled={saving}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (!shouldSubmitPlayComment(event.nativeEvent, navigator)) return
                event.preventDefault()
                if (!event.repeat) event.currentTarget.form?.requestSubmit()
              }}
              aria-describedby={desktopCommentShortcut ? 'play-comment-keyboard-hint' : undefined}
              maxLength={MAX_PLAY_COMMENT_LENGTH}
              rows={3}
              placeholder="Com'è andata la partita?"
              className="w-full resize-y rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            {desktopCommentShortcut && (
              <p id="play-comment-keyboard-hint" className="text-xs text-slate-400">
                Invio per pubblicare · Shift+Invio per andare a capo
              </p>
            )}
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500">{draft.length}/{MAX_PLAY_COMMENT_LENGTH}</span>
              <button
                type="submit"
                disabled={saving || !normalizePlayCommentContent(draft)}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="w-4 h-4" /> Pubblica
              </button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-slate-400">
            <Link to="/login" className="font-medium text-emerald-400 hover:text-emerald-300">Accedi</Link>
            {' '}per lasciare un commento.
          </p>
        )}
      </div>
    </section>
  )
}

export default PlayComments
