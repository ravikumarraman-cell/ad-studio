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

1. configure a real OIDC issuer/client and cryptographically validate its JWTs against JWKS;
2. replace the reference in-memory session/resource stores with PostgreSQL repositories, immutable audit storage, tenant predicates, and verified row-level security;
3. add permission-aware authenticated UI state and login/logout/role-change audit evidence;
4. rerun the full suite and obtain a green hosted CI run for the Stage 1 commit.

The stalled public-registry install of the PostgreSQL and JOSE dependencies was stopped on 2026-08-18 without changing the lockfile. No unverified persistence or OIDC behavior is represented as complete.
