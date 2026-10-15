import type { PlaySavePayload, PlayScoreInput } from './playSaveRequests'

export interface PlayFormFields {
  gameId: string; playedAt: string; durationMinutes: string; source: string; notes: string
  isCooperative: boolean; teamWon: boolean | null
}

/** Keep decimal text intact; preparePlaySave validates the complete snapshot before any write. */
export function playFormPayload(form: PlayFormFields, scores: PlayScoreInput[]): PlaySavePayload {
  if (form.durationMinutes !== '' && !/^(0|[1-9][0-9]*)$/.test(form.durationMinutes)) {
    throw new Error('La durata deve essere un numero intero di minuti, maggiore o uguale a zero.')
  }
  if (form.source !== 'offline' && form.source !== 'online') throw new Error('Seleziona una fonte valida.')
  return {
    game_id: form.gameId, played_at: form.playedAt,
    duration_minutes: form.durationMinutes === '' ? null : Number(form.durationMinutes),
    source: form.source, notes: form.notes || null, is_cooperative: form.isCooperative,
    team_won: form.isCooperative ? form.teamWon : null,
    scores: scores.map(score => ({ ...score,
      winner: form.isCooperative && form.teamWon !== null ? form.teamWon : score.winner })),
  }
}
