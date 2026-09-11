import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(() => {
  const apiOrigin = process.env.ADX_API_ORIGIN || 'http://127.0.0.1:3100'

  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: process.env.HOST || 'localhost',
      proxy: { '/v1': apiOrigin, '/auth': apiOrigin, '/control-plane': apiOrigin },
    },
  }
})
