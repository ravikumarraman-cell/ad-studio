# Stage 1 conformance record — identity, tenancy, and authorization

- **Status:** `COMPLETE`
- **Last updated:** 2026-08-18

| ID | Requirement | Proof | Status |
| --- | --- | --- | --- |
| STG1-001 | Provider-neutral verified OIDC claim mapping and expiring server sessions. | `packages/identity/src/index.mjs`; `npm run verify:stage1`. | Verified locally |
| STG1-002 | Server-side workspace-scoped RBAC+ABAC with deny-by-default behavior. | `authorize`; role and policy assertions in `verify:stage1`. | Verified locally |
| STG1-003 | Tenant-scoped list, direct-resource, and mutation paths cannot cross workspaces. | HTTP integration assertions in `verify:stage1`. | Verified locally |
| STG1-004 | Search, cache, object-store, export, event, and webhook routes have negative-path tenant-leakage coverage. | `verify:stage1`. | Verified locally |
| STG1-005 | Authorization decisions have explainable immutable snapshots and cache invalidation. | `createAuthorizationSnapshot`, `AuthorizationDecisionCache`; `verify:stage1`. | Verified locally |
| STG1-006 | Browser navigation to a protected route fails closed without a session. | `npm --workspace=@adx/api run test:browser` passed on Chromium / 2026-08-18. | Verified locally |
| STG1-007 | The Stage 1 suite runs successfully in hosted CI. | [GitHub Actions run 32177251095](https://github.com/ravikumarraman-cell/ad-studio/actions/runs/32177251095/job/95841912506), reported successful on 2026-08-18. | Verified hosted |
| STG1-008 | A real Google OIDC authorization-code + PKCE callback creates an authenticated ADX session. | Live `/auth/login` → Google consent → `/auth/callback` → `/v1/me` round trip on 2026-08-18. The response returned an authenticated principal and no workspace memberships; no token, cookie, or identity value was retained in this record. | Verified live |

## Exit gate

**Exit approved.** Stage 1 has reproducible local policy, API-isolation, API smoke, unauthenticated-browser, hosted-CI, and live Google OIDC callback evidence. Stage 2 may begin.

The live identity is deliberately not a member of a workspace yet. An empty membership list is the expected deny-by-default state: authentication does not create tenant access. A future workspace-provisioning path must use an authorized administrator and retain its own auditable evidence.

The API contains a configurable Google OIDC/JWKS adapter, PKCE callback flow, HttpOnly session issuance, PostgreSQL membership/resource repository, and database RLS schema. Local policy, tenant-isolation, browser-denial, RLS-schema, API smoke, hosted CI, and real-provider evidence are complete.
