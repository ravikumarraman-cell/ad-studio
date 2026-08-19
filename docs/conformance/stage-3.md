# Stage 3 conformance record — Intake, risk classification, and stories

- **Status:** `IN_PROGRESS`
- **Last updated:** 2026-08-18
- **Requirements in scope:** `STG-004`, `POL-001`, `EVD-002`, `GOV-002`

## Delivery order

1. Retain the original intake source and capture a typed delivery intent.
2. Stop classification when ownership, acceptance criteria, retained source, or other required information is missing or ambiguous.
3. Classify risk from declared risk and asset classifications; never reduce the effective tier silently.
4. Produce an immutable, digest-addressed story graph with testable BDD scenarios.
5. Require an independent reviewer decision that binds to that exact digest; invalidate it on any story revision.
6. Present the authoritative contract in a low-cognitive-load review screen and retain hosted-CI evidence.

## Acceptance matrix

| ID | Requirement | Required proof | Status |
| --- | --- | --- | --- |
| STG3-001 | Intent requires outcome, accountable owner, acceptance criteria, target repository, retained source, and declared assets. | `npm run verify:stage3` and `npm run verify:stage3:api`. | Verified locally |
| STG3-002 | Missing mandatory ownership stops the request; ambiguity prevents classification until resolved. | Typed `INTENT_INCOMPLETE` and `CLARIFICATION_REQUIRED` command errors; a corrected retained-intent command supersedes open ambiguities. | Verified locally |
| STG3-003 | Asset classification raises, but never silently lowers, the effective risk tier and provides a reasoned factor list. | `npm run verify:stage3:api` classifies an R1 request containing a restricted asset as R4. | Verified locally |
| STG3-004 | Stories are stored as a versioned graph with at least one Given/When/Then scenario per story. | `npm run verify:stage3` and `npm run verify:stage3:api`. | Verified locally |
| STG3-005 | Approval is digest-bound and has separation of duty from the story author. | Self-approval rejection and independent approver acceptance in `npm run verify:stage3:api`. | Verified locally |
| STG3-006 | A revision invalidates active approvals for the prior digest and returns the case to story review. | `npm run verify:stage3:api`. | Verified locally |
| STG3-007 | Intake, classification explanation, story graph, and approval history are tenant-scoped authoritative read projections. | `GET .../governance` API route, direct cross-tenant object-reference attack, tenant predicates, and RLS. | Verified locally |
| STG3-008 | A reviewer can safely review the semantic contract without raw transcript archaeology. | Authenticated server-backed Story Review page, single-safe-next-action framing, retained-source metadata/digest, risk factor explanation, BDD contract, approval history, and deep-link reload browser test. | Verified locally |

## Remaining completion gates

1. Run the newly added Stage 3 suite successfully in hosted CI.

## Completion rule

Stage 3 is complete only when a qualified reviewer can review the retained source, intent, ambiguity status, risk explanation, BDD stories, and digest-bound approval decision from the authoritative UI before execution is possible.
