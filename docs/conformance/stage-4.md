# Stage 4 conformance record — Design, architecture, and security gates

- **Status:** `IN_PROGRESS`
- **Last updated:** 2026-08-18
- **Requirements in scope:** `STG-005`, `POL-001`, `EVD-002`, `GOV-002`

## Delivery order

1. Retain a typed, versioned design package: architecture decision, interface/schema delta, migration plan, threat model, dependency/license impact, and test strategy.
2. Calculate one canonical design digest across all artifacts.
3. Bind an independent design review decision to that digest and invalidate it when the package changes.
4. Apply separation of duty and bounded exception expiry before the Change Case can enter the execution-ready state.
5. Present residual risk, exceptions, and the single safe next action in a reviewer workbench.
6. Retain local and hosted-CI evidence before declaring the gate complete.

## Acceptance matrix

| ID | Requirement | Required proof | Status |
| --- | --- | --- | --- |
| STG4-001 | Required design artifacts are complete and retained as a versioned package. | Design-package contract and PostgreSQL/API test. | In progress |
| STG4-002 | R2+ cases cannot advance without a valid design package and review decision. | Policy-gate API test. | In progress |
| STG4-003 | Required reviewer role and separation of duty are enforced. | Reviewer-role and self-approval negative tests. | In progress |
| STG4-004 | An expired exception blocks dependent approval/advance actions. | Expiry test with stable error. | In progress |
| STG4-005 | Material design changes invalidate approvals bound to the prior digest. | Stale-approval test. | In progress |
| STG4-006 | Reviewer UX explains the design, residual risk, exceptions, and safe next action. | Authenticated browser deep-link test. | In progress |
