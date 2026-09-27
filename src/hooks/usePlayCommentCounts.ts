import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export const usePlayCommentCounts = (playIds: Array<string | null | undefined>): Record<string, number> => {
  const playIdsKey = [...new Set(playIds.filter((id): id is string => Boolean(id)))].sort().join(',')
  const [snapshot, setSnapshot] = useState<{ key: string; counts: Record<string, number> }>({
    key: '',
    counts: {}
  })

  useEffect(() => {
    const ids = playIdsKey ? playIdsKey.split(',') : []
    let isCurrent = true

    if (ids.length === 0) {
      return
    }

    void supabase
      .from('play_comments')
      .select('play_id')
      .in('play_id', ids)
      .then(({ data, error }) => {
        if (!isCurrent) return
        if (error) {
          console.error('Error fetching play comment counts:', error)
          return
        }

        const nextCounts: Record<string, number> = {}
        data?.forEach(({ play_id }) => {
          nextCounts[play_id] = (nextCounts[play_id] ?? 0) + 1
        })
        setSnapshot({ key: playIdsKey, counts: nextCounts })
      })

    return () => {
      isCurrent = false
    }
  }, [playIdsKey])

  return snapshot.key === playIdsKey ? snapshot.counts : {}
}
