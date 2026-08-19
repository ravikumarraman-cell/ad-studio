# ADX implementation status

- **Last updated:** 2026-08-18
- **Source of truth:** [ADX implementation specification](../ADX_TanStack_Implementation_Specification_10_10.md)
- **Current delivery position:** Stages 0, 1, 2, and 3 are **complete**. The feature-delivery UI is a verified local vertical-slice demonstration; it is not evidence of a completed ADX control plane.

## Stage dashboard

| Stage | Status | What is available | Exit condition still required |
| --- | --- | --- | --- |
| 0 — Architecture lock and harness | `COMPLETE` | Workspace structure, strict domain vocabulary, import contract, ADRs, Node 22.19/TanStack Start client–SSR–server runtime canary, health/readiness API, trace-correlation smoke, healthy PostgreSQL/MinIO emulators, passing Chromium user-path smoke, and a green hosted CI gate. | — |
| 1 — Identity, tenancy, authorization | `COMPLETE` | Google OIDC/JWKS + PKCE adapter, HttpOnly sessions, PostgreSQL membership/resource schema with RLS, deny-by-default RBAC+ABAC, tenant-scoped API boundary, cross-tenant attack suite, unauthenticated-route browser test, green hosted CI, and a successful live Google callback. An unprovisioned identity receives no workspace memberships; the development-only `npm run provision:local-user -- <principal-id>` command explicitly grants a local workspace membership. | — |
| 2 — Change Case and event ledger | `COMPLETE` | Verified Stage 2 PostgreSQL schema foundation (tenant-scoped Change Case projection, append-only ledger, idempotency, outbox/inbox, checkpoints, RLS), signed-ledger core (Ed25519 attestation, hash chain, Merkle checkpoint, replay, and tamper detection), transactional repository (atomic projection/event/idempotency/outbox commit, duplicate-command response, stale-write conflict), tenant-authorized API list/detail/timeline and command routes, durable inbox deduplication/ordering, reordered-observation convergence, timeout-to-reconciliation behavior, persisted signed-checkpoint integrity replay, a configured non-test local signer, and browser deep-link refresh proof. All repository SQL also applies explicit organization/workspace predicates in addition to RLS. The complete suite passed in [GitHub Actions run 32182153245](https://github.com/ravikumarraman-cell/ad-studio/actions/runs/32182153245). | — |
| 3 — Intake, risk, and stories | `COMPLETE` | Tenant-scoped durable source-retained intent, ambiguity register, explainable asset-driven risk classification, versioned BDD story graph, independent digest-bound approval, invalidation on story revision, ledger-attested commands, authoritative governance projection, direct route-isolation coverage, and an authenticated Story Review page with risk explanation, BDD contract, approval history, and browser deep-link proof. The complete suite passed in [GitHub Actions job 95913507852](https://github.com/ravikumarraman-cell/ad-studio/actions/runs/32200635020/job/95913507852). | — |
| 4 — Design and security gates | `COMPLETE` | Tenant-scoped, versioned design package; digest-bound independent approval; exception expiry; R2+ direct-transition gate; design-review workbench; and local/hosted verification evidence. The complete suite passed in [GitHub Actions job 95922195235](https://github.com/ravikumarraman-cell/ad-studio/actions/runs/32203565272/job/95922195235). | — |
| 5 — Leased execution and sandbox | `COMPLETE` | Provider-neutral adapter declaration; signed, capability-intersected lease; tenant-scoped PostgreSQL lease/run/revocation records; append-only run events; immutable receipt storage; lease-aware gateway controls; exact egress allowlists with DNS-rebinding and private-IPv6 denial; gateway-only secret grants; and a hardened Docker runtime with retained gateway-to-runtime dispatch receipts. A live lease revocation cancels an active dispatch; output exhaustion and aggregate writable-workspace growth produce `AgentRunQuotaExceeded.v1` evidence. Docker dispatches use disposable copy-on-write worktrees, retain only manifest-digested artifacts, and leave source worktrees unchanged. The trusted runtime terminates a container once its signed aggregate workspace cap is exceeded. The adversarial proof denies policy, symlink/hard-link/mount/archive, metadata/proxy/socket, hook, host-secret, aggregate-disk, PID-burst, output, and wall-clock escapes. Hosted CI passed in [GitHub Actions job 95934288996](https://github.com/ravikumarraman-cell/ad-studio/actions/runs/32207797649/job/95934288996). | — |
| 6 — Independent evidence | `COMPLETE` | Fresh digest-pinned read-only verifier environment; signed, provenance-complete evidence bundles; immutable tenant-scoped artifact bindings; pinned build/test/static/security/SBOM adapter catalog; content-addressed MinIO object storage; a reviewer evidence surface distinct from implementer activity; and a digest-bound Gate D that requires a passing independent bundle before delivery readiness. | — |
| 7 — Git/CI and pull requests | `COMPLETE` | Preview-only, provider-neutral Git delivery contract with registered repository/base-ref boundaries; immutable idempotent preview plans; exact-commit CI/review ingestion; convergence reconciliation; a tenant-authorized Delivery Review surface; and commit-bound approval invalidation on newer previews. No remote provider mutation, merge, or release is enabled. | — |
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

The active interaction, accessibility, measurement, and staged-delivery standard is the [ADX UX operating model](adx-ux-operating-model.md). It is deliberately a delivery gate: a visually polished screen is not sufficient without task-completion, comprehension, accessibility, and trust-calibration evidence.

| Measure | Target | Evidence |
| --- | --- | --- |
| First-action clarity | A new user can identify the next safe action without training. | Moderated usability task and first-click success rate. |
| Cognitive load | The primary screen shows one decision and one dominant next action at a time. | UX review plus task-completion feedback. |
| Feature intake | A user can import, correct, and create a Change Case from a feature file without data loss. | Import/review acceptance test. |
| Status comprehension | A user can explain the current stage, why it is there, and what is blocking it. | Comprehension test. |
| Accessibility | Keyboard, focus, contrast, semantic labels, and responsive layouts meet WCAG 2.2 AA. | Automated scan plus manual keyboard test. |
| Safety clarity | No UI implies that a policy gate, agent action, or release has happened when it has not. | Negative-path acceptance tests. |

The next UX work is to validate the feature-import workflow with users, add persistence and identity only when Stage 1/2 contracts are ready, and retain the single-next-action interaction model as complexity grows.
