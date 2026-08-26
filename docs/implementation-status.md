# ADX implementation status

- **Last updated:** 2026-08-19
- **Source of truth:** [ADX implementation specification](../ADX_TanStack_Implementation_Specification_10_10.md)
- **Workflow guide:** [ADX main flow](adx-main-flow.md)
- **Coding-agent integration guide:** [Connecting coding agents to ADX](coding-agent-integration.md)
- **Current delivery position:** The React client is an authenticated shell for the real ADX API. It imports reviewed feature CSVs, creates durable Change Cases, renders the Gate A → A.5 → B–F workflow, and links to authoritative intake, story, design, evidence, delivery, and outcome routes. It does not itself prove agent execution, external Git/CI mutation, or release activity.

## Stage dashboard

| Stage | Status | What is available | Exit condition still required |
| --- | --- | --- | --- |
| 0 — Architecture lock and harness | `COMPLETE` | Workspace structure, strict domain vocabulary, import contract, ADRs, Node 22.19/TanStack Start client–SSR–server runtime canary, health/readiness API, trace-correlation smoke, healthy PostgreSQL/MinIO emulators, passing Chromium user-path smoke, and a green hosted CI gate. | — |
| 1 — Identity, tenancy, authorization | `COMPLETE` | Google OIDC/JWKS + PKCE adapter, HttpOnly sessions, PostgreSQL membership/resource schema with RLS, deny-by-default RBAC+ABAC, tenant-scoped API boundary, cross-tenant attack suite, unauthenticated-route browser test, green hosted CI, and a successful live Google callback. An unprovisioned identity receives no workspace memberships; the development-only `npm run provision:local-user -- <principal-id>` command explicitly grants a local workspace membership. | — |
| 2 — Change Case and event ledger | `COMPLETE` | Verified Stage 2 PostgreSQL schema foundation (tenant-scoped Change Case projection, append-only ledger, idempotency, outbox/inbox, checkpoints, RLS), signed-ledger core (Ed25519 attestation, hash chain, Merkle checkpoint, replay, and tamper detection), transactional repository (atomic projection/event/idempotency/outbox commit, duplicate-command response, stale-write conflict), tenant-authorized API list/detail/timeline and command routes, durable inbox deduplication/ordering, reordered-observation convergence, timeout-to-reconciliation behavior, persisted signed-checkpoint integrity replay, a configured non-test local signer, and browser deep-link refresh proof. All repository SQL also applies explicit organization/workspace predicates in addition to RLS. The complete suite passed in [GitHub Actions run 32182153245](https://github.com/ravikumarraman-cell/ad-studio/actions/runs/32182153245). | — |
| 3 — Intake, risk, and stories | `COMPLETE` | Tenant-scoped durable source-retained intent, ambiguity register, explainable asset-driven risk classification, versioned BDD story graph, independent digest-bound approval, invalidation on story revision, ledger-attested commands, authoritative governance projection, direct route-isolation coverage, and authenticated Intake, Story Generation & Curation, and Story Review pages. Gate A.5 supports manual multi-story drafting and optional server-side AI previews; selected suggestions remain editable and are not retained until submitted through the versioned Story API. The complete suite passed in [GitHub Actions job 95913507852](https://github.com/ravikumarraman-cell/ad-studio/actions/runs/32200635020/job/95913507852). | — |
| 4 — Design and security gates | `COMPLETE` | Tenant-scoped, versioned design package; digest-bound independent approval; exception expiry; R2+ direct-transition gate; design-review workbench; and local/hosted verification evidence. The complete suite passed in [GitHub Actions job 95922195235](https://github.com/ravikumarraman-cell/ad-studio/actions/runs/32203565272/job/95922195235). | — |
| 5 — Leased execution and sandbox | `COMPLETE` | Provider-neutral adapter declaration; signed, capability-intersected lease; tenant-scoped PostgreSQL lease/run/revocation records; append-only run events; immutable receipt storage; lease-aware gateway controls; exact egress allowlists with DNS-rebinding and private-IPv6 denial; gateway-only secret grants; and a hardened Docker runtime with retained gateway-to-runtime dispatch receipts. A live lease revocation cancels an active dispatch; output exhaustion and aggregate writable-workspace growth produce `AgentRunQuotaExceeded.v1` evidence. Docker dispatches use disposable copy-on-write worktrees, retain only manifest-digested artifacts, and leave source worktrees unchanged. The trusted runtime terminates a container once its signed aggregate workspace cap is exceeded. The adversarial proof denies policy, symlink/hard-link/mount/archive, metadata/proxy/socket, hook, host-secret, aggregate-disk, PID-burst, output, and wall-clock escapes. Hosted CI passed in [GitHub Actions job 95934288996](https://github.com/ravikumarraman-cell/ad-studio/actions/runs/32207797649/job/95934288996). | — |
| 6 — Independent evidence | `COMPLETE` | Fresh digest-pinned read-only verifier environment; signed, provenance-complete evidence bundles; immutable tenant-scoped artifact bindings; pinned build/test/static/security/SBOM adapter catalog; content-addressed MinIO object storage; a reviewer evidence surface distinct from implementer activity; and a digest-bound Gate D that requires a passing independent bundle before delivery readiness. | — |
| 7 — Git/CI and pull requests | `COMPLETE` | Preview-only, provider-neutral Git delivery contract with registered repository/base-ref boundaries; immutable idempotent preview plans; exact-commit CI/review ingestion; convergence reconciliation; a tenant-authorized Delivery Review surface; and commit-bound approval invalidation on newer previews. No remote provider mutation, merge, or release is enabled. | — |
| 8 — Controlled release | `IN_PROGRESS` | Control-plane-only release candidate contract with exact preview, evidence, approval, artifact, and policy provenance binding; immutable tenant-scoped candidate and release-decision persistence; simulation-only environment/flag/rollout/metrics adapters; Gate E authorization; pause/resume/rollback plus webhook reconciliation controls; a twelve-scenario game-day suite; and a deny-by-default, non-production integration profile/runbook. | Durable rollout/provider-event persistence, approved real non-production provider configuration, environment-specific game-day evidence, and explicit authorization to enable a provider executor. |
| 9 — Outcome learning | `LOCAL_CONTROL_PLANE_COMPLETE_PENDING_EXTERNAL_EVIDENCE` | Immutable tenant-scoped outcome records with success/failure taxonomy, incident/rollback links, human override labels, redacted versioned evaluation exports, frozen-baseline comparison, signed completion/outcome coupling, and authenticated Outcome Review reporting. | Real provider-backed release outcomes and operational evaluation evidence. |
| 10 — Context graph and specialist agents | `IN_PROGRESS` | Tenant-scoped, provenance-labelled untrusted context graph with freshness assessment; no-authority specialist role contracts; measured role-value selection gates; and declaration-only Codex CLI, Claude Code, and GitHub Copilot adapters that are lease-bound and fail closed before execution. | Durable context/evaluation persistence, independent review surface, credential-brokered provider executor, and non-production operational evidence. |

## Available UI

The authenticated backend control-plane index is available at `/control-plane` after `/auth/login`. It lists authorized Change Cases and links directly to the Story, Design, Evidence, Delivery, and Outcome review surfaces.

The local UI is available from `apps/adx-studio-web` with `npm run dev`. At startup, the user explicitly chooses **Real mode** (authenticated API-backed ADX data) or **Guided demo** (a local, fictional, non-writing walkthrough). It proxies `/v1`, `/auth`, and `/control-plane` to the local ADX API on port 3100, so start `npm run api:dev` first for Real mode. Set `ADX_UI_ORIGIN=http://127.0.0.1:4173/` in `.env.local` (the local default) so a successful OIDC callback returns to the React UI rather than the API JSON endpoint.

It currently lets an authenticated user:

1. select an authorized workspace and load its durable Change Cases from the API;
2. create a durable Change Case manually or import a validated CSV feature file through one server-side, retry-safe `PARTIAL_SUCCESS_RESUMABLE` command;
3. see the Gate A, A.5, B–F workflow map and the single current review link for each Change Case;
4. confirm intake and risk classification, then manually draft and curate multiple BDD stories in the authoritative Story Generation & Curation step;
5. optionally request server-side AI story previews when the server has been configured, select and edit them before submission; and
6. open the backend’s authoritative Story, Design, Evidence, Delivery, or Outcome review route.

The local Guided demo mirrors the same nine-stage user journey but writes no ADX data and authorizes nothing. Real mode deliberately does **not** claim to authorize an agent, execute code, create a pull request, merge code, or release software unless the underlying authoritative API has retained proof for that action. The coding-agent selectors are planning-only; all three provider adapters fail closed before live execution.

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

The next UX work is to validate the feature-import and story-curation workflow with users, measure first-action clarity and comprehension, and retain the single-next-action interaction model as real integrations are introduced. The next operational work is separate: configure and exercise an approved non-production provider environment before enabling any live coding-agent or release executor.
