import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 4173, host: '127.0.0.1', proxy: { '/v1': 'http://127.0.0.1:3100', '/auth': 'http://127.0.0.1:3100', '/control-plane': 'http://127.0.0.1:3100' } },
})
