/** ID del gioco esistente: la regola non dipende dal nome modificabile. */
export const PILI_PILI_GAME_ID = '904579b2-3b31-42fd-8d7b-25d68d1e5ce5'

export interface GameRankingRules {
  readonly lowerScoreWins: boolean
  readonly sharedScorePositions: boolean
}

export interface GameRuleConfig {
  lower_score_wins: boolean
  shared_score_positions: boolean
}

export const defaultGameRuleConfig: GameRuleConfig = {
  lower_score_wins: false,
  shared_score_positions: true,
}

const standardRules: GameRankingRules = {
  lowerScoreWins: false,
  sharedScorePositions: true,
}

const piliPiliRules: GameRankingRules = {
  lowerScoreWins: true,
  sharedScorePositions: true,
}

/** Il fallback per ID mantiene compatibilità con snapshot precedenti alla migrazione. */
export function getGameRankingRules(gameId?: string | null, config?: Partial<GameRuleConfig> | null): GameRankingRules {
  const fallback = gameId === PILI_PILI_GAME_ID ? piliPiliRules : standardRules
  return {
    lowerScoreWins: config?.lower_score_wins ?? fallback.lowerScoreWins,
    sharedScorePositions: config?.shared_score_positions ?? fallback.sharedScorePositions,
  }
}
