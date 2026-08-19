import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: './tests', testMatch: 'design-review-route.spec.mjs', timeout: 30_000, use: { baseURL: 'http://127.0.0.1:3111' }, webServer: { command: 'PORT=3111 ADX_TEST_AUTH=1 node ../../scripts/run-adx-api-stage2.mjs', port: 3111, reuseExistingServer: false } })
