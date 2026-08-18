import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { loadLocalEnv } from './load-local-env.mjs'

await loadLocalEnv()
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED_FOR_STAGE2_MIGRATION')
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
try {
  for (const migration of ['apps/adx-api/db/001_tenant_rls.sql', 'apps/adx-api/db/002_change_case_ledger.sql']) await pool.query(await readFile(migration, 'utf8'))
  console.log('Stage 2 database migrations applied.')
} finally { await pool.end() }
