import type { DbPlay, DbPlayScore } from '../types/rows'
import { parsePlayDuration } from './playDuration'

export type PlayCompletenessInput = Pick<DbPlay, 'duration_minutes' | 'is_cooperative' | 'team_won'> & {
  play_scores: Pick<DbPlayScore, 'score' | 'winner'>[] | null
}

export function checkPlayCompleteness(play: PlayCompletenessInput) {
  const scores = play.play_scores ?? []
  return {
    duration: parsePlayDuration(String(play.duration_minutes ?? '')) !== null,
    winners: play.is_cooperative === true
      ? typeof play.team_won === 'boolean'
      : scores.some(score => score.winner === true),
    scores: scores.length > 0 && scores.every(score => score.score !== null && Number.isFinite(score.score)),
  }
}
