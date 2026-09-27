import type { Database } from './db'

/**
 * Tipi Row delle tabelle, derivati dallo schema reale del database.
 *
 * Fonte di verità: src/types/db.ts, rigenerabile con
 *   supabase gen types typescript --linked > src/types/db.ts
 *
 * Le pagine NON devono più dichiarare interfacce Db* locali: importano da
 * qui. Attenzione alla nullabilità: questi tipi riflettono il DB (es.
 * play_scores.winner è boolean | null, plays.game_id è string | null).
 */

export type DbGame = Database['public']['Tables']['games']['Row']
export type DbPlayer = Database['public']['Tables']['players']['Row']
export type DbPlay = Database['public']['Tables']['plays']['Row']
export type DbPlayComment = Database['public']['Tables']['play_comments']['Row']
export type DbAdminRegistration = Database['public']['Functions']['admin_list_registrations']['Returns'][number]
export type DbPlayScore = Database['public']['Tables']['play_scores']['Row']
export type DbPlayerRating = Database['public']['Tables']['player_ratings']['Row']
export type DbPlayerGeneralRating = Database['public']['Tables']['player_general_ratings']['Row']
export type DbEloHistory = Database['public']['Tables']['elo_history']['Row']
export type DbEloRecalcRun = Database['public']['Tables']['elo_recalc_runs']['Row']

/** Tipi Insert per le scritture dirette. */
export type DbPlayInsert = Database['public']['Tables']['plays']['Insert']
export type DbPlayScoreInsert = Database['public']['Tables']['play_scores']['Insert']

/**
 * Righe con relazioni annidate delle query join tipiche
 * (select('*, play_scores(*, players(*))') e simili). Con il client
 * tipizzato il risultato delle query è già inferito: usare questi tipi
 * solo per stato/props quando serve nominarlo esplicitamente.
 */
export type DbPlayScoreWithPlayer = DbPlayScore & { players: DbPlayer | null }
/** Play con games + play_scores(+players) — query `*, games(*), play_scores(*, players(*))`. */
export type DbPlayWithScores = DbPlay & {
  games: DbGame | null
  play_scores: DbPlayScoreWithPlayer[] | null
}
/** Come sopra ma senza games — query di GameDetail. */
export type DbPlayWithScoresOnly = DbPlay & {
  play_scores: DbPlayScoreWithPlayer[] | null
}

/** Rating con giocatore annidato — query `*, players(*)` (pagina ELO). */
export type DbPlayerRatingWithPlayer = DbPlayerRating & { players: DbPlayer | null }
export type DbGeneralRatingWithPlayer = DbPlayerGeneralRating & { players: DbPlayer | null }
