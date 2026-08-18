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
| STG0-005 | Framework choice is explicitly governed and the no-RSC framework canary builds client, SSR, and server routers. | [ADR-002](../adr/ADR-002-framework-adoption.md); `npm --workspace=@adx/tanstack-start-canary run build` and `npm run canary:smoke` with Node 22.19.0. | Verified |
| STG0-006 | Event/reconciliation and execution-boundary decisions are documented before implementation. | [ADR-004](../adr/ADR-004-event-reconciliation.md), [ADR-006](../adr/ADR-006-execution-substrate.md). | Verified |
| STG0-007 | CI-ready typecheck, build, and structural verification commands exist. | `npm run typecheck`, `npm run build`, `npm run verify:stage0`. | Verified |
| STG0-008 | Backend health/readiness and request trace correlation are available. | Self-contained `npm run api:smoke` verifies `/healthz`, `/readyz`, and `x-trace-id` propagation. | Verified |
| STG0-009 | Local PostgreSQL and object-store emulator definitions are reproducible. | `compose.yaml`; `docker compose up -d postgres minio`; both container health checks reported `healthy` on 2026-08-18. | Verified |
| STG0-010 | CI executes the deterministic Stage 0 checks, including a Chromium-rendered user-path smoke. | `.github/workflows/stage0.yml`; local `npm --workspace=adx-health-authorization-demo run test:browser` passed on Chromium 139 / 2026-08-18. | Locally verified; remote run pending |

## Commands and evidence

```bash
npm run verify:stage0
npm run typecheck:domain
npm run typecheck
npm run build
npm run canary:smoke
```

Successful command output is the evidence artifact for STG0-001, STG0-002, STG0-003, and STG0-007. The health-insurance demo remains a demonstrator; it is not evidence for identity, persistence, or release controls.

## Exit decision

**Do not exit Stage 0 yet.** The framework canary, backend health/trace smoke, emulator runtime health, and local Chromium browser smoke are verified. The CI workflow needs its first hosted run. This record will be updated only when each missing proof exists and is reproducible from a clean checkout.
