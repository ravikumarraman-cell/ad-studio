# Stage 8 conformance record — Controlled release and progressive delivery

- **Status:** `IN_PROGRESS`
- **Last updated:** 2026-08-19
- **Requirements in scope:** `STG-009`, `REL-001`, `REL-002`

## Delivery order

1. Define and verify the immutable release-candidate provenance predicate.
2. Persist tenant-scoped candidates and release decisions.
3. Add non-production environment, flag, rollout, and metrics adapters.
4. Add pause/resume/rollback control workflows and reconciliation.
5. Prove the full controlled-release game-day suite.

## Acceptance matrix

| ID | Requirement | Required proof | Status |
| --- | --- | --- | --- |
| STG8-001 | A release candidate is control-plane-only and binds exactly to preview, evidence, approval, artifact, and policy provenance. | Release candidate contract suite. | Verified locally |
| STG8-002 | Candidates and release decisions are immutable and tenant-scoped. | PostgreSQL suite. | Verified locally |
| STG8-003 | Environment, flag, rollout, metrics, pause, resume, rollback, and reconciliation are explicitly provider-bound. | Simulation adapter and reconciliation suite. | Verified locally |
| STG8-004 | Release authorization requires complete provenance, required evidence, policy authorization, and valid approval. | Gate E PostgreSQL suite. | Verified locally |
| STG8-005 | Controlled-release failure modes pause, roll back, deny, or reconcile safely. | Twelve-scenario game-day suite. | Verified locally |
| STG8-006 | A real integration profile is explicit, non-production-only, secret-backed, and deny-by-default. | Configuration contract suite and runbook. | Verified locally |
