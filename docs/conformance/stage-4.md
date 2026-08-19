# Stage 4 conformance record — Design, architecture, and security gates

- **Status:** `COMPLETE`
- **Last updated:** 2026-08-19
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
| STG4-001 | Required design artifacts are complete and retained as a versioned package. | Canonical design-package contract and PostgreSQL/API capture/read-projection test. | Verified locally and in hosted CI |
| STG4-002 | R2+ cases cannot advance without a valid design package and review decision. | Policy-gate API test, including direct transition bypass attempt. | Verified locally and in hosted CI |
| STG4-003 | Required reviewer role and separation of duty are enforced. | Reviewer-role and author self-approval negative API tests. | Verified locally and in hosted CI |
| STG4-004 | An expired exception blocks dependent approval/advance actions. | Expiry test with stable `DESIGN_EXCEPTION_EXPIRED` error. | Verified locally and in hosted CI |
| STG4-005 | Material design changes invalidate approvals bound to the prior digest. | Stale-approval API test after execution-ready revision. | Verified locally and in hosted CI |
| STG4-006 | Reviewer UX explains the design, residual risk, exceptions, and safe next action. | Authenticated browser deep-link and reload test. | Verified locally and in hosted CI |

## Local evidence

- `npm run verify:stage4`
- `npm run migrate:stage2`
- `npm run verify:stage4:api`
- `npm --workspace=@adx/api run test:browser:stage4`

## Hosted-CI evidence

The [`ADX conformance gates` job 95922195235](https://github.com/ravikumarraman-cell/ad-studio/actions/runs/32203565272/job/95922195235) passed on commit `38bd748c34826351e55471193e39bf9a19534e8b`. It executed and passed all required Stage 4 commands: the contract test, PostgreSQL/API gate, and authenticated Stage 4 browser test.
