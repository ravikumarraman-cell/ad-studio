import { ChangeCaseError, sha256 } from './change-case-ledger.mjs'

const defaultScope = 'https://cognitiveservices.azure.com/.default'
const supportedCredentialHeaders = new Set(['api-key', 'authorization'])
const maxSystemCharacters = 16 * 1024
const maxPromptCharacters = 256 * 1024

/**
 * Azure OpenAI Chat Completions transport for the UHG reasoning gateway.
 * Credentials are loaded only when live authentication is requested; tests and
 * hosted runtimes can supply their own token provider.
 */
export function createAzureOpenAiGatewayAdapter({ endpoint, apiVersion = '2025-01-01-preview', deployment, model, projectId, tokenProvider, credentialHeaderName = 'authorization', fetchImpl = globalThis.fetch } = {}) {
  const gateway = normalizeGateway(endpoint, deployment, apiVersion)
  const configuration = normalizeConfiguration({ deployment, model, projectId, credentialHeaderName })
  const configured = Boolean(gateway && configuration && typeof tokenProvider === 'function' && fetchImpl)
  return Object.freeze({
    status: () => Object.freeze({ configured, provider: configured ? 'AZURE_OPENAI_GATEWAY' : null, deployment: configured ? configuration.deployment : null, model: configured ? configuration.model : null, projectId: configured ? configuration.projectId : null, endpoint: configured ? gateway.origin : null, apiVersion: configured ? apiVersion : null }),
    async complete({ system, prompt, correlationId, maxTokens = 2_000, temperature = 1 }) {
      if (!configured) throw new ChangeCaseError('AZURE_OPENAI_GATEWAY_NOT_CONFIGURED', 'The Azure OpenAI gateway adapter requires its approved endpoint, deployment, project ID, Azure AD token provider, and fetch implementation.', { severity: 'warning' })
      const request = normalizeRequest({ system, prompt, correlationId, maxTokens, temperature })
      const accessToken = await tokenProvider({ scope: defaultScope, audience: gateway.origin, deployment: configuration.deployment, projectId: configuration.projectId, correlationId: request.correlationId })
      if (!validToken(accessToken)) throw new ChangeCaseError('AZURE_OPENAI_GATEWAY_CREDENTIAL_UNAVAILABLE', 'Azure AD did not provide a usable Cognitive Services access token.', { severity: 'warning' })
      const headers = Object.freeze({ accept: 'application/json', 'content-type': 'application/json', 'x-client-request-id': request.correlationId, projectId: configuration.projectId, 'x-idp': 'azuread', [configuration.credentialHeaderName]: credentialValue(configuration.credentialHeaderName, accessToken) })
      const body = { model: configuration.model, messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.prompt }], max_completion_tokens: request.maxTokens, temperature: request.temperature }
      let response
      try { response = await fetchImpl(gateway.url, { method: 'POST', headers, body: JSON.stringify(body) }) } catch { throw new ChangeCaseError('AZURE_OPENAI_GATEWAY_UNAVAILABLE', 'The configured Azure OpenAI gateway could not be reached.', { retryable: true, severity: 'warning' }) }
      const payload = await response.json().catch(() => null)
      const providerRequestId = response.headers.get('x-request-id') ?? response.headers.get('x-ms-request-id') ?? response.headers.get('apim-request-id') ?? null
      if (!response.ok) throw new ChangeCaseError('AZURE_OPENAI_GATEWAY_REQUEST_FAILED', failureMessage(response.status), { retryable: response.status === 429 || response.status >= 500, severity: 'warning', details: { provider: 'AZURE_OPENAI_GATEWAY', providerStatus: response.status, providerRequestId, gatewayError: safeGatewayError(payload?.error) } })
      const text = payload?.choices?.[0]?.message?.content
      if (typeof text !== 'string' || !text.trim()) throw new ChangeCaseError('AZURE_OPENAI_GATEWAY_RESPONSE_INVALID', 'The Azure OpenAI gateway returned no assistant text.', { retryable: true, severity: 'warning', details: { provider: 'AZURE_OPENAI_GATEWAY', providerRequestId, completion: safeCompletionSummary(payload) } })
      const usage = normalizeUsage(payload?.usage)
      const finishReason = safeFinishReason(payload?.choices?.[0]?.finish_reason)
      return Object.freeze({ provider: 'AZURE_OPENAI_GATEWAY', deployment: configuration.deployment, model: configuration.model, projectId: configuration.projectId, text, providerRequestId, usage, finishReason, responseDigest: sha256({ deployment: configuration.deployment, model: configuration.model, text, usage }) })
    }
  })
}

export function createDefaultAzureAdTokenProvider() {
  let credentialPromise
  return async ({ scope = defaultScope } = {}) => {
    try {
      credentialPromise ??= import('@azure/identity').then(({ DefaultAzureCredential }) => new DefaultAzureCredential())
      const accessToken = await (await credentialPromise).getToken(scope)
      if (accessToken?.token) return accessToken.token
    } catch (error) {
      if (error?.code === 'ERR_MODULE_NOT_FOUND') throw new ChangeCaseError('AZURE_OPENAI_GATEWAY_IDENTITY_LIBRARY_MISSING', 'Install @azure/identity before enabling Azure AD gateway authentication.', { severity: 'warning' })
    }
    throw new ChangeCaseError('AZURE_OPENAI_GATEWAY_CREDENTIAL_UNAVAILABLE', 'The UAIS AML workload identity did not provide a Cognitive Services token. Verify the hosted identity and project access.', { retryable: true, severity: 'warning' })
  }
}

export function createInteractiveAzureAdTokenProvider({ tenantId } = {}) {
  let credentialPromise
  return async ({ scope = defaultScope } = {}) => {
    try {
      credentialPromise ??= import('@azure/identity').then(({ InteractiveBrowserCredential }) => new InteractiveBrowserCredential(tenantId ? { tenantId } : undefined))
      const accessToken = await (await credentialPromise).getToken(scope)
      if (accessToken?.token) return accessToken.token
    } catch (error) {
      if (error?.code === 'ERR_MODULE_NOT_FOUND') throw new ChangeCaseError('AZURE_OPENAI_GATEWAY_IDENTITY_LIBRARY_MISSING', 'Install @azure/identity before enabling Azure AD gateway authentication.', { severity: 'warning' })
    }
    throw new ChangeCaseError('AZURE_OPENAI_GATEWAY_CREDENTIAL_UNAVAILABLE', 'Interactive Azure AD sign-in did not provide a Cognitive Services token. Sign in with the approved Optum Microsoft identity and verify project access.', { retryable: true, severity: 'warning' })
  }
}

function normalizeGateway(endpoint, deployment, apiVersion) {
  try {
    const base = new URL(endpoint)
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !token(deployment) || !token(apiVersion)) return null
    const basePath = base.pathname.replace(/\/$/, '')
    const deploymentPath = `/openai/deployments/${encodeURIComponent(String(deployment).trim())}/chat/completions`
    const url = new URL(`${basePath}${deploymentPath}`, base.origin)
    url.searchParams.set('api-version', String(apiVersion).trim())
    return Object.freeze({ origin: base.origin, url: url.toString() })
  } catch { return null }
}

function normalizeConfiguration({ deployment, model, projectId, credentialHeaderName }) {
  const header = String(credentialHeaderName ?? '').trim().toLowerCase()
  if (!token(deployment) || !token(model) || !token(projectId) || !supportedCredentialHeaders.has(header)) return null
  return Object.freeze({ deployment: String(deployment).trim(), model: String(model).trim(), projectId: String(projectId).trim(), credentialHeaderName: header })
}

function normalizeRequest({ system, prompt, correlationId, maxTokens, temperature }) {
  if (!messageText(system, maxSystemCharacters) || !messageText(prompt, maxPromptCharacters) || !token(correlationId) || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8_192 || !Number.isFinite(temperature) || temperature < 0 || temperature > 1) throw new ChangeCaseError('AZURE_OPENAI_GATEWAY_REQUEST_INVALID', 'Azure OpenAI gateway requests require bounded system, prompt, correlation, token, and temperature values.', { severity: 'warning' })
  return Object.freeze({ system: String(system).trim(), prompt: String(prompt).trim(), correlationId: String(correlationId).trim(), maxTokens, temperature })
}

function normalizeUsage(usage) { return Object.freeze({ inputTokens: Number.isInteger(usage?.prompt_tokens) ? usage.prompt_tokens : null, outputTokens: Number.isInteger(usage?.completion_tokens) ? usage.completion_tokens : null, totalTokens: Number.isInteger(usage?.total_tokens) ? usage.total_tokens : null }) }
function safeFinishReason(value) { return ['stop', 'length', 'content_filter'].includes(value) ? value : null }
function credentialValue(headerName, accessToken) { return headerName === 'authorization' ? `Bearer ${accessToken}` : accessToken }
function safeGatewayError(error) { if (!error || typeof error !== 'object') return null; const detail = {}; for (const field of ['code', 'type', 'param']) if (token(error[field])) detail[field] = String(error[field]).trim(); return Object.keys(detail).length ? Object.freeze(detail) : null }
function safeCompletionSummary(payload) { const choice = payload?.choices?.[0]; const content = choice?.message?.content; return Object.freeze({ choiceCount: Array.isArray(payload?.choices) ? payload.choices.length : 0, finishReason: token(choice?.finish_reason) ? String(choice.finish_reason).trim() : null, contentType: content === null ? 'null' : Array.isArray(content) ? 'array' : typeof content, contentLength: typeof content === 'string' ? content.length : null, hasReasoningContent: Boolean(choice?.message?.reasoning_content) }) }
function failureMessage(status) { if (status === 401 || status === 403) return 'The Azure OpenAI gateway rejected ADX Azure AD credentials or project access. Verify the approved Azure AD credential, shared-quota project access, and gateway routing.'; if (status === 404) return 'The Azure OpenAI gateway route or deployment is unavailable. Verify the reasoning endpoint, deployment name, and API version.'; if (status === 429) return 'The Azure OpenAI gateway quota is temporarily exhausted. Retry after the gateway rate limit resets.'; return 'The Azure OpenAI gateway did not return a usable model response.' }
function messageText(value, maximumLength) { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maximumLength && !value.includes('\u0000') }
function token(value) { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 4_000 && !/[\r\n]/.test(value) }
function validToken(value) { return typeof value === 'string' && value.trim().length > 20 && !/[\r\n]/.test(value) }