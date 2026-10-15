/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ATOMIC_PLAY_WRITES?: string
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
