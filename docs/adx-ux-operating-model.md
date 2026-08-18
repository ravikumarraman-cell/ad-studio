# ADX UX operating model

**Status:** active delivery standard  
**Applies to:** every ADX user journey, beginning with feature intake and ending with an evidenced outcome  
**Product promise:** a user should always understand what ADX knows, what it will do next, what needs human authority, and how to recover safely.

## The experience to build

ADX is not a collection of agent controls. It is a calm, evidence-led delivery workspace. A user starts with a feature list, selects one item, and is guided through a single governed Change Case. The screen answers three questions before it asks the user to act:

1. **Where am I?** The current stage and the feature or Change Case in scope.
2. **Why am I here?** The decision, evidence, or constraint that caused this state.
3. **What is safe to do next?** One dominant action, its authority, its consequence, and any required human approval.

No screen may imply that an agent ran, a policy passed, a code change was created, or software was released unless durable evidence proves it.

## Non-negotiable interaction rules

| Rule | Product behavior | Acceptance evidence |
| --- | --- | --- |
| One object, one next action | A selected feature or Change Case remains visible while the user advances it. One primary action represents the safe next transition. | First-click test: at least 90% of new users choose the correct next action without help. |
| Progressive disclosure | Default view shows status, reason, next action, and blocking condition. Technical receipts, policy details, prompts, and logs are available on demand. | A five-minute comprehension test: at least 90% accurately explain the current state and blocker. |
| No dead ends | Every visible interactive control works, is intentionally disabled with an explanation, or is omitted. | Automated navigation inventory plus manual keyboard pass. |
| Truthful capability | File types, integrations, and agent actions are only offered when their adapter and verification are available. Planned capabilities are labelled as planned, not selectable. | Negative-path tests for unsupported file types and unavailable integrations. |
| Safe, reversible progression | A transition describes what will happen, retains source data, and creates an auditable event. Irreversible or high-risk steps require an explicit review state. | Event-ledger and approval tests in the relevant delivery stage. |
| Human authority is obvious | The UI names the authorized role, explains why approval is required, and distinguishes recommendation from decision. | Role-based scenario test and policy-gate evidence. |
| Accessible by default | Keyboard operation, visible focus, semantic controls, status announcements, responsive layout, and WCAG 2.2 AA contrast/target requirements are part of the component contract. | Automated accessibility scan and manual keyboard/screen-reader checks. |

## Canonical workflow

```text
Feature source → import review → selected feature → Change Case → clarify
→ design gate → bounded agent lease → independent verification
→ controlled release → outcome and learning
```

The user never has to learn a different mental model for the next stage. Each stage has the same anatomy:

| Surface | Required content |
| --- | --- |
| Context bar | Object ID, current stage, risk tier, owner, and freshness of the latest evidence. |
| Decision card | Plain-language reason for the current state and the condition that unlocks progress. |
| Next-action card | One primary action, expected result, required authority, and a link to the governing evidence. |
| Evidence drawer | Source file/row, policy version, receipts, test results, agent/tool activity, and timestamps. |
| Activity timeline | Immutable, chronological, human-readable record with drill-down detail. |
| Recovery path | Cancel before submission, correct import data, retry a failed safe action, or open an exception/review case. |

## Feature intake: the first five minutes

1. Land on **Your features** with a short sentence explaining the next action and a downloadable sample.
2. Import one supported source type. Before ingestion, show row count, required-column mapping, duplicate IDs, validation errors, and the exact source retained.
3. Present a review screen—not an automatic execution screen. The user can correct or exclude rows without losing the original source.
4. Select one feature. Keep its owner, repository, acceptance criteria, risk tier, and source link in view.
5. Create a Change Case. ADX records the source binding, shows the next safe action, and never grants an agent authority implicitly.

CSV is the currently verified format. XLSX must not be presented as available until its parser, column mapping, cell-level errors, source retention, and browser test are implemented. When available, CSV and XLSX must map to the same reviewed import contract.

## Component standards

- Use native buttons, links, inputs, labels, headings, lists, and landmarks first; ARIA supplements semantics rather than replacing them.
- Every focusable control has a high-contrast `:focus-visible` ring. Keyboard focus must remain visible, including in dialogs and narrow layouts.
- Modal dialogs use `role="dialog"`, `aria-modal="true"`, an accessible name, and managed focus. Escape and Cancel return the user to the originating action.
- Status updates use a polite live region; errors identify the affected item and suggest the correction.
- Click targets meet WCAG 2.2 AA minimum sizing. The design target for primary controls is 44 × 44 CSS pixels where layout permits.
- Destructive, privileged, or regulated actions include the actor, scope, policy/evidence basis, and a confirmation only when it prevents a meaningful mistake.
- Loading states retain the current context and describe progress; empty states explain the first useful action.

## Measurement and quality gates

| Outcome | Initial target | Evidence method |
| --- | --- | --- |
| Feature import success | 90% of representative users complete a valid import without help. | Moderated test with a valid CSV/XLSX and one recoverable error. |
| Error recovery | 85% correct a missing/invalid field on the first retry. | Instrumented import validation scenario. |
| Stage comprehension | 90% can state stage, blocker, and responsible role after viewing a case. | Five-question comprehension check. |
| Primary-path completion | 90% complete feature → Change Case → next gate in under five minutes. | Timed usability task. |
| Accessibility | Zero critical/serious automated violations; manual keyboard and screen-reader walkthrough passes. | CI scan plus recorded manual test. |
| Trust calibration | 100% of evaluated users correctly distinguish a recommendation, a requested action, and a completed action. | Scenario-based test of agent and approval states. |

Measure these by role (requester, product owner, reviewer, engineer, release manager) and risk tier. Do not average away a safety or accessibility failure.

## Delivery sequence

| Priority | Work | Stage dependency |
| --- | --- | --- |
| Now | Eliminate unsupported import affordances and inactive navigation; add focus, dialog, status, and keyboard foundations. | None; demonstration UI. |
| Next | Build durable Change Case detail, timeline, state reason, and evidence drawer from Stage 2 data. | Stage 2. |
| Next | Implement CSV + XLSX adapters, preview, mapping, row/cell error correction, deduplication, and source retention. | Stage 3. |
| Then | Add risk-aware policy and security gates in the same canonical workflow. | Stage 4. |
| Then | Present agent lease scope, live activity, pause/stop, and receipts without exposing raw agent complexity by default. | Stages 5–7. |
| Finally | Add release progress, rollback state, outcomes, and learning comparisons as evidence-led steps. | Stages 8–10. |

## Research basis

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) establishes current accessibility criteria, including focus visibility, target size, redundant entry, and accessible authentication.
- [W3C guidance on new WCAG 2.2 criteria](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/) explains why focus, target size, and reduced cognitive burdens affect task success.
- [W3C guidance on focus appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance) supports the visible focus requirement used in the component standard.
- [NIST AI RMF human-AI interaction guidance](https://airc.nist.gov/airmf-resources/airmf/appendices/app-c-ai-risk-management-and-human-ai-interaction/) calls for clearly differentiated human and AI roles and responsibilities; ADX makes those boundaries visible at every gate.
- [NIST AI RMF Playbook](https://airc.nist.gov/docs/AI_RMF_Playbook.pdf) identifies human-AI teaming and measurement of human oversight as lifecycle concerns; ADX therefore treats task comprehension and trust calibration as release evidence.
