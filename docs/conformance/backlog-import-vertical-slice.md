# Feature backlog-to-Change-Case vertical slice

- **Status:** `VERIFIED_DEMONSTRATION`
- **Scope:** local, fictional health-insurance use case only; no PHI, production identity, code-agent execution, or release integration.
- **Source contract:** `feature_id`, `title`, `description`, `priority`, `owner`, `target_repository`, `acceptance_criteria`, `risk_tier`.

## Verified behavior

| ID | Claim | Proof |
| --- | --- | --- |
| FVS-001 | ADX presents a three-feature health-insurance backlog. | `npm run verify:feature-import` checks count, required columns, unique IDs, priority, and risk tier. |
| FVS-002 | A user can import a compatible CSV and receive a row-level validation outcome. | `FeatureDelivery` CSV parser and visible in-app import result. |
| FVS-003 | A selected feature is bound to a Change Case before the delivery cycle begins. | The first governed action is `Create Change Case`; its source-binding evidence appears in Feature Traceability. |
| FVS-004 | A feature moves only through the declared sequence. | Backlog → Clarify → Design review → Bounded execution → Independent verification → Controlled release → Outcome recorded. |
| FVS-005 | Every demo transition appends visible traceability evidence. | Feature Traceability ledger in the app. |
| FVS-006 | The app compiles as a production bundle. | `npm run typecheck` and `npm --prefix apps/adx-studio-web run build`. |

## Deliberate non-claims

- The local UI is an in-memory demonstration. It is not yet the Stage 2 event ledger or durable Change Case service.
- The current import adapter accepts CSV. The spreadsheet runtime required to generate and verify the requested `.xlsx` sample is unavailable in this session; XLSX support remains an explicit, unverified adapter requirement.
- A visible UI transition is not evidence that a code agent, policy engine, sandbox, verifier, Git provider, or release system has executed. Those arrive only in their respective verified ADX stages.

## Reproduce

```bash
npm run verify:feature-import
npm run typecheck
npm --prefix apps/adx-studio-web run build
cd apps/adx-studio-web && npm run dev
```
