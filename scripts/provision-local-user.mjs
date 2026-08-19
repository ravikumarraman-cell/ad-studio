import pg from 'pg'
import { loadLocalEnv } from './load-local-env.mjs'

await loadLocalEnv(new URL('../.env.local', import.meta.url))
if (process.env.NODE_ENV === 'production') throw new Error('LOCAL_USER_PROVISIONING_DENIED_IN_PRODUCTION')
const principalId = process.argv[2]
const organizationId = process.env.ADX_BOOTSTRAP_ORGANIZATION_ID ?? '11111111-1111-4111-8111-111111111111'
const workspaceId = process.env.ADX_BOOTSTRAP_WORKSPACE_ID ?? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
if (typeof principalId !== 'string' || !principalId.startsWith('oidc:https://accounts.google.com:')) throw new Error('GOOGLE_OIDC_PRINCIPAL_ID_REQUIRED')
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED_FOR_LOCAL_USER_PROVISIONING')
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
try {
  const result = await pool.query("INSERT INTO adx_workspace_membership (organization_id,workspace_id,principal_id,roles,version) VALUES ($1,$2,$3,$4,1) ON CONFLICT (workspace_id,principal_id) DO UPDATE SET organization_id=EXCLUDED.organization_id,roles=EXCLUDED.roles,version=adx_workspace_membership.version+1,revoked_at=NULL,expires_at=NULL RETURNING organization_id AS \"organizationId\",workspace_id AS \"workspaceId\",principal_id AS \"principalId\",roles,version", [organizationId, workspaceId, principalId, ['workspace_admin']])
  console.log(JSON.stringify({ provisioned: true, membership: result.rows[0], next: 'Sign out and complete /auth/login again to receive a session with this membership.' }))
} finally { await pool.end() }
