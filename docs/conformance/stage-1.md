# Stage 1 conformance record — identity, tenancy, and authorization

- **Status:** `IN_PROGRESS`
- **Last updated:** 2026-08-18

| ID | Requirement | Proof | Status |
| --- | --- | --- | --- |
| STG1-001 | Provider-neutral verified OIDC claim mapping and expiring server sessions. | `packages/identity/src/index.mjs`; `npm run verify:stage1`. | Verified locally |
| STG1-002 | Server-side workspace-scoped RBAC+ABAC with deny-by-default behavior. | `authorize`; role and policy assertions in `verify:stage1`. | Verified locally |
| STG1-003 | Tenant-scoped list, direct-resource, and mutation paths cannot cross workspaces. | HTTP integration assertions in `verify:stage1`. | Verified locally |
| STG1-004 | Search, cache, object-store, export, event, and webhook routes have negative-path tenant-leakage coverage. | `verify:stage1`. | Verified locally |
| STG1-005 | Authorization decisions have explainable immutable snapshots and cache invalidation. | `createAuthorizationSnapshot`, `AuthorizationDecisionCache`; `verify:stage1`. | Verified locally |
| STG1-006 | Browser navigation to a protected route fails closed without a session. | `npm --workspace=@adx/api run test:browser` passed on Chromium / 2026-08-18. | Verified locally |

## Exit gate

Stage 1 is **not complete**. The local policy, API-isolation, and unauthenticated-browser checks are green. The following exit work remains:

1. complete one real Google browser login through `/auth/login` and `/auth/callback`, then retain the resulting login/session audit evidence;
2. run the updated Stage 1 suite in hosted CI and retain the green workflow evidence.

The API now contains a configurable Google OIDC/JWKS adapter, PKCE callback flow, HttpOnly session issuance, PostgreSQL membership/resource repository, and database RLS schema. Local policy, tenant-isolation, browser-denial, RLS-schema, and API smoke evidence is complete; only the real provider interaction and hosted CI evidence remain.
