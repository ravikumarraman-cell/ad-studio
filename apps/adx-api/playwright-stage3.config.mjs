import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: './tests', testMatch: 'story-review-route.spec.mjs', timeout: 30_000, use: { baseURL: 'http://127.0.0.1:3109' }, webServer: { command: 'PORT=3109 ADX_TEST_AUTH=1 node ../../scripts/run-adx-api-stage2.mjs', port: 3109, reuseExistingServer: false } })
