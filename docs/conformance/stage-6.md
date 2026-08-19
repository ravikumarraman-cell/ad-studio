# Stage 6 conformance record — Independent verification and evidence bundle

- **Status:** `COMPLETE`
- **Last updated:** 2026-08-18
- **Requirements in scope:** `STG-007`

## Delivery order

1. Establish a pinned, fresh, read-only verifier boundary and evidence contract.
2. Add build, test, static, security, SBOM, and provenance verifier adapters.
3. Persist immutable evidence bundles and their artifact bindings under tenant isolation.
4. Present verifier evidence separately from implementer activity in the review surface.
5. Require complete independent evidence before the next governance transition.

## Acceptance matrix

| ID | Requirement | Required proof | Status |
| --- | --- | --- | --- |
| STG6-001 | The verifier uses an independent fresh environment and cannot mutate the candidate. | Read-only Docker verifier test with mutation attempt. | Verified locally |
| STG6-002 | Evidence is provenance-bound and reproducible for deterministic tools. | Two identical pinned runs have equal candidate/config/output digests. | Verified locally |
| STG6-003 | A pass cannot exist without complete independent evidence. | Signed evidence-contract negative test. | Verified locally |
| STG6-004 | Signed evidence and artifact-digest bindings are immutable, tenant-scoped, service-retained, and independently readable. | PostgreSQL/API isolation and immutability suite. | Verified locally |
| STG6-005 | Build, test, static-analysis, security, and SBOM adapter categories are explicit, pinned, and evidence-producing. | Adapter catalog and isolated verifier suite. | Verified locally |
| STG6-006 | Evidence objects are content-addressed in MinIO, reviewer evidence is visually distinct from implementer activity, and Gate D requires a passing independent bundle bound to the candidate. | Object-store, PostgreSQL/API, and review-surface suite. | Verified locally |
