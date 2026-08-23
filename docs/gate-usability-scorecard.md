# ADX gate usability scorecard

**Status:** active improvement ledger  
**Owner:** ADX product and delivery team  
**Companion standard:** [ADX UX operating model](adx-ux-operating-model.md)  
**Workflow source:** [Change Case workflow](../packages/domain/src/change-case-workflow.json)

## Purpose

This scorecard tracks the usability of each governed delivery gate. Its purpose is to make improvement work visible and evidence-led; it is not an authorization mechanism and does not replace policy, approval, or verification evidence.

A gate can claim **10/10** only when every rubric point below passes for the gate's supported role and risk-tier scenarios, with retained evidence. An unmeasured gate is **not assessed**, never assumed to be 10/10. Cognitive overload is a hard failure: a gate with an overloaded default view cannot claim 10/10.

## Scoring rubric

Award one point for each demonstrated condition:

| Point | Condition | Required evidence |
| --- | --- | --- |
| 1 | The current Change Case, stage, owner, and risk tier are visible. | Route/UI test or recorded review. |
| 2 | The page explains why the case is at this gate. | Comprehension-task result. |
| 3 | One safe next action is clearly dominant, and the default view contains no competing primary actions or ungrouped technical detail. | First-click and cognitive-load review. |
| 4 | Required authority and separation-of-duty constraints are explicit. | Role scenario test. |
| 5 | Blocking conditions and the unlock condition are actionable. | Negative-path test. |
| 6 | Decision-relevant evidence is reachable without leaving context. | UI/navigation test. |
| 7 | Failure, empty, and unavailable states give a safe recovery path. | Negative-path test. |
| 8 | Status and completion claims match durable evidence only. | Ledger/API acceptance test. |
| 9 | Keyboard, focus, semantics, contrast, and narrow layouts pass the accessibility check. | Automated scan and manual pass. |
| 10 | Representative users complete the gate task, explain its outcome correctly, and identify the next safe action without avoidable mental effort. | Timed task, comprehension, and cognitive-load result. |

**Score:** $\text{passed points} / 10$. A score of 10 requires no critical accessibility issue, no safety-clarity failure, no cognitive-overload finding, and no unresolved blocker even if all other points pass.

## Cognitive-load guardrail

The default gate view must let a user answer these questions without opening technical detail: **What am I reviewing? Why is it here? What is blocking progress? What may I safely do next?**

The review fails when any of the following is observed:

- more than one visually primary action competes for the same decision;
- essential status, reason, blocker, authority, or consequence is hidden behind secondary navigation;
- raw receipts, logs, policy payloads, or implementation detail interrupt the decision path instead of being progressively disclosed;
- a representative user cannot identify the next safe action and its consequence in the first-click task without help.

Technical evidence remains available on demand, but it must not be required to understand the current decision. The scoring record must identify the overloaded element, the simplification made, and the re-test result.

## Score ledger

| Gate | User outcome | Current score | Target | Next improvement | Evidence | Reassess after |
| --- | --- | ---: | ---: | --- | --- | --- |
| A - Define the work | Retain a clear, reviewable Change Case and risk context. | 7/10 provisional | 10 | Add retained intake evidence access, then run accessibility and representative correction/comprehension tasks. | 2026-08-23 guided-flow implementation and production build: sequential progression, decision frame, explicit authority, required-field blocker, recovery, truthful simulation claim, and a tested keyboard focus transition to the new stage context. | Gate A accessibility and task evidence. |
| A.5 - Generate and curate stories | Produce small, observable story slices without confusing AI suggestion with approval. | 7/10 provisional | 10 | Add story provenance/evidence access, then test selection recovery and comprehension. | 2026-08-23 guided-flow implementation and production build: sequential progression, decision frame, selection blocker, explicit non-approval language, and a tested keyboard focus transition to the active stage. | Gate A.5 accessibility and task evidence. |
| B - Approve the story | Make an independent, digest-bound story decision with its consequences understood. | 6/10 provisional | 10 | Add a request-changes recovery path and test authority, stale digest, and missing evidence. | 2026-08-23 guided-flow implementation and production build: decision frame, one forward path, authority boundary, and approval-artifact preview. | Gate B role and negative-path evidence. |
| C - Review the design | Review design/security evidence and make a safe independent decision. | 6/10 provisional | 10 | Validate readiness, exception, permission, and narrow-layout paths in the authoritative workbench. | 2026-08-23 guided-flow implementation and production build: decision frame, one forward path, independent-review boundary, and design-artifact preview. Authoritative Stage 4 browser test confirms readiness context and four progressively disclosed evidence panels. | Gate C accessibility and role evidence. |
| D - Verify the change | Understand verifier outcome, evidence provenance, and the path after failure. | 6/10 provisional | 10 | Add and test stale and digest-mismatch recovery in the authoritative evidence review. | 2026-08-23 guided-flow implementation and production build: decision frame, one forward path, verifier boundary, and verification-artifact preview. Authoritative unit test confirms a failed bundle explains correction outside review and rerunning the independent verifier without offering false completion. | Gate D browser, accessibility, and stale-binding evidence. |
| E - Review delivery | Review the exact preview and CI findings without implying a remote mutation occurred. | 6/10 provisional | 10 | Test decision invalidation and no-data recovery in delivery review. | 2026-08-23 guided-flow implementation and production build: decision frame, one forward path, preview-only boundary, and delivery-artifact preview. Authoritative unit test confirms blocked findings direct users to a fresh preview/CI evidence cycle rather than a fake in-page resolution. | Gate E browser, accessibility, and decision-invalidation evidence. |
| F - Record the outcome | Retain a factual outcome, incident/rollback links, and usable learning context. | 6/10 provisional | 10 | Test incomplete-evidence correction and outcome-report comprehension in the authoritative review. | 2026-08-23 guided-flow implementation and production build: decision frame, one forward path, factual-outcome boundary, outcome-artifact preview, and a tested completion state that confirms no records changed before offering one exit action. | Gate F browser, accessibility, and representative task evidence. |

These are source-level scores for the local guided walkthrough, not claims about the authoritative API workflow. No gate can progress beyond its provisional score until supported-role, accessibility, and negative-path evidence is collected.

## Improvement protocol

1. Choose the earliest unassessed or lowest-scoring gate that blocks the primary path.
2. Record a baseline against all ten rubric points using the listed evidence types.
3. Fix one observed usability barrier at a time; preserve the gate's policy and evidence contract.
4. Run the narrow route, authorization, and accessibility checks affected by the change.
5. Re-run the same task, attach the result, update the score, and record the next barrier.
6. Do not average scores across gates or roles. A critical accessibility, safety-clarity, or authority failure keeps the affected gate below 10/10.

## Evidence record template

Use one entry per assessment in the related issue, test report, or delivery evidence bundle:

| Field | Record |
| --- | --- |
| Gate and scenario | Gate ID, role, risk tier, and task. |
| Build or route | Tested commit/digest and route. |
| Result | Passed rubric points, score, and any blocking condition. |
| Evidence | Test report, recording reference, accessibility result, and relevant ledger/event IDs. |
| Improvement | Observed barrier, change made, and follow-up owner. |
| Reassessment date | Date and comparison with the prior score. |

## 10/10 release check

Before reporting a gate as 10/10, verify that the evidence shows:

- one dominant, authorized next action with an understandable consequence;
- a truthful state, decision reason, and recovery path;
- decision-relevant evidence and immutable activity context;
- passing supported-role and negative-path scenarios;
- zero critical or serious automated accessibility violations plus a manual keyboard/screen-reader walkthrough; and
- representative completion and comprehension results that meet the targets in the [ADX UX operating model](adx-ux-operating-model.md#measurement-and-quality-gates).
