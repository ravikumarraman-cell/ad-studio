# Stage 2 conformance record — Change Case and event ledger

- **Status:** `COMPLETE`
- **Last updated:** 2026-08-18
- **Requirements in scope:** `DOM-001`, `DOM-002`, `API-001`, `RES-001`, `OBS-001`

## Delivery order

1. Define the Change Case command, state-machine, event-envelope, integrity, and error contracts.
2. Persist the current projection, append-only event ledger, idempotency result, and outbox message in one PostgreSQL transaction.
3. Expose tenant-authorized command and query routes, including optimistic concurrency and stable correlation identifiers.
4. Add a provider inbox and reconciliation queue. A timeout or ambiguous side effect must enter reconciliation; it must never cause a blind retry.
5. Verify duplicate commands, stale writes, ordered events, projection replay, tamper detection, checkpoint inclusion, and duplicate/delayed/reordered provider signals.
6. Publish the independent, reproducible evidence bundle before changing this document to `COMPLETE`.

## Acceptance matrix

| ID | Requirement | Required proof | Status |
| --- | --- | --- | --- |
| STG2-001 | A Change Case is created and edited only through typed, authorized commands. | `npm run verify:stage2:api` server-side authorization, command validation, and state-machine path. | Verified locally and in hosted CI |
| STG2-002 | A transition checks expected version and commits the projection, append-only event, idempotency record, and outbox message atomically. | `npm run verify:stage2:postgres`. | Verified locally and in hosted CI |
| STG2-003 | A duplicate command returns its original outcome and creates no extra case/event/outbox record. | `npm run verify:stage2:postgres`. | Verified locally and in hosted CI |
| STG2-004 | An outdated expected version fails with a stable conflict response. | `npm run verify:stage2` and `npm run verify:stage2:postgres`. | Verified locally and in hosted CI |
| STG2-005 | The current Change Case projection can be rebuilt exactly from ordered events. | Projection-rebuild test. | Verified in `npm run verify:stage2` and hosted CI |
| STG2-006 | Event tampering, sequence removal, hash-chain breakage, altered evidence, invalid signature, and absent checkpoint inclusion are detected. | `npm run verify:stage2` pure integrity attack suite and `npm run verify:stage2:postgres` retained signed-checkpoint/replay verification. | Verified locally and in hosted CI |
| STG2-007 | Provider messages are deduplicated in an inbox; duplicates, delays, and reordering converge to one projection. | `npm run verify:stage2:postgres` durable inbox-deduplication, chronological observation ordering, and repeated reconciliation convergence test. | Verified locally and in hosted CI |
| STG2-008 | A provider timeout enters reconciliation and does not issue a duplicate external request. | `npm run verify:stage2:postgres` durable outbox timeout → `RECONCILIATION_REQUIRED` path. | Verified locally and in hosted CI |
| STG2-009 | List/detail/timeline read projections are tenant-scoped and return authoritative server state. | `npm run verify:stage2:api` list/detail/timeline paths and direct cross-tenant object-reference attack; `npm --workspace=@adx/api run test:browser:stage2` deep-link reload proof. | Verified locally and in hosted CI |

## Completion evidence

The complete Stage 2 suite, including PostgreSQL migration, integrity, API, and browser checks, passed in [GitHub Actions run 32182153245](https://github.com/ravikumarraman-cell/ad-studio/actions/runs/32182153245) on 2026-08-18.

## Completion rule

Stage 2 is complete only when an independent auditor can verify one retained Change Case lifecycle from the event sequence, recompute its hash chain and checkpoint inclusion, verify its attestations, and replay its projection without trusting a mutable UI or current-state table.
