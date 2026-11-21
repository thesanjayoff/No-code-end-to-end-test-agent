import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // The production build is served by the same Express app that hosts
      // this API (src/server/index.ts), so /api works unproxied there. In
      // dev, Vite runs on its own port -- forward /api to it instead.
      '/api': 'http://localhost:4780',
    },
  },
})
