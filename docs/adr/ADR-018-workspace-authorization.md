# ADR-018: Workspace authorization, ABAC, and row-level isolation model

- **Status:** Accepted — Stage 1 reference implementation
- **Decision:** ADX evaluates authorization server-side for every read and command. It combines workspace-scoped RBAC with resource attributes and relationships, denies by default, and records an immutable decision snapshot.

Tenant-owned persistence must include immutable `organization_id` and `workspace_id`, apply those predicates unconditionally, and enable database row-level security where the selected database supports it. A caller-provided workspace ID is an authorization input, never trusted routing data. The Stage 1 in-memory store models this invariant; Stage 2 persistence must preserve it at the database layer.

OIDC providers are adapter-specific. Only cryptographically verified claims are accepted by `mapVerifiedOidcClaims`; a browser request cannot supply claims directly. Test-only sessions are compiled as a runtime switch (`ADX_TEST_AUTH=1`) and are unavailable by default.

Authorization cache keys contain the policy version, principal, workspace, resource/version, action, and membership version. Workspace membership changes invalidate the workspace cache namespace.
