import { loadLocalEnv } from './load-local-env.mjs'

await loadLocalEnv(new URL('../.env.local', import.meta.url))
await import('../apps/adx-api/server.mjs')
