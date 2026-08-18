# ADX implementation status

- **Last updated:** 2026-08-18
- **Source of truth:** [ADX implementation specification](../ADX_TanStack_Implementation_Specification_10_10.md)
- **Current delivery position:** Stage 0 is **in progress**. The feature-delivery UI is a verified local vertical-slice demonstration; it is not evidence of a completed ADX control plane.

## Stage dashboard

| Stage | Status | What is available | Exit condition still required |
| --- | --- | --- | --- |
| 0 — Architecture lock and harness | `IN_PROGRESS` | Workspace structure, strict domain vocabulary, import contract, ADRs, local React/TanStack demo, type/build/structural checks. | TanStack Start compatibility canary, browser smoke suite, backend health checks, trace correlation, PostgreSQL/object-store emulators. |
| 1 — Identity, tenancy, authorization | `NOT_STARTED` | — | Authenticated users, tenant isolation, RBAC/ABAC verification. |
| 2 — Change Case and event ledger | `NOT_STARTED` | UI-only Change Case demonstration. | Durable Change Case service, event/outbox/inbox, replay and reconciliation proof. |
| 3 — Intake, risk, and stories | `NOT_STARTED` | CSV feature-backlog demo and risk-tier fields. | Durable validated imports, source retention, classification and approval gates. |
| 4 — Design and security gates | `NOT_STARTED` | — | Policy-backed design/security reviews. |
| 5 — Leased execution and sandbox | `NOT_STARTED` | — | Runtime-enforced coding-agent leases and sandbox controls. |
| 6 — Independent evidence | `NOT_STARTED` | UI evidence log only. | Reproducible independent verification and signed evidence bundle. |
| 7 — Git/CI and pull requests | `NOT_STARTED` | — | Reconciled provider integration and PR lifecycle. |
| 8 — Controlled release | `NOT_STARTED` | — | Canary, rollback, telemetry, and game-day proof. |
| 9 — Outcome learning | `NOT_STARTED` | UI outcome step only. | Durable outcomes, baseline comparison, and learning loop. |
| 10 — Context graph and specialist agents | `NOT_STARTED` | — | ACL-aware context graph and provider-neutral agent roles. |

## Available UI

The local UI is available from `apps/health-authorization-demo` with `npm run dev`.

It currently lets a user:

1. start with three fictional health-insurance features or import a compatible CSV;
2. choose one feature and see its owner, repository, acceptance criteria, and risk tier;
3. move it through the visible demonstration sequence: Change Case → scope → design → execution → verification → release → outcome;
4. see an in-memory trace entry after each action.

It deliberately does **not** claim to authorize an agent, make a health-insurance determination, persist a record, execute code, create a pull request, or release software.

## UX acceptance bar

“Best UX” must be demonstrated, not asserted. The UI will be accepted only when it satisfies all of these measures:

| Measure | Target | Evidence |
| --- | --- | --- |
| First-action clarity | A new user can identify the next safe action without training. | Moderated usability task and first-click success rate. |
| Cognitive load | The primary screen shows one decision and one dominant next action at a time. | UX review plus task-completion feedback. |
| Feature intake | A user can import, correct, and create a Change Case from a feature file without data loss. | Import/review acceptance test. |
| Status comprehension | A user can explain the current stage, why it is there, and what is blocking it. | Comprehension test. |
| Accessibility | Keyboard, focus, contrast, semantic labels, and responsive layouts meet WCAG 2.2 AA. | Automated scan plus manual keyboard test. |
| Safety clarity | No UI implies that a policy gate, agent action, or release has happened when it has not. | Negative-path acceptance tests. |

The next UX work is to validate the feature-import workflow with users, add persistence and identity only when Stage 1/2 contracts are ready, and retain the single-next-action interaction model as complexity grows.
