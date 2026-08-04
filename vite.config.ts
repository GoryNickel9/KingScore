import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/bgg-api': {
        target: 'https://boardgamegeek.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/bgg-api/, '/xmlapi2'),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/xml, text/xml, */*',
        },
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('recharts')) return 'recharts'
            if (id.includes('fast-xml-parser')) return 'xml-parser'
            if (id.includes('@supabase/supabase-js')) return 'supabase'
          }
        }
      }
    }
  }
})