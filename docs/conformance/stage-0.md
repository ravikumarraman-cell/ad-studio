# Stage 0 conformance record — architecture lock and development harness

- **Status:** `IN_PROGRESS`
- **Owner:** ADX implementation team
- **Specification:** [ADX TanStack Implementation Specification](../../ADX_TanStack_Implementation_Specification_10_10.md), Stage 0
- **Last updated:** 2026-08-18

## Requirement traceability

| ID | Requirement | Proof | Status |
| --- | --- | --- | --- |
| STG0-001 | Workspace separates applications from reusable packages. | Root `package.json` workspace declaration; `npm run verify:stage0`. | Verified |
| STG0-002 | Domain vocabulary is provider-neutral and strict. | `packages/domain/src/change-case.ts`; `npm run typecheck:domain`. | Verified |
| STG0-003 | Commands are closed, typed, risk-classified, and idempotent. | `change-case.create.schema.json`; `npm run verify:stage0`. | Verified |
| STG0-004 | Dependency retrieval uses the corporate registry with TLS validation. | `.npmrc`; `npm run verify:stage0`. | Verified |
| STG0-005 | Framework choice is explicitly governed. | [ADR-002](../adr/ADR-002-framework-adoption.md). | Pending compatibility canary |
| STG0-006 | Event/reconciliation and execution-boundary decisions are documented before implementation. | [ADR-004](../adr/ADR-004-event-reconciliation.md), [ADR-006](../adr/ADR-006-execution-substrate.md). | Verified |
| STG0-007 | CI-ready typecheck, build, and structural verification commands exist. | `npm run typecheck`, `npm run build`, `npm run verify:stage0`. | Verified |
| STG0-008 | Browser shell, backend health, OpenTelemetry, object-store and database emulator evidence are available. | Stage 0 acceptance suite. | Not started |

## Commands and evidence

```bash
npm run verify:stage0
npm run typecheck:domain
npm run typecheck
npm run build
```

Successful command output is the evidence artifact for STG0-001, STG0-002, STG0-003, and STG0-007. The health-insurance demo remains a demonstrator; it is not evidence for identity, persistence, or release controls.

## Exit decision

**Do not exit Stage 0.** The TanStack Start compatibility canary, browser smoke test, backend health checks, trace correlation, and local PostgreSQL/object-store emulator are still required. This record will be updated only when each missing proof exists and is reproducible from a clean checkout.
