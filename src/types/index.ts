import type { ComponentType } from 'react'
import type { User, Session } from '@supabase/supabase-js'
export type { User, Session }

// I tipi delle righe del DB (DbGame, DbPlayer, DbPlay, ...) vivono in
// src/types/rows.ts, derivati dallo schema reale (src/types/db.ts).
// Non ridefinire qui tipi dominio duplicati.

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

// ─── Navigazione ──────────────────────────────────────────────────────────────
export interface NavItem {
  path: string
  icon: ComponentType<{ className?: string }>
  label: string
}
