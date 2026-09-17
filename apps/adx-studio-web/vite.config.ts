import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(() => {
  const apiOrigin = process.env.ADX_API_ORIGIN || 'http://127.0.0.1:3100'

  return {
    plugins: [react()],
    server: {
      // Reserve 5173 for the Cloud Asset Inventory preview: its SSO callback is
      // registered on that origin. ADX itself runs on the adjacent local port.
      port: 5174,
      host: process.env.HOST || 'localhost',
      proxy: { '/v1': apiOrigin, '/auth': apiOrigin, '/control-plane': apiOrigin },
    },
  }
})
