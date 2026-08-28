# Gate Usability Validation

## Goal

Make each ADX delivery step understandable without requiring users to infer the workflow. This work does not alter authorization, separation of duty, evidence, digest binding, or state transitions.

## Usability Standard

Every gate must make these four facts visible before its primary action:

1. The current gate and Change Case state.
2. The one safe next action.
3. The role or prerequisite required to take it.
4. The result of completing it, including whether delivery remains blocked.

Each action must be reachable by keyboard, expose an accessible label, remain usable at a narrow viewport, and have a focused regression test. Browser journeys verify the rendered workflow where test authentication and dependencies are available.

## Progress

| Surface | Status | Current evidence | Next work |
| --- | --- | --- | --- |
| Generated candidate review | In progress | Candidate browser tests pass; VS Code launch and verification next action added. | Add browser journey and narrow-viewport check. |
| Gate A intake | Complete | Dedicated renderer module and authenticated browser classification journey pass. | None. |
| Gate A.5 classification | Complete | Dedicated renderer module; authenticated story authoring and submission journey pass. | None. |
| Gate B story review | Complete | Dedicated renderer module, labels, and authenticated workshop-to-review browser journey pass. | None. |
| Gate C design review | Complete | Authenticated capture and independent review browser journey pass; authorization, separation of duty, expiry, and digest invalidation pass API verification. | None. |
| Gate D verification | In progress | Verification page tests pass; generated-code review link added. | Add browser journey and narrow-viewport check. |
| Gate E preview and delivery | In progress | Readiness checklist exposes complete or blocked status to assistive technology. | Add browser journey for plan, CI, findings, decision, and draft PR recovery. |
| Gate F outcome review | Complete | Dedicated renderer with retained-outcome counts, escaped history, and state-aware guidance passes focused tests. | None. |
| Studio workspace and navigation | In progress | Current action now identifies the governing workspace role; failed case loads can be retried. Studio production build passes. | Add authenticated real-workspace browser journey. |
| Accessibility and responsive behavior | In progress | Guided mobile keyboard journey passes at 375 px. | Add authoritative gate keyboard and screen-reader browser checks. |

## Validation Matrix

| Check | Evidence required |
| --- | --- |
| Current state | Gate name and Change Case state appear in the page header. |
| Next action | Exactly one primary action or a concise, actionable blocked explanation is visible without expanding details. |
| Recovery | Failures name the next permitted recovery action without suggesting an unsafe bypass. |
| Authority | Missing permission identifies the required role without exposing credentials or access controls. |
| Keyboard | Tab order reaches the primary action and forms without a mouse. |
| Screen reader | Primary buttons, links, status messages, form fields, and decision choices have accessible names. |
| Mobile | At 375 px width, text does not overlap, actions remain visible, and no horizontal page scroll is introduced. |
| Journey | A browser test completes the permitted journey using controlled test identities and validates the resulting state. |

## Current Changes

- Candidate review has a server-derived `Open in VS Code` action and a direct `Next: run independent verification` link.
- Gate D links back to generated-code review before a user requests independent verification.
- Manual Preview now defaults to the candidate-bound after-implementation profile.
- Gate A confirmation explicitly describes the permitted next step after classification.
- Gate A.5 explicitly states that story submission is draft-only and requires independent Gate B review.
- Studio identifies the current workspace authority beside the next action and offers an in-place retry after load failure.

## Evidence Log

| Date | Scope | Result |
| --- | --- | --- |
| 2026-08-27 | Candidate browser unit tests | Pass: 3 tests. |
| 2026-08-27 | Gate D verification review unit tests | Pass: 5 tests. |
| 2026-08-27 | Gate B story review unit tests | Pass: 5 tests. |
| 2026-08-27 | Gate E delivery review unit tests | Pass: 4 tests. |
| 2026-08-27 | Candidate review and Gates B-E page suite | Pass: 18 tests. |
| 2026-08-27 | Studio production build | Pass: TypeScript and Vite build. |
| 2026-08-27 | Guided mobile keyboard browser journey | Pass: 1 Playwright test at 375 px. |
| 2026-08-27 | Gate B authenticated story workshop and review journey | Pass: 1 Playwright test. |
| 2026-08-27 | Gate C authenticated design capture and review journey | Pass: 1 Playwright test. |
| 2026-08-27 | Gate A authenticated intake classification journey | Pass: 2 Playwright tests, including persisted deep-link reload. |
| 2026-08-27 | Gates A, A.5, and F renderer modules | Pass: 5 focused unit tests and maintainability contract verification. |
| 2026-08-27 | Full API unit regression | Pass: 159 tests. |
| 2026-08-27 | Gate C API policy verification | Pass: capability denial, separation of duty, exception expiry, digest invalidation, and execution readiness. |
| 2026-08-27 | Post-extraction Gate B browser regression | Pass: 1 Playwright test. |
| 2026-08-27 | Stages 8–10 governance validation | Pass: preview-only delivery binding, immutable outcomes, tenant isolation, provenance, freshness, and role authority limits. |
| 2026-08-27 | Root build | Blocked before compilation: tracked `.npmrc` does not meet Stage 0 public-registry and strict-SSL policy. No configuration file was inspected or changed. |

## Completion Criteria

This tracker is complete only when every row in Progress is marked Complete, the relevant focused/unit and browser tests pass, and the evidence log contains the executed commands and concise outcomes. “Zero cognitive overload” is treated as a measured design target, not an untestable claim.
