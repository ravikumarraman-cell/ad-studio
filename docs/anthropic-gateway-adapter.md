# Anthropic Gateway Adapter

## Scope

[apps/adx-api/anthropic-gateway-adapter.mjs](../apps/adx-api/anthropic-gateway-adapter.mjs) is a server-side transport for an Anthropic Messages-compatible enterprise gateway. It is designed for the approved Claude Opus deployment through the UHG AI Gateway, but does not assume that the gateway uses Anthropic's public URL, authentication, or routing header names.

It is connected to ADX's bounded Story decomposition preview when its contract is fully configured. It is not connected to the implementation-run UI: a cloud model may propose an ADX-authorized action, but it must not receive direct filesystem, Git, deployment, or browser authority.

## Known Deployment Values

The current approved deployment supplies these non-secret identifiers:

```text
Gateway origin: https://api.uhg.com
Gateway base path: /api/cloud/api-management/ai-gateway/1.0
Deployment: us.anthropic.claude-opus-4-8
Project ID: cebcbf08-69a0-4c1c-b8d8-ad45f2e8c5ef
Model version: 4-8
```

The adapter needs an exact **Messages-compatible request path**. Do not assume that appending `/v1/messages` is correct. Confirm it with the UHG gateway team before setting it. The unit tests use that path only as an explicit example of an Anthropic-compatible route.

## Required Server Configuration

Store these values in the server's protected runtime configuration, not browser JavaScript or Change Case data:

```dotenv
ADX_ANTHROPIC_GATEWAY_ORIGIN=https://api.uhg.com
ADX_ANTHROPIC_GATEWAY_REQUEST_PATH=/api/cloud/api-management/ai-gateway/1.0/<confirmed-messages-route>
ADX_ANTHROPIC_GATEWAY_DEPLOYMENT=us.anthropic.claude-opus-4-8
ADX_ANTHROPIC_GATEWAY_PROJECT_ID=cebcbf08-69a0-4c1c-b8d8-ad45f2e8c5ef
ADX_ANTHROPIC_GATEWAY_ROUTING_HEADERS_JSON={"<confirmed-project-header>":"cebcbf08-69a0-4c1c-b8d8-ad45f2e8c5ef","<confirmed-deployment-header>":"us.anthropic.claude-opus-4-8"}
```

The adapter rejects non-HTTPS origins, credentials embedded in URLs, path traversal, duplicate credential headers, and malformed routing-header names.

## ADX Story Preview Setup

After UHG confirms the Messages path, routing headers, and Azure AD bearer-token compatibility, configure the ADX API process with the following server-only values:

```sh
export ADX_STORY_AI_PROVIDER=claude
export ADX_STORY_AI_MODEL=us.anthropic.claude-opus-4-8
export ADX_UHG_CLAUDE_GATEWAY_ORIGIN=https://api.uhg.com
export ADX_UHG_CLAUDE_REQUEST_PATH=/api/cloud/api-management/ai-gateway/1.0/<confirmed-messages-route>
export ADX_UHG_CLAUDE_PROJECT_ID=cebcbf08-69a0-4c1c-b8d8-ad45f2e8c5ef
export ADX_UHG_CLAUDE_ROUTING_HEADERS_JSON='{"<confirmed-project-header>":"cebcbf08-69a0-4c1c-b8d8-ad45f2e8c5ef","<confirmed-deployment-header>":"us.anthropic.claude-opus-4-8"}'
```

Choose exactly one Azure AD credential mode:

```sh
# Local ADX process outside UAIS. The first Story-preview request opens Microsoft sign-in.
export ADX_UHG_CLAUDE_AUTH_MODE=interactive
export ADX_UHG_CLAUDE_TENANT_ID=db05faca-c82a-4b9d-b9c5-0f64b6755421
```

```sh
# ADX hosted in UAIS/AML. Do not set the local interactive mode or tenant setting.
export ADX_UHG_CLAUDE_AUTH_MODE=aml
```

The integration remains disabled when the path, routing headers, or credential mode is missing. Do not set a Claude API key or Azure AD token in `.env.local`; credentials are acquired per request in server memory and never sent to the browser.

## Credential Contract

The caller supplies a fresh credential only through this server-side interface:

```js
async function credentialForRequest({ audience, deployment, projectId, correlationId }) {
  return { headerName: 'authorization', value: 'Bearer <short-lived-token>' }
}
```

Allowed credential header names are `authorization`, `x-api-key`, `api-key`, and `ocp-apim-subscription-key`. The returned value is used for one outbound request and is never included in the adapter result, digest, receipt, or error details.

## Questions for the UHG Gateway Owner

1. What is the exact HTTP request path for Claude Opus Messages requests?
2. Is the payload Anthropic Messages-compatible, OpenAI-compatible, or gateway-specific?
3. What credential method is required for local non-production use: OAuth, subscription key, mTLS, managed identity, or another approved mechanism?
4. Which exact routing headers must carry the project and deployment identifiers?
5. Must ADX send a required API-version, client application, chargeback, or data-classification header?
6. Is the ADX API host allowed to egress to `api.uhg.com`, and what TLS/corporate CA configuration is required?
7. What retention and data-handling policy applies to repository context sent through this deployment?

## Validation

The adapter has offline contract coverage in [apps/adx-api/tests/anthropic-gateway-adapter.unit.test.mjs](../apps/adx-api/tests/anthropic-gateway-adapter.unit.test.mjs):

```sh
node --test apps/adx-api/tests/anthropic-gateway-adapter.unit.test.mjs
```

Once gateway authentication and the request path are confirmed, the next step is a one-request non-production canary with a harmless prompt. Retain only its status, gateway request ID, model usage, and response digest. Do not log credentials or the complete prompt/response by default.