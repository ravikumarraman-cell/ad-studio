# ADX main flow — governed software delivery

## Purpose and scope

This document describes the **authoritative ADX workflow**: how a software change becomes a governed Change Case, accumulates evidence, becomes eligible for delivery, and eventually records an outcome.

ADX is a delivery control plane. It is not a general-purpose coding chatbot, and it never treats a model response, agent transcript, UI click, or provider request as proof that a governed action happened.

The unit of work is a **Change Case**. Every material action is scoped to an organization and workspace, authorized server-side, version checked, retained as signed ledger evidence where applicable, and linked to the exact digest of the artifact or decision under review.

## What is authoritative today

The backend control plane is the authoritative system of record. After authenticated sign-in, open:

```text
/control-plane
```

It lists Change Cases available to the signed-in user and links to their review surfaces.

The separate `apps/health-authorization-demo` UI is deliberately fictional and in-memory. It illustrates a feature-delivery experience; it does **not** create, advance, approve, execute, verify, release, or complete persisted ADX Change Cases.

## Main-flow overview

```text
Authenticated user
  → Workspace membership resolved
  → Create or select Change Case
  → Intake and risk classification
  → Story contract and independent story decision
  → Design/security package and independent design decision
  → Bounded execution under a signed lease
  → Independent verification and Gate D
  → Preview-only delivery review
  → Gate E release candidate and controlled rollout
  → Final outcome record and Gate F
  → Redacted evaluation and learning comparison
```

The arrows are not unconditional. A gate can pause, deny, invalidate, require reconciliation, or require a new revision. Later stages never repair or silently bypass a failed earlier gate.

## Actors and authority boundaries

| Actor | May do | Must not do |
| --- | --- | --- |
| Requester / owner | Create and clarify Change Cases; provide intent and sources. | Grant execution or release authority by narrative alone. |
| Reviewer | Make independently authorized, digest-bound decisions. | Approve their own authored artifact where separation of duty applies. |
| Implementer / agent | Work only under a signed, expiring execution lease. | Change policy, approve work, deploy, or access unrestricted context. |
| Independent verifier | Produce fresh, read-only verification evidence. | Modify the candidate being verified. |
| Release controller | Build and evaluate provenance-bound release candidates. | Treat a candidate as permission to deploy without Gate E and provider authority. |
| Operator | Pause, resume, or roll back only through controlled workflows. | Blindly retry an ambiguous external side effect. |
| Outcome/evaluation service | Retain outcomes and redacted evaluation exports. | Treat unreconciled activity as a completed outcome. |

## Identity, tenancy, and entry

1. The user visits `/auth/login`.
2. Google OIDC authorization-code + PKCE authentication completes at `/auth/callback`.
3. ADX resolves the principal’s PostgreSQL workspace memberships.
4. A session contains an authenticated principal and only the memberships currently granted to it.
5. Every workspace route checks membership and evaluates RBAC/ABAC server-side before reading or changing an object.

An authenticated person without a workspace membership can sign in but cannot access a workspace. An unprovisioned identity is not implicitly made an administrator.

## Change Case lifecycle

### States

```text
DRAFT
  → INTAKE
  → AWAITING_CLARIFICATION or RISK_REVIEW
  → AWAITING_STORY_APPROVAL
  → DESIGN_REVIEW
  → READY_FOR_EXECUTION
  → AWAITING_VERIFICATION
  → READY_FOR_DELIVERY
  → OUTCOME_RECORDED
```

`PAUSED` and `CANCELLED` are safety paths. A transition requires the expected projection version; stale writes are rejected rather than merged implicitly.

### Ledger behavior

Each material Change Case command creates a signed event with:

- aggregate ID and contiguous sequence number;
- actor, correlation ID, causation ID, and idempotency key;
- policy version;
- canonical payload digest and prior-event digest;
- event digest and signature key ID.

The projection is rebuildable from the ordered event chain. Duplicate commands return their prior accepted result when the idempotency key and request digest match. A reused idempotency key with different content is rejected.

## 1. Intake and risk — Gate A

The owner captures retained intent: outcome, owner, acceptance criteria, target repository, source material, and known ambiguity. ADX classifies risk from retained assets and explains the classification rather than only emitting a tier label.

The Story Review surface shows the retained intent, risk explanation, BDD story contract, source digests, and prior decisions.

**Exit condition:** an independently reviewable, digest-bound story contract is approved. Revising the story contract invalidates the previous approval.

## 2. Design and security — Gate B

The Design Review package contains versioned architecture decisions, interface/schema changes, migration plan, threat model, residual risk, dependencies/licenses, and test strategy.

For R2 and higher, a Change Case cannot enter `READY_FOR_EXECUTION` without the required independent design decision. Active exceptions have expiry; an expired exception blocks approval rather than being silently tolerated.

**Exit condition:** current design digest is independently approved and no blocking exception exists.

## 3. Bounded execution — Gate C

Execution authority is a signed lease, not a prompt. The lease intersects policy, role, tenant, repository, capability, budget, time, and network boundaries. The sandbox and gateway enforce those limits below the agent process.

Key properties:

- disposable copy-on-write worktree;
- exact egress allowlists and private-network denial;
- gateway-only secrets;
- bounded wall clock, processes, output, and writable workspace;
- retained manifest-digested artifacts and execution receipts;
- live revocation cancels active dispatch.

**Exit condition:** a candidate can be produced with retained execution provenance. Execution success is not verification success.

## 4. Independent verification — Gate D

An independent verifier creates a fresh, read-only environment pinned to the candidate digest. It retains a signed evidence bundle that records verifier identity/version, runtime/config/command digests, candidate digest, status, and artifact bindings.

The Evidence Review surface distinguishes verifier evidence from implementer activity. Gate D permits `READY_FOR_DELIVERY` only when a passing independent bundle matches the exact candidate digest.

## 5. Delivery preview and review — Stage 7

Git and CI work is preview-only today. ADX retains an immutable plan for a registered repository and base reference, deterministic preview branch/commit/PR digests, CI observations, review findings, and digest-bound review decisions.

The Delivery Review surface reports:

- the exact preview branch, commit, candidate, and evidence digests;
- retained CI states and structured findings;
- active or invalidated reviewer decisions.

No remote branch, pull request, merge, or release is created by the local Stage 7 implementation.

## 6. Controlled release — Gate E

Stage 8 creates an immutable release candidate binding:

- Change Case and preview plan;
- artifact, candidate, evidence, commit, and approval digests;
- applicable release policy version.

Gate E revalidates current preview, passing evidence, active approval, and independent release decision before returning authorization. The current adapters are simulation-only and explicitly declare no deploy capability.

The local safety flow supports progressive stages, telemetry analysis, pause, resume, compatible rollback, operator kill switch, webhook deduplication, delayed/reordered event convergence, and reconciliation-required outcomes. A real provider executor remains disabled until a named non-production environment, provider credentials, telemetry, feature flag, webhook, rollback target, and environment-specific game-day evidence are approved.

## 7. Outcome and learning — Gate F

An outcome record contains a success/failure taxonomy, summary, incident links, rollback link when applicable, human override label, and metrics. It is immutable and tenant-scoped.

Before a Change Case can move from `READY_FOR_DELIVERY` to `OUTCOME_RECORDED`, ADX requires a durable outcome record bound to that Change Case. The command produces a signed `ChangeCaseOutcomeRecorded.v1` ledger event.

The Outcome Review surface reports retained outcome history and counts. Evaluation exports redact sensitive-looking fields, freeze an evaluation version, and compare current results with a frozen baseline. A safety regression is detected when rollback rate worsens.

## 8. Context and specialist roles

Stage 10 treats context as untrusted data, never as authority. Context nodes are tenant-scoped and carry a content digest, provenance, labels, observation time, and freshness window. A node is explicitly `FRESH` or `STALE`.

Specialist roles declare allowed context kinds but no decision, approval, execution, or deployment authority. A role may be selected only when a measured comparison shows better outcome quality, lower cost, lower latency, or better evidence without safety, reproducibility, or approval-clarity regression.

## Review surfaces and navigation

| Surface | URL suffix | Purpose |
| --- | --- | --- |
| Control Plane | `/control-plane` | Lists authorized Change Cases and review links. |
| Story Review | `/story-review` | Intent, risk, stories, and story decisions. |
| Design Review | `/design-review` | Design package, exceptions, and design decisions. |
| Evidence Review | `/evidence-review` | Independent verifier bundles and artifacts. |
| Delivery Review | `/delivery-review` | Preview plan, CI, findings, and preview decisions. |
| Outcome Review | `/outcome-review` | Retained outcomes and completion context. |

Each suffix is applied to:

```text
/v1/workspaces/<workspace-id>/change-cases/<change-case-id>
```

## Failure handling principles

- Missing, stale, corrupted, or unverifiable evidence never becomes a pass.
- A changed digest invalidates decisions bound to the old digest.
- Duplicate external notifications are deduplicated by provider delivery identity.
- Delayed or reordered provider events converge through reconciliation.
- Ambiguous external outcomes enter reconciliation; they are never blindly retried.
- A failed rollout pauses or requires rollback according to the analysis contract.
- A completed Change Case cannot exist without retained outcome evidence.

## Current implementation boundary

Stages 0–7 are marked complete in the implementation dashboard. Stages 8–10 have complete local control-plane foundations, but their operational exit evidence remains pending:

- Stage 8 needs a real approved non-production provider integration and environment-specific game-day evidence.
- Stage 9 needs real provider-backed release outcomes and operational evaluation evidence.
- Stage 10 needs measured specialist-role value against real outcomes and independent review of that evidence.

This distinction is intentional. ADX does not claim that code, configuration, a UI, or a synthetic test is the same thing as real operational proof.
