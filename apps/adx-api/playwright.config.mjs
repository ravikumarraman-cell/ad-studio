import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://127.0.0.1:3104' },
  webServer: { command: 'PORT=3104 node server.mjs', url: 'http://127.0.0.1:3104/healthz', reuseExistingServer: false },
})
