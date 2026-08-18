import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: 'change-case-route.spec.mjs',
  use: { baseURL: 'http://127.0.0.1:3107' },
  webServer: { command: 'PORT=3107 ADX_TEST_AUTH=1 node ../../scripts/run-adx-api-stage2.mjs', url: 'http://127.0.0.1:3107/healthz', reuseExistingServer: false },
})
