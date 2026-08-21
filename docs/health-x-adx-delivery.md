# Health-X ADX Delivery Record

## Purpose

This document makes the Health-X reference delivery auditable. It identifies the initial application, the three requested features, the evidence each gate must retain, and the boundary between what was verified locally and what ADX cannot yet claim.

Health-X uses fictional browser-local data only. The case is a safe delivery demonstration, not a healthcare deployment and not a claim of clinical validation.

## Initial application

The initial application is a minimal TanStack Start dashboard with no account, API, database, external integration, or persistent data. Its role is to make the delivery increments clear:

- a Health-X shell and responsive layout;
- an explicit fictional-data and no-medical-advice notice; and
- no authority to make clinical, scheduling, medication, or coverage decisions.

The runnable implementation is [Health-X](../apps/health-x/README.md). It is deliberately small enough to remove and recreate from a clean clone.

## Feature Change Cases

| Change Case | Need | Delivered behavior | Non-goals |
| --- | --- | --- | --- |
| `HX-001` Upcoming care | A person needs one calm place to see their next planned interaction. | Displays fictional upcoming appointments and permits a session-only check-in action. | Real scheduling, reminders, calendar writes, clinical triage. |
| `HX-002` Medication check-in | A person needs a lightweight way to acknowledge a daily routine. | Marks fictional medication items as taken and displays progress until refresh. | Medication list management, adherence scoring, prescription data, clinical advice. |
| `HX-003` Today’s care plan | A person needs a low-pressure daily checklist. | Marks fictional wellbeing tasks complete and displays progress until refresh. | Care-plan authoring, intervention recommendations, patient records. |

## Full ADX lifecycle

For a real ADX execution, each Change Case follows the authoritative [main flow](adx-main-flow.md):

```text
Reviewed feature request
  -> Gate A: retained intent, risk, and approved story
  -> Gate B: approved design and security package
  -> Gate C: signed, bounded implementation lease
  -> Gate D: independent verification bound to the candidate digest
  -> Delivery preview and review
  -> Gate E: release candidate and controlled non-production rollout
  -> Gate F: retained outcome and evaluation
```

### Required review evidence

| Gate | Required reviewer question | Health-X evidence to retain |
| --- | --- | --- |
| A: Intent and risk | Is this a fictional, non-clinical experience with clear boundaries? | Source request, non-goals, risk classification, BDD acceptance criteria. |
| B: Design and security | Does the design avoid real health-data collection and external side effects? | Data-flow statement, threat model, dependency list, test strategy. |
| C: Execution | Is the coding worker limited to Health-X paths and approved commands? | Signed lease, adapter version, worktree manifest, tool receipts, patch digest. |
| D: Verification | Does an independent, fresh environment prove the exact candidate works? | Candidate digest, production build output, browser acceptance evidence, dependency/security results. |
| Delivery review | Does the reviewed preview still bind to the verified candidate? | Preview commit digest, review decision, CI observations. |
| E: Release | Is a named non-production target authorized with rollback and telemetry? | Release candidate, environment approval, rollout/rollback evidence, webhook reconciliation. |
| F: Outcome | Did the real rollout produce the expected outcome without safety regression? | Immutable outcome record, rollout status, incident/rollback links, redacted evaluation. |

## What this repository proves today

| Delivery claim | Status | Evidence |
| --- | --- | --- |
| Health-X source exists and contains the three scoped features. | Complete locally | `apps/health-x/app/routes/index.tsx` and `apps/health-x/README.md`. |
| Health-X has a deployable TanStack Start Node artifact. | Complete locally | `npm run health-x:build`; output entrypoint under `.output/server`. |
| Health-X has a container deployment definition. | Complete locally | `apps/health-x/Dockerfile`. |
| ADX models Gates A-F, tenant scope, signed ledgers, bounded execution, independent evidence, release candidates, and outcomes. | Complete as local control-plane capability | [implementation status](implementation-status.md). |
| A real external coding agent performed these changes under an ADX lease. | Not proven | Current Codex, Claude Code, and GitHub Copilot adapters are declaration-only and fail closed before live execution. |
| A provider created a remote pull request, merged it, or deployed Health-X. | Not available | Stage 7 is preview-only; no remote Git mutation is enabled. |
| A real release provider deployed Health-X. | Not available | Stage 8 is simulation-only and requires approved non-production provider configuration and game-day evidence. |
| A production healthcare outcome was measured. | Not applicable | Health-X is fictional and has no production healthcare use. |

This table is intentional: it prevents a local build or a polished UI from being described as an externally deployed, independently verified healthcare product.

## Coding-agent choice for a future live run

When an approved execution broker exists, choose one agent for the first live non-production run, preferably **Codex CLI** because its container-oriented model fits the existing sandbox design. Claude Code and GitHub Copilot adapters may be used only after they conform to the same lease, receipt, cancellation, evidence, and review contract.

The agent prompt must include only the approved Health-X Change Case, writable path allowlist, acceptance criteria, non-goals, and permitted test commands. The agent cannot self-approve, create a remote pull request, merge, or deploy.

## Reproducible verification runbook

1. Recreate the application from a clean clone using [Health-X](../apps/health-x/README.md).
2. Run `npm run health-x:build` followed by `npm run verify:health-x` to produce and smoke-test the server artifact.
3. Run `PORT=3000 node apps/health-x/.output/server/index.mjs` and perform the listed browser acceptance checks.
4. Build and run the local container using the documented Docker commands.
5. Retain build output, browser evidence, image digest, and the exact commit SHA as candidate evidence.
6. Before describing this as an ADX end-to-end deployment, enable an approved non-production coding-agent executor and release provider, then complete Gate C through Gate F evidence under the main flow.

## Completion statement

Health-X demonstrates the kind of small, bounded change ADX is designed to govern. It currently demonstrates a locally built and locally deployable application with three implemented features. It does **not** demonstrate a live provider-backed coding-agent run, remote Git delivery, real provider deployment, or a clinical outcome. Those claims must wait for retained evidence from the corresponding ADX gates.