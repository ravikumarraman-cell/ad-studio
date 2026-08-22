# ADX Studio

## Software deserves a memory

Modern teams can generate code in seconds. The difficult part is knowing whether a change is safe, authorized, reviewed, and still explainable months later.

A request becomes a ticket. A ticket becomes a branch. A branch becomes a deployment. Along the way, the reason for the change, the assumptions behind it, the people who approved it, the exact evidence that was checked, and the outcome it produced can drift across chat threads, dashboards, and human memory.

**ADX Studio is built to close that gap.** It is a governed software-delivery control plane that gives every meaningful change one durable home: a **Change Case**. The Change Case retains intent, risk, decisions, evidence, delivery context, and outcome as one connected, tenant-scoped record.

ADX does not ask people to trust a model response, an agent transcript, or a green checkmark as proof. It asks a sharper question:

> What evidence authorizes this exact change, and can an independent person verify it?

That principle makes AI-assisted delivery more useful without making it less accountable. People retain authority. Policies stay explicit. Agents receive bounded permissions. Evidence is tied to the exact artifact under review.

```mermaid
flowchart LR
  A[Reviewed intent] --> B[Change Case]
  B --> C[Risk and story decision]
  C --> D[Design and security decision]
  D --> E[Bounded execution]
  E --> F[Independent evidence]
  F --> G[Delivery and outcome]
```

## Start here

| Your goal | What to do |
| --- | --- |
| See why ADX exists | Run the **Guided demo**. It takes one command sequence, needs no account, and writes no data. |
| Run a complete, small reference application | Build and smoke-test **Health-X**, the fictional TanStack Start delivery slice with three user-facing features. |
| Develop the real control plane | Start PostgreSQL and MinIO, configure `.env.local`, migrate, then run the API and UI. |
| Understand the governance model | Read the [ADX main flow](docs/adx-main-flow.md). |
| Configure and use Gate D locally | Read the [independent verifier guide](docs/independent-verifier.md). |
| Check the implementation boundary | Read [implementation status](docs/implementation-status.md). |

### The five-minute demo

```bash
git clone https://github.com/ravikumarraman-cell/ad-studio.git
cd ad-studio
npm install
npm run dev
```

Open <http://127.0.0.1:4173> and choose **Guided demo**. You can now explore the complete journey without Docker, a database, OAuth, or credentials.

> The health-authorization scenario is fictional. It is a product demonstration, not a clinical decision-support system. Do not use it for real patient, member, or protected health information.

### Health-X reference delivery

Health-X is the smallest end-to-end application in this repository: a polished, fictional personal-care dashboard built with TanStack Start. It is designed to demonstrate the kind of bounded feature delivery ADX can govern without collecting or handling real health information.

It includes three deliberately small features:

1. **Upcoming care:** a fictional next appointment and browser-local check-in state.
2. **Medication check-in:** two fictional daily items with session-only completion state.
3. **Care plan:** a small fictional wellbeing checklist with visible progress.

Build and verify the production artifact from the repository root:

```bash
npm install
npm run health-x:build
npm run verify:health-x
```

`verify:health-x` starts the built Node artifact on an isolated local port, confirms that the application shell and all three feature surfaces render, confirms the fictional-data boundary, then stops the server. Run the app interactively with `npm run health-x:dev`, normally at <http://127.0.0.1:3000>.

Health-X contains no account, API, database, analytics, external network dependency, or persisted health data. It is not a clinical system and does not provide medical advice. For source layout, local container instructions, and reconstruction from a clean clone, see [Health-X](apps/health-x/README.md). For the complete ADX gate-by-gate evidence record, see [Health-X ADX delivery record](docs/health-x-adx-delivery.md).

#### What has been demonstrated

| Claim | Current evidence |
| --- | --- |
| The three Health-X features are implemented. | Tracked TanStack Start source and passing production build. |
| Health-X renders as a production Node artifact. | `npm run health-x:build` and `npm run verify:health-x`. |
| Health-X can be locally containerized. | Tracked [Dockerfile](apps/health-x/Dockerfile); build it with Docker Desktop running. |
| A live external agent ran under an ADX lease or deployed Health-X to a provider. | A local opt-in coding-agent pilot now issues a lease, creates a disposable candidate, retains a run receipt, and opens independent verification. It is not configured by default, has no provider credential/egress integration, and has not been demonstrated against a live provider. Git delivery remains preview-only and release adapters remain simulation-only. |

This distinction matters. A passing local build is meaningful implementation evidence; it is not a substitute for a retained agent lease, independent verifier bundle, reviewed delivery preview, authorized non-production rollout, or outcome evidence.

## What ADX protects

| Without a control plane | With ADX |
| --- | --- |
| A prompt or ticket can be mistaken for permission. | Authority is an explicit, server-side decision. |
| Approval becomes ambiguous when the artifact changes. | Decisions bind to the exact artifact digest and invalidate when it changes. |
| An agent can inherit more access than its task requires. | A signed, expiring lease bounds time, budget, network, repository, and capabilities. |
| Implementer activity can be confused with independent proof. | A fresh, read-only verifier produces a separate evidence bundle. |
| An external webhook can be retried blindly after failure. | Duplicate, delayed, and ambiguous observations are reconciled deliberately. |
| A release can be remembered as successful without an outcome. | A durable outcome record completes the Change Case. |

## How ADX can shorten feature-to-delivery time

ADX is designed to shorten the elapsed time from a feature requirement to a **release-ready, governed change**. The claim is not that a model makes engineering instant, or that approval and release controls should be removed. The claim is that ADX reduces avoidable queue time, repeated clarification, and late rework while retaining the controls that make a release defensible.

### The causal mechanisms

| Common source of delay | ADX mechanism | Why elapsed time can fall without weakening the gate |
| --- | --- | --- |
| Requirements, risk, decisions, and evidence are scattered across tickets, chat, CI, and review tools. | A tenant-scoped Change Case retains intent, source material, risk explanation, story contract, design package, evidence, delivery context, and outcome. | A reviewer can decide from one current record instead of reconstructing context or waiting for status updates from several systems. |
| Ambiguous requirements are discovered after implementation starts. | Retained intent, explainable risk classification, and editable BDD story contracts are independently approved before design and execution. Optional AI suggestions accelerate drafting but are not saved until a person curates and submits them. | More uncertainty is resolved while revision cost is low; a changed story digest invalidates the old approval rather than letting stale assumptions travel downstream. |
| Security, migration, dependency, and verification concerns arrive late in review. | The versioned design package requires architecture, interface/schema, migration, threats and residual risk, dependencies/licenses, and test strategy before independent design approval. | The reviewer sees the complete decision frame at one gate, with visible blockers, instead of scheduling a sequence of rediscovery loops. |
| Coding automation waits for broad access, then produces work that cannot be safely trusted. | Execution is bounded by a signed lease with repository, capability, time, budget, network, and workspace limits. | Delegation can begin from an explicit authorization boundary; it does not require a person to manually supervise every low-level action or accept unbounded agent risk. |
| “Tests passed” and “ready to release” are inferred from implementer activity. | A fresh, read-only verifier produces candidate-digest-pinned independent evidence; later delivery decisions bind to exact preview and evidence digests. | Failed or stale evidence stops at the responsible gate, reducing late-stage rework and clarification before delivery. |
| Retries and provider events create ambiguous delivery status. | Idempotency, immutable plans, deduplication, reconciliation, and retained outcome records make status explicit. | Teams spend less time determining whether a change actually happened and can respond to a known state rather than guessing. |

The relevant lead-time model is:

```text
Feature-to-release-ready time
  = active discovery + active engineering + active verification
  + handoff/queue time + rework from late discovery + status-reconciliation time
```

ADX does not claim to reduce the intrinsic work required to understand a difficult change, implement it, or verify it. It targets the final three terms: unnecessary handoffs, preventable late rework, and ambiguous status. For appropriately scoped work, those terms are often where calendar time accumulates.

### What ADX can and cannot claim today

**Defensible now:** the local control plane can produce a durable, independently reviewable, digest-bound path from feature intent through a release-ready candidate. Its workflow, authorization boundaries, invalidation behavior, verification evidence, and preview-delivery controls are implemented and verified in the repository.

**Not yet defensible as a measured fact:** a percentage reduction in production lead time, deployment frequency, change-failure rate, or mean time to restore. ADX's current Git/CI flow is preview-only, and its controlled-release adapters are simulation-only pending an approved non-production provider integration and environment-specific operational evidence. It must not be described as already accelerating production releases.

### How to prove the claim in an organization

Run a time-bounded baseline and comparison using the same feature classes, risk tiers, repositories, and release policies. Do not compare a simple copy change using ADX with a high-risk migration using the existing process.

1. Define timestamps from retained events: requirement accepted, story approved, design approved, execution started, candidate verified, delivery-ready, authorized release, and production outcome.
2. Measure median and p90 elapsed time for each transition and for the full requirement-to-release interval. Segment by risk tier, change size, team, and repository.
3. Measure the mechanisms, not only the outcome: approval wait time, number of requirement/design revisions, time spent awaiting clarification, verification failures, reconciliation events, and rollback or incident rate.
4. Use a matched pilot, randomized rollout where practical, or a stepped-wedge adoption across comparable teams. Keep the same independent-approval and release-policy requirements in both groups.
5. Treat an improvement as credible only when lead-time improvement does not come with worse change-failure rate, rollback rate, security findings, policy exceptions, or reviewer-comprehension results.

The success criterion is therefore not “ship faster at any cost.” It is a statistically and operationally supported reduction in elapsed delivery time while safety, reproducibility, approval clarity, and outcome quality remain at least as good as the baseline.

## Run ADX

### Before you begin

| Requirement | Supported / expected version | Why it is needed |
| --- | --- | --- |
| Node.js | `>=22.19.0 <23` | Runtime for the API, workspace tools, and TanStack/Vite client |
| npm | Bundled with the supported Node.js release | Installs the npm workspaces |
| Docker Desktop | Current stable version | Runs local PostgreSQL and MinIO for Real mode |
| Google OAuth client | Optional, required only for authenticated Real mode | Signs a user into the local API |
| Browser | Current Chromium, Firefox, or Safari | Runs the UI; Chromium is used by browser checks |

Check the local toolchain:

```bash
node --version
npm --version
docker --version
docker compose version
```

### Guided demo, in detail

This is the shortest path to see the workflow. It writes no data and requires no Docker, database, or OAuth configuration. If you used the five-minute demo above, you are already here.

```bash
git clone https://github.com/ravikumarraman-cell/ad-studio.git
cd ad-studio
npm install
npm run dev
```

Open the Vite address printed by the command, normally <http://127.0.0.1:4173>. Choose **Guided demo** on the opening screen.

The root `dev` script starts `apps/health-authorization-demo`. To stop it, press `Ctrl+C` in that terminal.

### Demo journey

1. Choose Guided demo.
2. Import the sample feature file or select a sample Change Case.
3. Follow the Gate A, A.5, and B-F workflow map.
4. Open the review surfaces to inspect recorded context, evidence, delivery preview, and outcome state.

The demo intentionally simulates the journey. It does not create durable ADX records or grant authorization.

### Run the local control plane

Use this path when you need durable local records and the API-backed UI.

#### 1. Install dependencies

From the repository root:

```bash
npm install
```

The root package uses npm workspaces for `apps/*` and `packages/*`. Run installation from the root so shared dependencies are available to every workspace.

#### 2. Start local services

Start PostgreSQL and MinIO:

```bash
docker compose up -d postgres minio
docker compose ps
```

Expected local endpoints:

| Service | Address | Local credentials |
| --- | --- | --- |
| PostgreSQL | `postgresql://adx:adx_local_only@127.0.0.1:5432/adx` | User `adx`, password `adx_local_only` |
| MinIO S3 API | <http://127.0.0.1:9000> | `adx-local` / `adx-local-change-before-shared` |
| MinIO console | <http://127.0.0.1:9001> | `adx-local` / `adx-local-change-before-shared` |

These credentials exist only for the local compose environment. Change them before sharing any environment configuration.

#### 3. Create local configuration

Create an ignored `.env.local` file at the repository root. The API loader reads it when `npm run api:dev` starts and does not override values that CI or your shell already provides.

For local database-backed development, begin with:

```dotenv
DATABASE_URL=postgresql://adx:adx_local_only@127.0.0.1:5432/adx
ADX_UI_ORIGIN=http://127.0.0.1:4173/
```

Add the authenticated-mode values described in the next section before attempting login. Keep `.env.local` private and never commit provider tokens or signing keys.

#### 4. Apply database migrations

```bash
npm run migrate:stage2
```

Despite its historical name, this applies the ordered ADX migrations through Stage 10 from `apps/adx-api/db/001_tenant_rls.sql` through `apps/adx-api/db/012_context_graph.sql`.

#### 5. Start the API

In one terminal:

```bash
npm run api:dev
```

The API binds to `http://127.0.0.1:3100` by default. Confirm its basic health:

```bash
curl http://127.0.0.1:3100/healthz
curl http://127.0.0.1:3100/readyz
```

Both endpoints should return a JSON response with an `ok` or `ready` status. Set `PORT` before starting the API to use another port.

#### 6. Start the UI

In a second terminal, from the repository root:

```bash
npm run dev
```

Open <http://127.0.0.1:4173> and select **Real mode**. The Vite client proxies `/v1`, `/auth`, and `/control-plane` to the API at port `3100`.

### Configure authenticated Real mode

Real mode is deny-by-default. A user must authenticate through Google OIDC and have a local workspace membership before the control plane exposes tenant data.

#### Google OAuth setup

Create a Google OAuth web application for local development and add this authorized redirect URI:

```text
http://127.0.0.1:3100/auth/callback
```

Then add the following to `.env.local`:

```dotenv
ADX_OIDC_ISSUER=https://accounts.google.com
ADX_OIDC_AUDIENCE=YOUR_GOOGLE_OAUTH_CLIENT_ID
ADX_OIDC_CLIENT_SECRET=YOUR_GOOGLE_OAUTH_CLIENT_SECRET
ADX_OIDC_REDIRECT_URI=http://127.0.0.1:3100/auth/callback
ADX_UI_ORIGIN=http://127.0.0.1:4173/
```

`ADX_OIDC_AUDIENCE` is the OAuth client ID in this local Google adapter. The API uses Google's published JWKS endpoint by default; set `ADX_OIDC_JWKS_URI` only when using a different compatible identity setup.

If a local configuration already sets `ADX_OIDC_JWKS_URI`, it must use Google’s signing-key endpoint rather than an issuer-relative URL:

```dotenv
ADX_OIDC_JWKS_URI=https://www.googleapis.com/oauth2/v3/certs
```

#### Ledger signing key

Durable Change Case, execution, and evidence operations require an Ed25519 signing key. Point the API at local PEM files instead of placing private key material inline:

```dotenv
ADX_LEDGER_SIGNING_KEY_ID=adx-local-ed25519
ADX_LEDGER_SIGNING_PRIVATE_KEY_FILE=/absolute/path/to/adx-local-private.pem
ADX_LEDGER_SIGNING_PUBLIC_KEY_FILE=/absolute/path/to/adx-local-public.pem
```

Alternatively, the API accepts `ADX_LEDGER_SIGNING_PRIVATE_KEY_PEM` and `ADX_LEDGER_SIGNING_PUBLIC_KEY_PEM`. Do not use test-only authentication outside automated tests; `ADX_TEST_AUTH=1` exists for the repository's isolated test suites.

#### Provision a local membership

After completing Google login once, determine the principal ID emitted by the API or use the required Google subject format. Then grant that principal access to the default local workspace:

```bash
npm run provision:local-user -- 'oidc:https://accounts.google.com:YOUR_GOOGLE_SUBJECT'
```

The default IDs are:

```text
Organization: 11111111-1111-4111-8111-111111111111
Workspace:    aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
```

Override them only when you intentionally use a different local tenancy:

```dotenv
ADX_BOOTSTRAP_ORGANIZATION_ID=your-organization-uuid
ADX_BOOTSTRAP_WORKSPACE_ID=your-workspace-uuid
```

Sign out, then start `/auth/login` again so the API issues a new session containing the provisioned membership. An unprovisioned identity has no workspace memberships by design.

### Optional AI story suggestions

The Story Generation and Curation surface works without an AI provider: users can draft and edit BDD stories manually. Optional server-side previews can be configured for `openai`, `gemini`, or `ollama`.

Example Gemini configuration:

```dotenv
ADX_STORY_AI_PROVIDER=gemini
ADX_STORY_AI_API_KEY=your_google_ai_studio_key
ADX_STORY_AI_MODEL=your_approved_model
ADX_STORY_AI_MODELS=your_approved_model,another_approved_model
```

Example local Ollama configuration:

```dotenv
ADX_STORY_AI_PROVIDER=ollama
ADX_STORY_AI_MODEL=your-installed-ollama-model
ADX_STORY_AI_MODELS=your-installed-ollama-model,another-installed-ollama-model
ADX_STORY_AI_OLLAMA_BASE_URL=http://127.0.0.1:11434
```

AI output remains a preview. A human selects and edits content before it is submitted to the versioned Story API.

## Validate the workspace

Run checks from the repository root.

| Command | What it validates |
| --- | --- |
| `npm run api:smoke` | API health, readiness, and trace-correlation endpoints on an isolated port |
| `npm run health-x:dev` | Starts the Health-X TanStack Start development server |
| `npm run health-x:build` | Produces the Health-X production Node artifact |
| `npm run verify:health-x` | Starts the built Health-X artifact, verifies all three feature surfaces and the fictional-data notice, then stops it |
| `npm run typecheck` | Stage 0 checks, feature-import checks, domain TypeScript, and UI type checking |
| `npm run build` | The complete typecheck sequence followed by a production UI build |
| `npm run verify:stage0` | Foundational workspace and runtime harness checks |
| `npm run verify:stage2:postgres` | PostgreSQL transaction, ledger, idempotency, RLS-oriented workflow, and reconciliation verification |
| `npm run verify:stage5:docker-sandbox` | Docker sandbox and escape-resistance checks; requires Docker |
| `npm run verify:stage6:object-store` | MinIO-backed evidence object-store behavior |
| `npm run verify:stage8:integration` | Validates a declared non-production release-integration profile without enabling deployment |
| `npm run verify:stage10` | Context graph isolation, provenance freshness, and specialist-role constraints |
| `npm run canary:smoke` | TanStack Start server-side rendering compatibility canary |

The stage scripts are intentionally granular. Use the check that matches the component you changed rather than treating a passing UI screen as proof of control-plane correctness.

For the usual local confidence loop after configuring PostgreSQL:

```bash
npm run migrate:stage2
npm run api:smoke
npm run verify:stage2:postgres
npm run typecheck
```

## Repository map

| Path | Purpose |
| --- | --- |
| `apps/adx-api` | Node.js API, OIDC adapter, tenant-scoped repositories, control-plane routes, database migrations, and browser tests |
| `apps/health-authorization-demo` | React/Vite experience with Guided demo and authenticated Real mode |
| `apps/health-x` | Fictional TanStack Start reference app with a professional, low-cognitive-load care dashboard and three delivered feature slices |
| `apps/tanstack-start-canary` | TanStack Start compatibility and SSR runtime canary |
| `packages/contracts` | Shared contracts and vocabulary |
| `packages/domain` | Domain types and TypeScript configuration |
| `packages/identity` | Identity-related shared code |
| `scripts` | Bootstrap, migration, local provisioning, smoke, stage verification, and integration validation scripts |
| `docs` | Workflow, UX, architecture, conformance, and operating runbooks |
| `compose.yaml` | Local PostgreSQL and MinIO services |

## Operational boundaries

ADX Studio is built to make authority explicit. In the current implementation:

- Guided demo is fictional, local, and non-writing.
- Real mode persists tenant-scoped control-plane records only when API configuration, authentication, authorization, and ledger signing are present.
- Coding-agent integrations are declaration-only and fail closed before live execution.
- Git and CI support preview and ingestion contracts; remote Git mutation, pull-request creation, merge, and release are not enabled.
- Release integrations are simulation-only and deny production profiles. An approved non-production provider configuration and explicit authorization are required before any executor could be enabled.
- Provider credentials, private signing keys, and `.env.local` belong outside source control.

## Troubleshooting

### `npm install` fails or uses an unsupported runtime

Confirm that `node --version` reports a Node 22 release in the supported range. The repository requires Node `>=22.19.0 <23`; retry installation from the repository root after switching Node versions.

### Docker services will not start

Ensure Docker Desktop is running, then inspect service state and logs:

```bash
docker compose ps
docker compose logs postgres
docker compose logs minio
```

If ports `5432`, `9000`, or `9001` are occupied, stop the conflicting service or change the mapped port in `compose.yaml` and update dependent local configuration.

### `DATABASE_URL_REQUIRED_FOR_STAGE2_MIGRATION`

The migration command needs `DATABASE_URL` in the shell or root `.env.local`. Start PostgreSQL, add the local connection string shown above, and rerun `npm run migrate:stage2`.

### API starts but Real mode cannot log in

Check all of the following:

1. `ADX_OIDC_AUDIENCE`, `ADX_OIDC_CLIENT_SECRET`, and `ADX_OIDC_REDIRECT_URI` are set.
2. The Google OAuth client permits `http://127.0.0.1:3100/auth/callback` exactly.
3. `ADX_UI_ORIGIN` is `http://127.0.0.1:4173/` including the trailing slash.
4. You restarted the API after editing `.env.local`.
5. Your Google principal received local membership through `npm run provision:local-user -- ...`.

### Real mode returns unavailable data or durable commands fail

Make sure PostgreSQL is healthy, all migrations ran successfully, and the API has both `DATABASE_URL` and a valid ledger signing-key configuration. The API deliberately does not substitute in-memory persistence for real control-plane operations.

### The UI cannot reach the API

Start `npm run api:dev` before choosing Real mode. The dev client expects the API at `127.0.0.1:3100`; if you changed `PORT`, update the Vite proxy configuration or return the API to its default port.

### Reset local infrastructure

To stop the local containers without deleting database data:

```bash
docker compose down
```

To remove container volumes and start over, use this destructive command:

```bash
docker compose down -v
```

Then restart the services and run `npm run migrate:stage2` again.

## Further documentation

- [Implementation status](docs/implementation-status.md) documents which stages are complete and which external proof is still required.
- [ADX main flow](docs/adx-main-flow.md) explains the end-to-end governed delivery workflow.
- [UX operating model](docs/adx-ux-operating-model.md) defines the interaction, accessibility, and measurement acceptance bar.
- [Health-X](apps/health-x/README.md) explains the reference application, production build, local container, and clean-clone reconstruction path.
- [Health-X ADX delivery record](docs/health-x-adx-delivery.md) tracks the three Change Cases, required Gate A-F evidence, and current proof boundary.
- [Coding-agent integration](docs/coding-agent-integration.md) describes the provider-neutral, lease-bound adapter model.
- [Stage 8 non-production release runbook](docs/runbooks/stage-8-non-production-release.md) documents the deny-by-default release-integration profile.
- [Implementation specification](ADX_TanStack_Implementation_Specification_10_10.md) is the detailed source specification for the implementation.
