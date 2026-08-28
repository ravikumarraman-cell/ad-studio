import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: 'execution-handoff-route.spec.mjs',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:3112' },
  webServer: { command: 'PORT=3112 ADX_TEST_AUTH=1 node ../../scripts/run-adx-api-stage2.mjs', url: 'http://127.0.0.1:3112/healthz', reuseExistingServer: false },
})