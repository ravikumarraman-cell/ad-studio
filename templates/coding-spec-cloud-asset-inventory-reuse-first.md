# Cloud Asset Inventory Coding-Agent Spec

Version: 1.2.0

This spec is the default prompt/contract for implementing a feature in `cloud-asset-inventory` with the `ad-studio` coding agent.

The goal is not just to ship a feature. The goal is to ship the smallest production-ready change that maximizes reuse of existing database tables, APIs, jobs, helpers, UI components, and UX patterns already present in the repository.

## 1. Execution Inputs

The approved Change Case supplies the feature title, outcome, acceptance criteria, and stories. Treat those values as immutable requirements. Do not invent, weaken, merge, or omit requirements.

Repository files supplied in the execution context are the only evidence for existing contracts and patterns. Do not assume an API, field, table key, environment variable, integration response, or UI route that is not present in the approved requirements or supplied repository context.

## 2. Core Mission

Implement the requested feature as a plug-and-play enhancement that:

- Reuses existing backend tables, routes, helpers, and services whenever possible.
- Reuses existing frontend pages, shared components, table controls, and modal patterns whenever possible.
- Keeps the current architecture consistent across database, API, jobs, and UI.
- Preserves backward compatibility for existing API contracts and user workflows.
- Adds only the smallest new code needed to close the gap.

If the feature can be implemented by extending an existing surface, do that instead of creating a new one. If the approved brief requires a new page, create a standalone page that still reuses existing backend and UI primitives, and include a clear link back to the existing Dashboard.

### 2.1 Non-Negotiable Completion Contract

The coding agent MUST implement every approved story and every Given/When/Then scenario in the same candidate. A story is complete only when all of the following are true:

- At least one patched implementation file contains behavior required by that story.
- At least one distinct patched test file contains meaningful assertions for that story's scenarios.
- Test paths use the repository's test conventions, such as `tests/test_*.py`, `*.test.js`, `*.test.jsx`, or `*.spec.*`.
- A test path is never also declared as an implementation path.
- Tests exercise observable behavior, authorization, response or UI state, and relevant failure paths; imports, constants, snapshots, or fixtures alone are not proof.
- Shared implementation or test files may cover multiple stories only when each story has identifiable behavior and assertions in those files.

The coding agent MUST NOT claim a story is covered merely because a file was touched, an existing regression suite passed, or coverage metadata names a path. If any story cannot be implemented and tested from the supplied context, the candidate is incomplete and MUST NOT be represented as complete.

### 2.2 Sequential Story Execution

The executor supplies exactly one approved story per model request. For each request, the coding agent MUST:

- Implement only the supplied story and all of its Given/When/Then scenarios.
- Add or update meaningful tests for that story in the same response.
- Create tests beside the owning implementation or in its established domain test directory; never repurpose an unrelated suite to satisfy coverage metadata.
- Preserve every unrelated behavior and every change already present in the accumulated candidate.
- Use the accumulated candidate as the source of truth; do not revert changes from earlier story requests.
- Not anticipate, implement, or claim coverage for stories absent from the current request.

After all story requests complete, the executor validates the combined candidate. Passing a per-story response contract does not prove the overall feature works; the accumulated candidate must still preserve existing behavior and satisfy all approved stories together.

### 2.3 Minimal-Diff Contract

The executor accepts complete replacement content for changed files. For every replacement, the coding agent MUST preserve unrelated imports, middleware, routes, handlers, comments, formatting, and behavior. It MUST NOT rewrite, condense, reorder, or modernize unrelated code. A small feature does not justify replacing an app factory, route registry, page shell, or shared configuration module wholesale.

## 3. Mandatory Reuse Policy

The coding agent MUST follow this precedence order:

1. Extend an existing endpoint, service, helper, component, or job in the same domain.
2. Reuse an adjacent existing domain surface that already owns the same data.
3. Add a small adapter or helper around an existing capability.
4. Create a new module only when no existing module can safely express the requirement.

The coding agent MUST NOT:

- Create a new database when an existing table or projection can support the feature.
- Create a new API host when an existing backend app already owns the same data and authority.
- Duplicate search, filtering, pagination, export, or import logic in a new path.
- Introduce a new frontend state model when the repo already has a page, context, or shared component for the same interaction.
- Replace an existing pattern just because a different pattern seems cleaner.

## 4. Repository Surfaces To Reuse First

The agent should inspect and prefer these existing surfaces before writing new code:

### Backend inventory API

- `backend/inventory/api/__init__.py`
- `backend/inventory/api/routes/v1/entity/entity.py`
- `backend/inventory/api/routes/v1/entity/tenants.py`
- `backend/inventory/api/routes/v1/entity/accounts/accounts.py`
- `backend/inventory/api/routes/v1/entity/reports.py`
- `backend/inventory/api/routes/v1/entity/helper.py`
- `backend/inventory/api/routes/v1/entity/resonse_helper.py`
- `backend/inventory/api/routes/v1/tenant_search_api/tenant_search.py`
- `backend/inventory/api/routes/v1/account_search_api/account_search.py`
- `backend/inventory/api/routes/v1/sbl_service/sbl_service.py`
- `backend/inventory/api/routes/v1/sbl_service_config_details/sbl_service_config.py`
- `backend/inventory/api/routes/v1/cloud_guru_service/cloud_guru_service.py`
- `backend/inventory/api/routes/v1/knowledge_graph/*`
- `backend/inventory/api/utils/*`

### Backend gateway API

Prefer this for read-heavy, search-heavy, filter-heavy, or projection-oriented work that already fits the newer FastAPI pattern:

- `backend/gateway_api/api/routes/v1/tenant_search.py`
- `backend/gateway_api/api/routes/v1/account_search.py`
- `backend/gateway_api/api/routes/v1/sbl_service_config.py`
- `backend/gateway_api/api/services/tenant_search_service.py`
- `backend/gateway_api/api/services/account_search_service.py`
- `backend/gateway_api/api/utils/search_helper.py`
- `backend/gateway_api/api/utils/dynamodb_utils.py`

### Backend shared utilities

- `backend/common/dynamodb_utils.py`
- `backend/common/logging_utils.py`
- `backend/common/config_utils.py`
- `backend/common/service_populate_utils.py`

### Frontend pages and shared components

- `frontend/src/pages/TenantManagement.jsx`
- `frontend/src/pages/EntityManagement.jsx`
- `frontend/src/pages/AccountManagement.jsx`
- `frontend/src/pages/TenantDetails.jsx`
- `frontend/src/pages/ImportManagement.jsx`
- `frontend/src/pages/TenantImport.jsx`
- `frontend/src/pages/AccountImport.jsx`
- `frontend/src/pages/Report.jsx`
- `frontend/src/pages/Service.jsx`
- `frontend/src/components/ux-standard/*`
- `frontend/src/components/entity/*`
- `frontend/src/components/tenants/*`
- `frontend/src/components/import/*`
- `frontend/src/components/reports/*`
- `frontend/src/shared/*`
- `frontend/src/contexts/TenantCompassContext.jsx`
- `frontend/src/client.js` or the current API client entry point used by the app

## 5. Discovery Pass

Before writing code, the agent MUST build an internal reuse map from supplied repository context with these items:

- Existing data source(s) that already contain the needed fields.
- Existing API route(s) that already read or mutate the target data.
- Existing UI page(s) or reusable components that already implement the same interaction pattern.
- Existing helper/service(s) that already perform filtering, pagination, validation, export, import, or formatting.
- Any gap that truly requires new code.

If the feature touches multiple domains, the agent MUST pick the narrowest owning boundary. The patch response contains code and coverage metadata, not a prose discovery report; discovery must be reflected in the selected files and implementation.

## 6. Backend Architecture Rules

### 6.1 Data access

- Reuse the current DynamoDB tables and access patterns first.
- Initialize DynamoDB resources and table references at module scope, following the owning module's pattern. Never construct `boto3.resource()` or table clients inside a request handler or loop.
- Prefer `Query` over `Scan` whenever the data model allows it.
- Preserve pagination and continue to use `LastEvaluatedKey` or the repo’s existing pagination model.
- Do not add a new table or GSI unless the feature cannot be represented safely with the current model.
- If a new index or projection is unavoidable, document the access pattern it enables, the migration impact, and the rollback story.

### 6.2 API design

- Extend the existing route that already owns the entity, tenant, account, or import workflow.
- Register routes through the owning Flask Blueprint or FastAPI router. Do not place feature endpoints directly in an application factory when domain routers already exist.
- Keep request and response shapes backward compatible.
- Preserve the repo’s structured JSON response style and error handling conventions.
- Apply the current authentication and authorization model to every endpoint. Reads require the established read authorization; mutations require the established administrative authorization. An endpoint without the repository's required authorization is incomplete.
- Validate and sanitize request input with the repository's existing utilities. Do not expose raw provider errors or credentials.
- Put read-only/search-like behavior in the existing read path; put write behavior in the existing mutation path.
- Do not create duplicate endpoints that return the same data in a different shape unless the shape is explicitly required by the feature.
- Do not invent third-party status mappings, endpoint query parameters, or success semantics. Add an adapter at the existing integration boundary and preserve an explicit unavailable or unknown state when the upstream contract is not established.

### 6.3 Service and helper design

- Add small helper functions instead of inventing a new framework layer.
- Keep domain logic near the route or service that already owns the data.
- Prefer the existing helper pattern for pagination, formatting, validation, and response shaping.
- Prefer a thin service wrapper around existing data access over a new repository abstraction unless the current code already uses one.

### 6.4 When to use which backend host

- Use `backend/inventory` for authoritative CRUD, import workflows, bulk mutation workflows, and domain actions that already live there.
- Use `backend/gateway_api` for search, read models, filtered listings, and projection-style endpoints when the newer FastAPI surface already owns that capability.
- If the feature needs both, keep the write path authoritative in `inventory` and the read path consistent in `gateway_api`.

## 7. UI Architecture Rules

- The page MUST match the existing cloud-asset-inventory look and feel, spacing, hierarchy, iconography, and enterprise table/card patterns.
- The page MUST feel familiar to current users, with zero cognitive overload and the smallest possible number of visible choices at any moment.
- Prefer a calm, high-clarity, best-in-class enterprise interface over novelty.
- Avoid dense layouts, redundant controls, competing calls to action, and unnecessary visual noise.
- Every screen should answer: what is this, what can I do here, and what is the next safest action?
- If the feature is a new page, it MUST still behave like part of the existing app shell and include a visible link or button back to the existing Dashboard.
- The Dashboard link SHOULD be placed in the page header or primary navigation area so users can return without ambiguity.
- Reuse the existing page that already represents the domain before adding a new page.
- Reuse the current table/filter/modal pattern instead of introducing a new table framework.
- Keep filter state, pagination, and selection behavior aligned with the existing page model.
- Prefer composition of existing components over creating a new design system.
- Keep the UX consistent with the repo’s current enterprise look and feel.
- Use the shared `DataTable`, button, badge, toast, modal, popover, tooltip, and loading components already in the repo before building custom primitives.
- Preserve accessibility, keyboard behavior, and visible loading/error states.
- Do not move authoritative business logic into the frontend.

## 8. Design Patterns To Prefer

The coding agent SHOULD prefer:

- Vertical slices over horizontal layering.
- Small helper/service modules over large new abstractions.
- Adapter pattern for any new integration with existing systems.
- Command/query separation when it matches the existing code path.
- Composition over inheritance in frontend code.
- Pure transformation functions for mapping API payloads to UI-ready data.
- Existing validation and sanitization utilities over custom ad hoc validation.

The coding agent SHOULD avoid:

- Introducing a new ORM or data access layer.
- Introducing a new global state system.
- Rewriting a page just to modernize its style.
- Adding a new microservice when the current app already owns the domain.

## 9. Implementation Order

1. Inventory existing code paths and identify the minimum owning module.
2. Map every approved story and scenario to an owning implementation surface and a test surface.
3. Confirm the selected files expose enough existing behavior to implement safely; do not guess missing contracts.
4. Decide whether the feature extends an existing page or requires an approved new page and route.
5. Implement backend changes first when the feature depends on changed data or authority.
6. Wire the frontend to the existing or extended API only after the backend contract is stable.
7. Add or adjust tests in the same patch as the behavior they prove.
8. Preserve unrelated file content and verify every declared coverage path is actually patched.
9. Update docs or operational notes only when behavior or configuration changes require it.

## 10. Testing And Validation

The agent MUST validate the feature with the smallest relevant test set that proves the changed behavior.

For every approved story, tests MUST include its Given/When/Then outcomes. New backend behavior requires backend tests; new frontend behavior requires frontend tests. Frontend regression tests cannot validate backend-only behavior, and backend tests cannot validate a user-facing interaction.

Backend validation should include, when relevant:

- Targeted unit tests for helpers or services.
- Targeted API tests for request/response behavior.
- Pagination, filtering, and error-path coverage if those behaviors changed.

Frontend validation should include, when relevant:

- Targeted component or page tests.
- User-flow coverage for the changed interaction.
- Accessibility or loading/error-state coverage if the UI changed.

Repository-level validation should use the existing scripts already provided by the project, such as the current frontend `test` and `lint` commands or the repo’s Python test entrypoints.

The coding agent MUST NOT weaken, skip, delete, or replace existing assertions to make validation pass. It MUST NOT create a nominal test file without executable assertions. Where practical, tests should fail against the unchanged source and pass against the candidate.

## 11. Acceptance Standard

The change is acceptable only when all of the following are true:

- The feature works end to end in the existing application shell.
- The page matches the repository's established UI language and is intentionally low-friction for first-time and expert users.
- If the feature is a new page, it includes a working link back to the existing Dashboard.
- Existing behavior remains backward compatible unless the spec explicitly says otherwise.
- The implementation reuses the most relevant existing database, API, and UI surfaces.
- No new layer, table, endpoint, or component was introduced unless it was strictly necessary.
- Every endpoint uses the established authentication, authorization, validation, logging, and error-response patterns.
- DynamoDB access follows existing module-level initialization and Query/pagination conventions.
- Every approved story has distinct implementation evidence and executable test evidence in patched files.
- No unrelated app-factory, router, page-shell, configuration, or shared behavior was rewritten.
- The code is test-covered, readable, and easy to extend.
- The structured patch response accurately maps every story to its implementation and test paths.

## 12. Required Structured Patch Output

The executor defines the JSON response schema. The coding agent MUST:

- Return only schema-valid JSON with complete replacement content for each changed file.
- Include exactly one `storyCoverage` entry for every approved story key.
- List only patched implementation files in `implementationPaths`.
- List only patched, conventionally named test files containing executable assertions in `testPaths`.
- Keep implementation and test paths distinct.
- Use `featureSpotlight` only for a user-visible feature whose rendered root contains the matching `data-adx-feature`; otherwise use `null`.
- Never claim commands were run or verification passed. The executor, not the model, performs validation.

## 13. Failure Rules

Do not guess a new architecture or external contract when supplied context is insufficient. Do not conceal incompleteness with placeholder code, TODOs, hardcoded success values, broad exception swallowing, fabricated test coverage, or unrelated patches. A validation error is preferable to a candidate that falsely claims all stories are complete.