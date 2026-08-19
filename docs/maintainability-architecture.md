# ADX maintainability architecture

## Objective

ADX favors explicit domain contracts, narrow adapters, isolated side effects, and evidence-backed behavior over framework abstraction for its own sake. Reuse is valuable only when it preserves authority boundaries and makes a policy-relevant change easier to verify.

## Canonical workflow contract

`packages/domain/src/change-case-workflow.json` is the single runtime source for Change Case states, their UI positions, and Gate A, A.5, and B–F metadata. It is consumed by:

- the event ledger, which validates lifecycle transitions;
- the Node control plane, which renders authoritative review links and status;
- the React client, which renders the workflow map and selects the safe next action; and
- the typed domain package, which exposes the same vocabulary to future TypeScript consumers.

`npm run verify:maintainability` proves this wiring, while `npm run verify:stage0` validates the contents of the contract. A workflow change must update this contract first; renderers should not introduce their own gate lists or state-position mappings.

The React client uses `adx-api-client.ts` for authenticated request handling and public response types. The control-plane renderer uses `review-page-utils.mjs` for retained-value escaping and safe inline-script configuration. These are intentionally small seams: policy, authorization, and durable commands remain in the server and repositories.

## Feature import resilience

The browser submits one validated feature batch to `POST /v1/workspaces/:workspaceId/feature-imports`. The server assigns deterministic idempotency keys for each feature's create, intake-transition, intake-capture, and classification commands. Retrying the same `importId` and feature therefore returns the original Change Case rather than creating another one.

The current explicit policy is `PARTIAL_SUCCESS_RESUMABLE`: valid rows are attempted independently, each response records `IMPORTED`, `REQUIRES_CLARIFICATION`, or `FAILED`, and a retry safely resumes failed work. This is the correct operational behavior for an import that can contain independently valid features. A future all-or-none import must be a distinct endpoint with one database transaction and its own evidence semantics; it must not silently change this endpoint's policy.

## Design rules

1. Domain rules live in provider-neutral modules or contracts, never in a UI event handler or provider adapter.
2. HTTP routes authenticate, authorize, parse, and delegate. Durable writes belong in repositories and use optimistic versions plus idempotency keys.
3. Every provider integration is an adapter behind a small capability-focused contract. Adapters cannot decide authority.
4. UI components should consume typed query data and issue commands through a shared API client. They must not duplicate state-machine logic or interpret evidence as authorization.
5. Imports and other multi-step operations must report per-item outcome and remain safely resumable; a future bulk endpoint should be atomic where all-or-none semantics are required.
6. Performance changes require a measured budget or a demonstrated hot path. Avoid speculative caching that can make governance state stale.
7. Every reusable module has one owner, one public purpose, and focused verification. Do not create generic utility layers without more than one stable consumer.

## Current improvement backlog

The repository is intentionally still compact. The next high-value structural improvements are:

1. Extract server-rendered review pages from `apps/adx-api/server.mjs` into per-gate page modules; the shared escaping/configuration helper is already in place.
2. Split `feature-delivery.tsx` into route shell, workspace view, workflow map, import modal, and demo modules; retain the shared workflow and typed API client.
3. Replace the remaining `any` query and command responses with exported API contract types.
4. Persist import-run summaries only if cross-session operational reporting is needed; otherwise retain the current idempotent `PARTIAL_SUCCESS_RESUMABLE` policy.
5. Add measured browser performance and accessibility checks before optimizing rendering or caching further.

These items improve maintainability without weakening the current evidence, tenancy, authorization, or fail-closed execution controls.
