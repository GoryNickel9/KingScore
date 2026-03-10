import type { ComponentType } from 'react'
import type { User, Session } from '@supabase/supabase-js'
export type { User, Session }

// ─── Dominio: Giochi ─────────────────────────────────────────────────────────
export interface Game {
  id: string
  name: string
  bgg_id?: number | null
  thumbnail?: string | null
  image?: string | null
  min_players?: number | null
  max_players?: number | null
  playing_time?: number | null
  description?: string | null
  year_published?: number | null
  created_at: string
}

// ─── Dominio: Giocatori ───────────────────────────────────────────────────────
export interface Player {
  id: string
  name: string
  alias?: string | null
  avatar_url?: string | null
  color?: string | null
  created_at: string
}

// ─── Dominio: Punteggi ────────────────────────────────────────────────────────
export interface PlayScore {
  id: string
  play_id: string
  player_id: string
  score?: number | null
  position?: number | null
  winner: boolean
  players?: Player
}

// ─── Dominio: Partite ─────────────────────────────────────────────────────────
export interface Play {
  id: string
  game_id: string
  played_at: string
  duration?: number | null
  notes?: string | null
  location?: string | null
  created_at: string
  games?: Game
  play_scores?: PlayScore[]
}

// ─── ELO ─────────────────────────────────────────────────────────────────────
export interface PlayerRating {
  id: string
  player_id: string
  game_id: string
  rating: number
  games_played: number
  wins: number
  updated_at: string
  players?: Player
  games?: Game
}

export interface GeneralElo {
  id: string
  player_id: string
  rating: number
  games_played: number
  wins: number
  updated_at: string
  players?: Player
}

export interface EloChangeResult {
  playerId: string
  oldRating: number
  newRating: number
  change: number
}

// ─── Immagini ─────────────────────────────────────────────────────────────────
export interface GameImage {
  id: string
  game_id: string
  url: string
  storage_path: string
  created_at: string
  games?: Game
}

// ─── Upload ───────────────────────────────────────────────────────────────────
export interface UploadResult {
  publicUrl: string
  path: string
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export interface AuthResult {
  data: { user: User | null; session: Session | null } | null
  error: Error | null
}

export interface AuthContextType {
  user: User | null
  loading: boolean
  signUp: (email: string, password: string, name: string) => Promise<AuthResult>
  signIn: (email: string, password: string) => Promise<AuthResult>
  signOut: () => Promise<void>
}

// ─── Diagnosi ─────────────────────────────────────────────────────────────────
export interface DiagnosisResult {
  totalPlays: number
  problematicPlays: PlayDiagnosis[]
  playsWithoutScores: PlayDiagnosis[]
  playsWithOneScore: PlayDiagnosis[]
  playsWithMultipleScores: PlayDiagnosis[]
}

export interface PlayDiagnosis {
  id: string
  gameName: string
  playedAt: string
  scoresCount: number
  scores: PlayScore[]
}

// ─── Navigazione ─────────────────────────────────────────────────────────────
export interface NavItem {
  path: string
  icon: ComponentType<{ className?: string }>
  label: string
}
