# Stage 10 conformance record — Context graph and specialist roles

- **Status:** `IN_PROGRESS`
- **Last updated:** 2026-08-19
- **Requirements in scope:** `STG-011`, `CTX-001`, `AGT-001`, `AGT-002`

| ID | Requirement | Required proof | Status |
| --- | --- | --- | --- |
| STG10-001 | Context is tenant-scoped, provenance-labelled, untrusted by default, and freshness-assessed. | Context graph poisoning/freshness suite. | Verified locally |
| STG10-002 | Specialist roles declare no decision, approval, execution, or deployment authority. | Role contract suite. | Verified locally |
| STG10-003 | Role selection requires measured value without safety, reproducibility, or approval-clarity regression. | Role value-evaluation suite. | Verified locally |
| STG10-004 | Context graph and role evaluations are durably retained and independently reviewable. | PostgreSQL/API suite. | Planned |
