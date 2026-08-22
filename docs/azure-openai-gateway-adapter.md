# Azure OpenAI Reasoning Gateway Adapter

## Confirmed Contract

The UHG sample confirms that the GPT-5.6 Terra deployment uses Azure OpenAI-compatible Chat Completions with Azure AD authentication:

```text
Endpoint: https://api.uhg.com/api/cloud/api-management/ai-gateway-reasoning/1.0
API version: 2025-01-01-preview
Deployment: gpt-5.6-terra_2026-07-09
Model: gpt-5.6-terra
Project header: projectId: cebcbf08-69a0-4c1c-b8d8-ad45f2e8c5ef
Identity header: x-idp: azuread
Token scope: https://cognitiveservices.azure.com/.default
```

[apps/adx-api/azure-openai-gateway-adapter.mjs](../apps/adx-api/azure-openai-gateway-adapter.mjs) implements that contract. It constructs the standard Azure OpenAI deployment route:

```text
/openai/deployments/gpt-5.6-terra_2026-07-09/chat/completions?api-version=2025-01-01-preview
```

The route is derived from the Azure SDK usage in the supplied example. Confirm it with a harmless gateway canary before connecting it to an ADX implementation run.

## Authentication

For local development outside a UAIS application, use `InteractiveBrowserCredential`. The UHG shared-quota guidance requires an interactive Microsoft sign-in with the approved `@optum.com` identity.

For ADX running inside UAIS/AML, use `DefaultAzureCredential` instead. Do not combine the two credential flows.

Then install the required runtime package through the authenticated internal npm/Artifactory configuration:

```sh
npm install --workspace=@adx/api @azure/identity@4.6.0
```

The installation was not performed automatically because the current registry returned `E401 Incorrect or missing password`. Do not put an Artifactory password, Azure access token, client secret, or certificate private key into `.env.local` or this repository.

For a hosted ADX service, use the organization's approved workload identity or managed identity instead of a developer's Azure CLI session.

## Runtime Setup

Create the token provider inside server-only composition code:

```js
import {
  createAzureOpenAiGatewayAdapter,
  createInteractiveAzureAdTokenProvider
} from './azure-openai-gateway-adapter.mjs'

const gateway = createAzureOpenAiGatewayAdapter({
  endpoint: 'https://api.uhg.com/api/cloud/api-management/ai-gateway-reasoning/1.0',
  apiVersion: '2025-01-01-preview',
  deployment: 'gpt-5.6-terra_2026-07-09',
  model: 'gpt-5.6-terra',
  projectId: 'cebcbf08-69a0-4c1c-b8d8-ad45f2e8c5ef',
  tokenProvider: createInteractiveAzureAdTokenProvider({
    tenantId: 'db05faca-c82a-4b9d-b9c5-0f64b6755421'
  })
})
```

For ADX hosted in UAIS/AML, replace `createInteractiveAzureAdTokenProvider(...)` with `createDefaultAzureAdTokenProvider()`.

The adapter uses the standard Azure OpenAI Entra ID contract by default: `Authorization: Bearer <Azure AD token>`. It always adds `projectId` and `x-idp: azuread`. A gateway that explicitly requires `api-key` can opt into `credentialHeaderName: 'api-key'`; do not make that override without the approved UHG contract. The token is never returned, logged, included in errors, or stored in a Change Case.

For the GPT-5.6 Terra reasoning deployment, the adapter translates its bounded `maxTokens` input to the gateway's required `max_completion_tokens` field. It does not send the unsupported legacy `max_tokens` field. GPT-5.6 Terra accepts `temperature: 1`; the adapter defaults to that value, and callers must not send lower temperatures for this deployment.

## ADX Story Preview Setup

ADX can use the gateway for its bounded Story decomposition preview without granting the model repository, shell, browser-credential, approval, state-transition, or delivery authority. Configure the ADX API process, not the browser:

```sh
export ADX_STORY_AI_PROVIDER=uhg
export ADX_STORY_AI_MODEL=gpt-5.6-terra
export ADX_UHG_AZURE_OPENAI_ENDPOINT=https://api.uhg.com/api/cloud/api-management/ai-gateway-reasoning/1.0
export ADX_UHG_AZURE_OPENAI_API_VERSION=2025-01-01-preview
export ADX_UHG_AZURE_OPENAI_DEPLOYMENT=gpt-5.6-terra_2026-07-09
export ADX_UHG_AZURE_OPENAI_PROJECT_ID=cebcbf08-69a0-4c1c-b8d8-ad45f2e8c5ef
```

Choose exactly one credential mode:

```sh
# Local ADX process outside UAIS. The first Story-preview request opens Microsoft sign-in.
export ADX_UHG_AZURE_AUTH_MODE=interactive
export ADX_UHG_AZURE_TENANT_ID=db05faca-c82a-4b9d-b9c5-0f64b6755421
```

```sh
# ADX hosted in UAIS/AML. Do not set the local interactive mode or tenant setting.
export ADX_UHG_AZURE_AUTH_MODE=aml
```

Do not set `ADX_STORY_AI_API_KEY` for this provider and do not store an Azure AD token in `.env.local`. The API accepts only the server-configured model. Authors may select that approved model in the Story workshop, but supplied model endpoints, credentials, project identifiers, or provider routing are never accepted from the browser.

## First Canary

Use a harmless, non-sensitive prompt before any repository context is sent:

```js
await gateway.complete({
  system: 'Answer with one short sentence.',
  prompt: 'Reply with the word ready.',
  correlationId: crypto.randomUUID(),
  maxTokens: 32,
  temperature: 0
})
```

Retain only the HTTP outcome, provider request ID, token usage, and response digest. Do not retain the Azure AD token or complete prompt/response by default.

## ADX Boundary

This adapter supplies reasoning only. It does not execute shell commands, access a worktree, push Git branches, merge, release, or deploy. A later provider-runner layer must translate model output into lease-authorized ADX tool actions, create the disposable candidate, and send that candidate to independent verification.