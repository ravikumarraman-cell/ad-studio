import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { loadLocalEnv } from './load-local-env.mjs'

await loadLocalEnv()
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED_FOR_STAGE2_MIGRATION')
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
try {
  for (const migration of ['apps/adx-api/db/001_tenant_rls.sql', 'apps/adx-api/db/002_change_case_ledger.sql', 'apps/adx-api/db/003_intake_governance.sql', 'apps/adx-api/db/004_design_governance.sql', 'apps/adx-api/db/005_execution_governance.sql', 'apps/adx-api/db/006_verification_evidence.sql', 'apps/adx-api/db/007_git_preview_delivery.sql', 'apps/adx-api/db/008_ci_review_preview.sql', 'apps/adx-api/db/009_git_preview_approval.sql', 'apps/adx-api/db/010_release_candidate.sql', 'apps/adx-api/db/011_outcome_record.sql', 'apps/adx-api/db/012_context_graph.sql', 'apps/adx-api/db/013_github_draft_pr_execution.sql', 'apps/adx-api/db/014_story_milestone_sync.sql']) await pool.query(await readFile(migration, 'utf8'))
  console.log('ADX database migrations through Stage 12 applied.')
} finally { await pool.end() }
