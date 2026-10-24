import { defineConfig } from 'vitest/config'

// Solo unit test su codice puro (nessun DOM/Supabase): nessun plugin React necessario.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
    environment: 'node',
  },
})
