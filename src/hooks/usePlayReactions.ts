import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { Database } from '../types/db'
import { nextReaction, type ReactionEmoji } from '../utils/playReactions'

type Reaction = Database['public']['Tables']['play_reactions']['Row']

export function usePlayReactions(playId: string | undefined) {
  const { user } = useAuth()
  const [rows, setRows] = useState<Reaction[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const scope = `${playId}:${user?.id}`
  const currentScope = useRef(scope)
  currentScope.current = scope
  const busy = useRef(false)
  const request = useRef(0)

  const read = useCallback(async () => {
    if (!playId) return []
    const all: Reaction[] = []
    let after: string | undefined
    while (true) {
      let query = supabase.from('play_reactions').select('*').eq('play_id', playId).order('id').limit(500)
      if (after) query = query.gt('id', after)
      const { data, error: failure } = await query
      if (failure) throw failure
      all.push(...data)
      if (data.length < 500) return all
      after = data[data.length - 1].id
    }
  }, [playId])

  const reload = useCallback(async () => {
    if (busy.current) return
    const stamp = ++request.current
    setLoading(true)
    try {
      const data = await read()
      if (stamp === request.current && currentScope.current === scope) { setRows(data); setError(false) }
    } catch {
      if (stamp === request.current && currentScope.current === scope) setError(true)
    } finally {
      if (stamp === request.current && currentScope.current === scope) setLoading(false)
    }
  }, [read, scope])

  useEffect(() => {
    busy.current = false
    setRows([]); setSaving(false); setError(false)
    void reload()
    const requestCounter = request
    return () => { requestCounter.current++ }
  }, [reload])

  const react = async (commentId: string | null, emoji: ReactionEmoji) => {
    if (!playId || !user || loading || error || busy.current) return
    busy.current = true
    setSaving(true)
    const stamp = ++request.current
    const selected = rows.find(row => row.comment_id === commentId && row.user_id === user.id)?.emoji
    const next = nextReaction(selected, emoji)
    try {
      if (next === null) {
        let query = supabase.from('play_reactions').delete().eq('play_id', playId).eq('user_id', user.id)
        query = commentId === null ? query.is('comment_id', null) : query.eq('comment_id', commentId)
        const { error: failure } = await query
        if (failure) throw failure
      } else {
        const { error: failure } = await supabase.from('play_reactions').upsert(
          { play_id: playId, comment_id: commentId, user_id: user.id, emoji: next },
          { onConflict: 'play_id,comment_id,user_id' })
        if (failure) throw failure
      }
      const data = await read()
      if (stamp === request.current && currentScope.current === scope) { setRows(data); setError(false) }
    } catch {
      if (stamp === request.current && currentScope.current === scope) setError(true)
    } finally {
      if (stamp === request.current && currentScope.current === scope) { busy.current = false; setSaving(false) }
    }
  }

  return { rows, loading, saving, error, reload, react, userId: user?.id }
}

export type PlayReactionsModel = ReturnType<typeof usePlayReactions>
