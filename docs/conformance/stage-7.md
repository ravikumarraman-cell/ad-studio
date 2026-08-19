# Stage 7 conformance record — Git/CI integration and pull request lifecycle

- **Status:** `COMPLETE`
- **Last updated:** 2026-08-18
- **Requirements in scope:** `STG-008`

## Delivery order

1. Define a provider-neutral, preview-only Git delivery contract with registered repository and base-ref boundaries.
2. Persist preview branch, commit, and pull-request plans idempotently.
3. Add CI trigger/status and review-finding provider adapters bound to the exact commit digest.
4. Add branch-protection mapping, approval invalidation, reconciliation, and the review surface.

## Acceptance matrix

| ID | Requirement | Required proof | Status |
| --- | --- | --- | --- |
| STG7-001 | Git delivery is preview-only; repository and base ref are registered, and branch/commit/PR plans are deterministic. | Provider contract suite. | Verified locally |
| STG7-002 | Duplicate preview creation is prevented and candidate staleness is detected. | Preview registry suite. | Verified locally |
| STG7-003 | Preview plans are immutable, tenant-scoped, idempotently retained, and independently readable. | PostgreSQL/API suite. | Verified locally |
| STG7-004 | Preview CI triggers, CI statuses, and structured review findings are provider-neutral, idempotent, and bind to the exact preview commit. | Provider ingestion suite. | Verified locally |
| STG7-005 | CI reconciliation converges safely; approval is commit-bound and invalidates when a newer preview is retained. | Provider lifecycle suite. | Verified locally |
