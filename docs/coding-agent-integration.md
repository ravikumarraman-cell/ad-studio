# Connecting coding agents to ADX

## Purpose

This guide describes how ADX runs coding agents such as Codex CLI, Claude Code, GitHub Copilot CLI, or a custom agent without giving those agents independent authority. The repository now includes an opt-in local execution pilot; it is not a production credential-brokered provider integration.

ADX is the control plane. A coding agent is a replaceable worker in the execution plane. The agent may propose and make bounded repository changes; it cannot approve itself, widen its permissions, treat its own output as evidence, merge code, or deploy software.

## Current position

Stage 5 provides the execution foundation: signed expiring leases, tenant-scoped run records, a hardened disposable sandbox, gateway-enforced filesystem/network/secret controls, immutable receipts, and revocation. The Stage 10 specialist-role model is also available locally.

Codex CLI, Claude Code, and GitHub Copilot CLI have provider-specific declarations. A generic local broker can execute exactly one explicitly configured provider after ADX issues a signed lease. It copies a server-configured source checkout into a disposable workspace, promotes only a successful candidate, records the terminal run receipt, and then opens independent verification for that candidate.

The authenticated `/control-plane` UI exposes **Request implementation** only when all server-owned settings are present: `ADX_LOCAL_CODING_AGENT_ENABLED=1`, source and candidate roots, a provider and pinned version, repository identity/ref/write paths, a database, and ledger signer. The browser supplies only the selected registered provider and optimistic Change Case version. It cannot select a binary, checkout, command, capability, credential, or target state.

This pilot does not authenticate a provider, grant network access, or broker run-scoped secrets. Its policy grants `shell`, repository read, and repository write only; network, secrets, browser, and deploy are denied. A production adapter still requires a dedicated provider identity, controlled egress, sandboxed tool gateway enforcement, cancellation exercise, and non-production operational evidence.

## The control boundary

```text
Authenticated ADX user
  │ requests implementation for an approved Change Case
  ▼
ADX control plane ── evaluates policy, role, risk, budget and repository scope
  │ issues a signed, short-lived execution lease only if allowed
  ▼
Agent dispatch broker ── selects the configured provider adapter
  ▼
Isolated execution sandbox ── starts Codex / Claude / another agent
  │ only through the lease-aware tool gateway
  ├── permitted repository worktree and paths
  ├── permitted commands and tool capabilities
  ├── exact network destinations, if any
  ├── time, output, process and disk quotas
  └── narrowly scoped, time-limited secret grants
  ▼
Receipts, artifacts and run events ── retained by ADX
  ▼
Independent verifier ── evaluates the resulting candidate separately
  ▼
Human review ── decides whether the verified preview may advance
```

The agent receives a task and a constrained environment. It does not receive an administrator credential, browser session, unrestricted shell, broad filesystem mount, raw production secret, or direct delivery-provider token.

## What an adapter is responsible for

Every provider adapter implements the same provider-neutral contract. The adapter is deliberately thin: it translates an ADX dispatch into a provider invocation and normalizes the result. It does not decide what work is allowed.

| Responsibility | ADX control plane | Provider adapter |
| --- | --- | --- |
| Authorize a run | Yes | No |
| Issue/revoke lease | Yes | No |
| Limit files, network, tools, secrets and budgets | Yes, through sandbox and gateway | Must honor and report limits |
| Construct provider command/request | Provides immutable dispatch inputs | Yes |
| Start/stop provider process | Authorizes and records | Yes, through sandbox runtime |
| Stream structured progress | Stores authoritative events | Yes, converts provider events to normalized events |
| Persist receipts/artifacts | Yes | Supplies declared outputs only |
| Determine pass/fail evidence | Independent verifier | No |
| Approve, merge, release, or deploy | Human/ADX delivery gates | No |

An adapter must be deterministic about its provider identity and version. Every run records at least:

- provider and adapter identifiers and versions;
- immutable Change Case, lease, task, repository, base revision and policy digests;
- requested and granted capabilities;
- sandbox image/runtime digest;
- normalized lifecycle events and terminal status;
- commands/tools invoked through the gateway, with timestamps and receipt digests;
- artifact manifest, patch digest and candidate revision digest; and
- cancellation, quota, denial, or reconciliation information.

## Required preconditions

Before “Start implementation” can become available for a Change Case, ADX should require all of the following:

1. The user has an authorized workspace membership and is allowed to request implementation.
2. The Change Case has passed its intake, risk, story, design, and required governance gates.
3. The repository is registered to that workspace and its permitted base revision is known.
4. The requested agent role, task type, file paths, tool capabilities, cost ceiling, duration, and network policy are explicit.
5. A suitable sandbox image and independently verified toolchain are pinned by digest.
6. The provider adapter is enabled for that workspace and its provider identity/version is registered.
7. A secret grant is available only where truly needed, is scoped to the exact run, and is revocable.
8. The user confirms the exact proposed scope. This action creates a ledger-attested implementation request; it is not an implicit background action.

If any precondition is missing, the UI should show the one missing requirement and not offer a disabled button that looks runnable.

## Signed execution lease

The execution lease is the authority contract between ADX and the execution runtime. It is not a prompt instruction and cannot be overridden by the coding agent.

The signed payload should include:

```json
{
  "leaseId": "uuid",
  "organizationId": "uuid",
  "workspaceId": "uuid",
  "changeCaseId": "uuid",
  "repository": {
    "repositoryId": "registered-repository-id",
    "baseRevision": "immutable-git-revision",
    "allowedPaths": ["apps/api/**", "packages/domain/**"]
  },
  "adapter": { "id": "codex-cli", "version": "pinned-version" },
  "capabilities": ["workspace.read", "workspace.write", "test.run"],
  "limits": {
    "expiresAt": "timestamp",
    "maxWallClockSeconds": 1800,
    "maxOutputBytes": 1048576,
    "maxWritableBytes": 268435456,
    "maxProcesses": 32,
    "costCeiling": "configured-unit"
  },
  "network": { "allowedDestinations": [] },
  "secretGrants": [],
  "policyDigest": "sha256:..."
}
```

The runtime validates the signature before starting a process and continuously checks lease expiry and revocation. Revocation must terminate the process, deny subsequent gateway calls, retain a terminal run event, and leave only the sanctioned manifest-digested artifacts.

## Provider choices

All providers use the same ADX contract. The selection changes only the adapter implementation and operational dependencies.

| First-provider option | Strength | Main integration concern |
| --- | --- | --- |
| Codex CLI | Natural fit for local or containerized repository work; command-line dispatch is straightforward. | Authenticate from a brokered, run-scoped credential rather than a developer’s interactive session. |
| Claude Code | Strong interactive coding workflow and CLI-based adapter shape. | Same need for non-interactive, run-scoped authentication and structured event normalization. |
| GitHub Copilot CLI/SDK | Helpful where GitHub is already the governed source host. | Keep GitHub installation/identity permissions separate from repository write and merge authority. |
| Internal/custom agent | Maximum control over prompts and protocol. | ADX still needs the same sandbox, gateway, receipts, and independent verification; custom does not remove those obligations. |

Start with **one provider**. Codex CLI is a sensible first adapter for this repository because the run can be dispatched as a local container command. Add Claude Code only after the generic contract and conformance tests pass; a second adapter should prove portability, not create a parallel security model.

## Authentication and secrets

Provider authentication is the highest-risk integration detail.

- Do not put provider API keys, OAuth tokens, or CLI login state in browser JavaScript, Change Case records, prompts, checked-in files, or `.env.example`.
- Do not mount a developer’s home directory, shell profile, credential store, SSH configuration, Git config, or active Codex/Claude login into the sandbox.
- Keep the provider credential in a dedicated secret manager or execution-broker secret store. The gateway exchanges the lease for the one secret grant the run is allowed to use.
- Scope the credential to the least privilege available: preferably an execution-only project/service identity with budget constraints, not a personal account.
- Record a secret-grant receipt without retaining the secret value.
- Rotate and revoke provider credentials independently from individual agent runs. Immediately revoke a suspect credential and invalidate affected adapter configurations.

The coding agent must never have a deploy token, a broad cloud credential, or a Git credential capable of bypassing ADX’s preview/review gates. Stage 7 currently permits preview-only Git plans; no live branch, pull request, merge, or release mutation should be enabled as part of the first agent adapter.

## Repository and workspace model

Each run uses a disposable copy-on-write worktree made from the registered base revision. The source checkout stays unchanged. The agent may write only under the lease’s allowed paths.

At completion, the runtime retains:

1. a content-addressed manifest of permitted output files;
2. the patch/diff digest;
3. the candidate revision digest;
4. declared generated artifacts and their media types/digests; and
5. the complete gateway/tool receipt chain.

It does not retain arbitrary sandbox state, raw provider credential files, package caches containing credentials, or unbounded agent transcripts. A final human-readable summary may be retained as untrusted narrative, clearly separate from verifier evidence.

## Task and prompt construction

The prompt is untrusted input. It should be assembled from versioned, reviewable fields rather than a free-form concatenated instruction alone:

- Change Case title and objective;
- approved story and acceptance-criteria digest;
- design constraints and threat-model digest;
- repository/base revision and writable path allowlist;
- explicit non-goals;
- allowed commands/tools and test commands;
- requirement to produce a concise final summary; and
- instruction that agent text cannot authorize or broaden access.

Context supplied from the Stage 10 context graph must carry provenance and freshness labels. Untrusted, stale, or conflicting context should be visible to the agent as such and should never modify the lease’s enforcement boundary.

The agent should have a simple contract: inspect, implement within scope, run approved tests, report what changed and what remains uncertain. It must not be asked to self-approve, self-verify independently, create remote PRs, or deploy.

## User experience in the authoritative UI

Add this to the backend `/control-plane` experience, not the fictional health-authorization demonstration UI.

### Change Case detail

When the case is eligible, show an **Implementation request** card with:

- selected provider/adapter and pinned version;
- exact repository and base revision;
- writable path and tool capability summaries;
- duration/budget/network limits;
- required reviewer/verification gates after the run; and
- a single “Request bounded implementation” action.

The confirmation page should display the authoritative scope and create an auditable request. It should state that ADX will run an isolated coding agent and that a successful run does not approve a change.

### During a run

Show live normalized state: queued, starting, running, cancellation requested, completed, failed, cancelled, expired, or quota exceeded. Provide **Stop run** only to identities permitted to revoke the lease. The activity panel may show sanitized progress and receipts, but no secret-bearing output.

### After a run

Show a summary of changed files, candidate digest, tests requested versus completed, artifact manifest, terminal reason, and link to the independent Evidence Review page. Never label the agent output as “verified” until an independent verifier has produced a passing evidence bundle bound to the same candidate digest.

## Adapter interface and normalized events

The exact TypeScript/JavaScript types can follow existing repository conventions, but the behavioral contract should look like this:

```text
validateConfiguration(config) -> adapter identity + capabilities
dispatch({ lease, task, worktree, gateway }) -> run handle
observe(run handle) -> normalized progress events
cancel({ lease, run handle }) -> terminal acknowledgement
collect(run handle) -> declared output manifest and provider metadata
```

Useful normalized event types include:

- `AgentRunRequested.v1`
- `AgentRunStarted.v1`
- `AgentToolReceiptRecorded.v1`
- `AgentRunProgressed.v1` (sanitized and size-limited)
- `AgentRunQuotaExceeded.v1`
- `AgentRunCancellationRequested.v1`
- `AgentRunCancelled.v1`
- `AgentRunCompleted.v1`
- `AgentRunFailed.v1`

Every event should be idempotent, tenant-scoped, trace-correlated, signed/attested where appropriate, and ordered or reconciled safely. Provider acknowledgement alone must not be treated as proof that a process started or finished; observations converge through the durable inbox/reconciliation model.

## Independent verification remains separate

After a successful implementation run, ADX prepares a candidate from the retained artifact manifest. A new verifier environment starts fresh, read-only, and independent of the implementing agent. It runs the pinned build/test/static/security/SBOM adapters and retains a signed evidence bundle.

Only a passing, digest-bound independent bundle may satisfy Gate D. A provider transcript, a green command printed by the agent, or the agent’s claim that tests passed is useful context but not independent evidence.

## Recommended delivery plan

### Phase 1 — Contract and a simulated adapter

1. Define `AgentAdapter` configuration, capability, dispatch, cancellation, observation, and output-manifest contracts. **Completed for Codex, Claude Code, and GitHub Copilot as declaration-only adapters.**
2. Register adapters per tenant/workspace, including provider version, allowed roles, status, and configuration digest.
3. Implement a deterministic simulated adapter that exercises every state and failure path without provider credentials.
4. Add contract tests for expiry, revocation, duplicate dispatch, delayed/reordered provider observations, bad manifests, and denied capabilities.

### Phase 2 — Codex CLI adapter in the existing sandbox

1. Add a pinned Codex CLI runtime image and record its digest.
2. Implement non-interactive, brokered authentication through a run-scoped gateway secret grant.
3. Dispatch the CLI only through the Stage 5 hardened runtime, using the disposable worktree.
4. Normalize events, enforce output limits, collect manifest-digested artifacts, and reconcile terminal state.
5. Verify forced revocation, invalid credential behavior, egress denial, timeout, quota exhaustion, and provider outage recovery.

### Phase 3 — Authoritative UI and verification hand-off

1. Add the implementation-request and run-detail pages to `/control-plane`.
2. Add appropriate RBAC/ABAC actions and explicit audit events for request, cancellation, and review.
3. Link a finished candidate to the existing independent verification workflow.
4. Confirm browser route isolation and that unauthorized users cannot see task details, outputs, or provider identity information beyond what policy allows.

### Phase 4 — Second provider and production-readiness evidence

1. Implement Claude Code (or another selected provider) against exactly the same adapter contract.
2. Run cross-adapter conformance tests that prove identical authority boundaries and event semantics.
3. Run a controlled non-production operational exercise with named owners, credential rotation, incident response, cost controls, and reconciliation recovery.
4. Retain evidence before claiming the adapter is production-ready.

## Acceptance criteria for the first real adapter

The first provider integration is ready for controlled use only when all of the following are demonstrably true:

- A run cannot start without a valid signed lease and authorized Change Case state.
- Lease expiry and explicit revocation terminate an active agent process.
- The agent cannot access host secrets, unapproved filesystem paths, private networks, metadata services, socket mounts, or disallowed processes.
- Provider credentials are never exposed to the browser, prompts, logs, retained artifacts, or user worktrees.
- Duplicate dispatch requests cannot start duplicate work; ambiguous provider states enter reconciliation rather than blind retry.
- All material output is digest-bound to the exact worktree/base revision and retained through immutable receipts.
- The agent cannot merge, deploy, or self-approve.
- Independent verifier evidence is required before the candidate becomes delivery-ready.
- Authorized users can inspect run status and cancel it; unauthorized users are denied at the API and UI routes.
- A non-production exercise proves operation, failure recovery, credential revocation, and auditability end to end.

## Decisions still needed from the ADX owner

Before implementing Phase 2, select:

1. The first coding-agent provider (recommended: Codex CLI).
2. Where agent sandboxes will run locally and later in non-production.
3. The approved secret manager/execution identity used for provider authentication.
4. Which repositories and paths may be eligible for agent writes.
5. Default per-run time, cost, network, process, output, and disk limits.
6. The first small Change Case used for an end-to-end, non-production pilot.

Those choices are operational authority decisions. They should be recorded as ADX configuration and reviewed before a real provider executor is enabled.
