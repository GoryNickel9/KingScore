import type { DbPlayScoreWithPlayer } from '../types/rows'

/**
 * Nomi dei vincitori di una partita (alias se presente, altrimenti nome),
 * nell'ordine delle righe. In caso di pareggio la lista contiene tutti
 * i vincitori: usare join per la visualizzazione.
 */
export function getWinnerNames(playScores: DbPlayScoreWithPlayer[] | null | undefined): string[] {
  return (playScores ?? [])
    .filter(score => score.winner)
    .map(score => score.players?.alias || score.players?.name)
    .filter((name): name is string => Boolean(name))
}
