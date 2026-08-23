/**
 * Assegnazione delle posizioni in una partita — fonte unica di verità.
 *
 * Usata da:
 *  - simulation.ts (ricalcolo ELO: la semantica QUI decide il ranking reale)
 *  - AddPlay/EditPlay (posizioni salvate a DB, coerenti col ricalcolo)
 *
 * Regola competitiva (identica al core ELO, non modificarla senza aggiornare
 * i test di caratterizzazione di simulation.test.ts):
 *  - tutti i vincitori → posizione 1 (pareggio partagio)
 *  - i non vincitori ordinati per punteggio decrescente → posizioni successive
 *
 * Regola cooperativa (teamWon definito): nessuna classifica individuale,
 * posizione 1 a tutti se il team ha vinto, 2 altrimenti.
 */

export interface PositionInput {
  winner: boolean
  score?: number | null
}

export interface AssignPositionsOptions {
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

  const sorted = [...players].sort((a, b) => {
    if (a.winner && !b.winner) return -1
    if (!a.winner && b.winner) return 1
    if (a.score != null && b.score != null) {
      return b.score - a.score
    }
    return 0
  })

  const winnersCount = sorted.filter(p => p.winner).length
  let currentPosition = 1

  return sorted.map((player, index) => {
    if (player.winner) {
      return { ...player, position: 1 }
    }
    if (index === winnersCount) {
      currentPosition = winnersCount + 1
    } else {
      currentPosition++
    }
    return { ...player, position: currentPosition }
  })
}
