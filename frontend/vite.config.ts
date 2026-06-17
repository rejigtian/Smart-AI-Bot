import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind to 0.0.0.0 so a phone on the same LAN can reach the dev server by IP
    // (required for QR pairing — the QR encodes whatever host you browse with).
    host: true,
    proxy: {
      '/api': 'http://localhost:8000',
      '/v1': { target: 'ws://localhost:8000', ws: true },
    },
  },
})
