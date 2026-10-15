interface OutcomeScore {
  winner?: boolean | null
  draw?: boolean | null
}

export interface OutcomePlay {
  is_cooperative?: boolean | null
  team_won?: boolean | null
}

/** P = primo posto condiviso. Un piazzamento pari tra sconfitti resta S. */
export function getPlayerOutcome(
  score: OutcomeScore | null | undefined,
  scores: readonly OutcomeScore[] | null | undefined,
  play: OutcomePlay = {},
): 'win' | 'draw' | 'loss' {
  if (!score) return 'loss'
  if (play.is_cooperative) return (play.team_won ?? score.winner) ? 'win' : 'loss'
  if (score.draw) return 'draw'
  if (!score.winner) return 'loss'
  return (scores?.filter(s => s.winner).length ?? 0) > 1 ? 'draw' : 'win'
}
