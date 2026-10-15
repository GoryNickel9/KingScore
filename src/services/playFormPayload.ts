import type { PlaySavePayload, PlayScoreInput } from './playSaveRequests'
import { parsePlayDuration } from '../utils/playDuration'

export interface PlayFormFields {
  gameId: string; playedAt: string; durationMinutes: string; source: string; notes: string
  isCooperative: boolean; teamWon: boolean | null
}

/** Keep decimal text intact; preparePlaySave validates the complete snapshot before any write. */
export function playFormPayload(form: PlayFormFields, scores: PlayScoreInput[]): PlaySavePayload {
  const duration = parsePlayDuration(form.durationMinutes)
  if (duration === null) throw new Error('Inserisci una durata valida in minuti interi, maggiore di zero.')
  if (form.source !== 'offline' && form.source !== 'online') throw new Error('Seleziona una fonte valida.')
  if (form.isCooperative) {
    if (form.teamWon === null) throw new Error('Indica se il gruppo ha vinto o perso.')
  } else if (!scores.some(score => score.winner === true)) {
    throw new Error('Seleziona almeno un vincitore prima di salvare.')
  }
  return {
    game_id: form.gameId, played_at: form.playedAt,
    duration_minutes: duration,
    source: form.source, notes: form.notes || null, is_cooperative: form.isCooperative,
    team_won: form.isCooperative ? form.teamWon : null,
    scores: scores.map(score => ({ ...score,
      winner: form.isCooperative && form.teamWon !== null ? form.teamWon : score.winner })),
  }
}
