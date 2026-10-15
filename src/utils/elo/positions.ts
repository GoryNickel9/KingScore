/**
 * Assegnazione delle posizioni in una partita — fonte unica di verità.
 *
 * Usata da:
 *  - simulation.ts (ricalcolo ELO: la semantica QUI decide il ranking reale)
 *  - AddPlay/EditPlay (posizioni salvate a DB, coerenti col ricalcolo)
 *
 * Regola competitiva (identica al core ELO, non modificarla senza aggiornare
 * i test di caratterizzazione di simulation.test.ts):
 *  - tutti i vincitori → posizione 1
 *  - i non vincitori ordinati secondo le regole del gioco
 *  - parità condivise: ranking 1, 2, 2, 4; punteggio crescente se configurato
 *
 * Regola cooperativa (teamWon definito): nessuna classifica individuale,
 * posizione 1 a tutti se il team ha vinto, 2 altrimenti.
 */
import { getGameRankingRules } from './gameRules.ts'
import type { GameRuleConfig } from './gameRules.ts'

export interface PositionInput {
  winner: boolean | null
  score?: number | null
  position?: number | null
}

export interface AssignPositionsOptions {
  gameId?: string | null
  game?: Partial<GameRuleConfig> | null
  /** Partita cooperativa con esito del team noto. */
  cooperative?: boolean
  teamWon?: boolean | null
}

export function assignPositions<T extends PositionInput>(
  players: T[],
  options: AssignPositionsOptions = {}
): (T & { position: number })[] {
  if (options.cooperative && (options.teamWon === true || options.teamWon === false)) {
    const position = options.teamWon ? 1 : 2
    return players.map(player => ({ ...player, position }))
  }

  const rules = getGameRankingRules(options.gameId, options.game)
  // Un punteggio mancante non è zero: con posizioni complete conserviamo
  // l'esito importato invece di ricostruire una classifica da dati incompleti.
  const useExplicitPositions = players.some(p => p.score == null) &&
    players.every(p => p.position != null && Number.isInteger(p.position) && p.position > 0)
  const sorted = [...players].sort((a, b) => {
    if (a.winner && !b.winner) return -1
    if (!a.winner && b.winner) return 1
    if (useExplicitPositions) return a.position! - b.position!
    if (a.score != null && b.score != null) {
      const difference = rules.lowerScoreWins ? a.score - b.score : b.score - a.score
      if (difference !== 0 || rules.sharedScorePositions) return difference
      return (a.position ?? 0) - (b.position ?? 0)
    }
    // In Pili Pili un punteggio mancante non equivale a zero o a un pareggio.
    if (rules.sharedScorePositions || rules.lowerScoreWins) return a.score == null ? (b.score == null ? 0 : 1) : -1
    return 0
  })

  const winnersCount = sorted.filter(p => p.winner).length
  let currentPosition = 1
  let previousScore: number | null | undefined
  let previousPosition: number | null | undefined

  return sorted.map((player, index) => {
    if (player.winner) {
      return { ...player, position: 1 }
    }
    if (index === winnersCount) {
      currentPosition = winnersCount + 1
    } else if (useExplicitPositions || rules.sharedScorePositions) {
      const tied = useExplicitPositions ? player.position === previousPosition
        : player.score != null && player.score === previousScore
      if (!tied) currentPosition = index + 1
    } else {
      currentPosition++
    }
    previousScore = player.score
    previousPosition = player.position
    return { ...player, position: currentPosition }
  })
}
