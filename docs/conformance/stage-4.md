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
| STG4-001 | Required design artifacts are complete and retained as a versioned package. | Canonical design-package contract and PostgreSQL/API capture/read-projection test. | Verified locally |
| STG4-002 | R2+ cases cannot advance without a valid design package and review decision. | Policy-gate API test, including direct transition bypass attempt. | Verified locally |
| STG4-003 | Required reviewer role and separation of duty are enforced. | Reviewer-role and author self-approval negative API tests. | Verified locally |
| STG4-004 | An expired exception blocks dependent approval/advance actions. | Expiry test with stable `DESIGN_EXCEPTION_EXPIRED` error. | Verified locally |
| STG4-005 | Material design changes invalidate approvals bound to the prior digest. | Stale-approval API test after execution-ready revision. | Verified locally |
| STG4-006 | Reviewer UX explains the design, residual risk, exceptions, and safe next action. | Authenticated browser deep-link and reload test. | Verified locally |

## Local evidence

- `npm run verify:stage4`
- `npm run migrate:stage2`
- `npm run verify:stage4:api`
- `npm --workspace=@adx/api run test:browser:stage4`

Hosted CI is configured to execute these same three Stage 4 checks in the `ADX conformance gates` workflow. A successful run containing those steps is required before the stage can be marked complete.
