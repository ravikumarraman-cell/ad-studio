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

Stage 1 remains open until the full Stage 1 suite, browser unauthorized-route coverage, and hosted CI run are green. The current API surface is an intentionally small reference boundary; Stage 2 will replace its in-memory resource store with tenant-predicated persistence and database RLS.
