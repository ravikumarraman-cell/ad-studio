import { ChangeCaseError, sha256 } from './change-case-ledger.mjs'

const defaultScope = 'https://cognitiveservices.azure.com/.default'
const supportedCredentialHeaders = new Set(['api-key', 'authorization'])
const transientGatewayStatuses = new Set([502, 503, 504])
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
    async complete({ system, prompt, correlationId, maxTokens = 2_000, temperature = 1, responseSchema = null }) {
      if (!configured) throw new ChangeCaseError('AZURE_OPENAI_GATEWAY_NOT_CONFIGURED', 'The Azure OpenAI gateway adapter requires its approved endpoint, deployment, project ID, Azure AD token provider, and fetch implementation.', { severity: 'warning' })
      const request = normalizeRequest({ system, prompt, correlationId, maxTokens, temperature, responseSchema })
      const accessToken = await tokenProvider({ scope: defaultScope, audience: gateway.origin, deployment: configuration.deployment, projectId: configuration.projectId, correlationId: request.correlationId })
      if (!validToken(accessToken)) throw new ChangeCaseError('AZURE_OPENAI_GATEWAY_CREDENTIAL_UNAVAILABLE', 'Azure AD did not provide a usable Cognitive Services access token.', { severity: 'warning' })
      // Some gateway routes close or poison an HTTP/1.1 connection after a 400.
      // Compatibility negotiation intentionally follows a rejected request with a
      // corrected one, so make every request self-contained rather than allowing
      // the retry to inherit that connection's state.
      const headers = Object.freeze({ accept: 'application/json', 'content-type': 'application/json', connection: 'close', 'x-client-request-id': request.correlationId, projectId: configuration.projectId, 'x-idp': 'azuread', [configuration.credentialHeaderName]: credentialValue(configuration.credentialHeaderName, accessToken) })
      const baseBody = { model: configuration.model, messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.prompt }], max_completion_tokens: request.maxTokens, temperature: request.temperature }
      const { response, payload } = await sendCompatibleGatewayRequest(fetchImpl, gateway.url, headers, { ...baseBody, ...(request.responseSchema ? { response_format: { type: 'json_schema', json_schema: request.responseSchema } } : {}) })
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

function normalizeRequest({ system, prompt, correlationId, maxTokens, temperature, responseSchema }) {
  if (!messageText(system, maxSystemCharacters) || !messageText(prompt, maxPromptCharacters) || !token(correlationId) || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8_192 || !Number.isFinite(temperature) || temperature < 0 || temperature > 1) throw new ChangeCaseError('AZURE_OPENAI_GATEWAY_REQUEST_INVALID', 'Azure OpenAI gateway requests require bounded system, prompt, correlation, token, and temperature values.', { severity: 'warning' })
  const normalizedSchema = normalizeResponseSchema(responseSchema)
  return Object.freeze({ system: String(system).trim(), prompt: String(prompt).trim(), correlationId: String(correlationId).trim(), maxTokens, temperature, responseSchema: normalizedSchema })
}

function normalizeResponseSchema(value) {
  if (value === null || value === undefined) return null
  if (!value || typeof value !== 'object' || !token(value.name) || value.strict !== true || !value.schema || typeof value.schema !== 'object') throw new ChangeCaseError('AZURE_OPENAI_GATEWAY_REQUEST_INVALID', 'Structured-output requests require a named strict JSON Schema.', { severity: 'warning' })
  return Object.freeze({ name: String(value.name).trim(), strict: true, schema: value.schema })
}

async function sendGatewayRequest(fetchImpl, url, headers, body) {
  let lastError = null
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let response
    try {
      response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body) })
    } catch {
      lastError = new ChangeCaseError('AZURE_OPENAI_GATEWAY_UNAVAILABLE', 'The configured Azure OpenAI gateway could not be reached.', { retryable: true, severity: 'warning' })
      if (attempt < 2) continue
      throw lastError
    }
    const payload = await response.json().catch(() => null)
    if (!transientGatewayStatuses.has(response.status)) return { response, payload }
    lastError = new ChangeCaseError('AZURE_OPENAI_GATEWAY_REQUEST_FAILED', failureMessage(response.status), { retryable: true, severity: 'warning', details: { provider: 'AZURE_OPENAI_GATEWAY', providerStatus: response.status, providerRequestId: response.headers.get('x-request-id') ?? response.headers.get('x-ms-request-id') ?? response.headers.get('apim-request-id') ?? null, gatewayError: safeGatewayError(payload?.error) } })
    if (attempt < 2) continue
    return { response, payload }
  }
  throw lastError ?? new ChangeCaseError('AZURE_OPENAI_GATEWAY_UNAVAILABLE', 'The configured Azure OpenAI gateway could not be reached.', { retryable: true, severity: 'warning' })
}

async function sendCompatibleGatewayRequest(fetchImpl, url, headers, body) {
  let currentBody = body
  let result
  const applied = new Set()
  for (let attempt = 0; attempt < 4; attempt += 1) {
    result = await sendGatewayRequest(fetchImpl, url, headers, currentBody)
    const adjustment = compatibleBodyAdjustment(result.response, result.payload, currentBody)
    if (!adjustment || applied.has(adjustment.kind)) return result
    applied.add(adjustment.kind)
    currentBody = adjustment.body
  }
  return result
}

function compatibleBodyAdjustment(response, payload, body) {
  if (rejectsTemperatureValue(response, payload) && Object.hasOwn(body, 'temperature')) return { kind: 'temperature', body: withoutTemperature(body) }
  if (rejectsStructuredOutput(response, payload, body) && Object.hasOwn(body, 'response_format')) return { kind: 'response_format', body: withoutResponseFormat(body) }
  if (rejectsMaxCompletionTokens(response, payload) && Object.hasOwn(body, 'max_completion_tokens')) return { kind: 'max_completion_tokens', body: legacyTokenBody(body) }
  return null
}

function rejectsStructuredOutput(response, payload, body) {
  if (!body.response_format || response.status !== 400) return false
  const parameter = String(payload?.error?.param ?? '').trim().toLowerCase()
  return parameter === 'response_format' || parameter === 'json_schema' || parameter.startsWith('response_format.') || parameter.startsWith('json_schema.')
}

function rejectsMaxCompletionTokens(response, payload) { return response.status === 400 && String(payload?.error?.param ?? '').trim().toLowerCase() === 'max_completion_tokens' }
function legacyTokenBody(body) { const { max_completion_tokens: maxTokens, ...legacy } = body; return { ...legacy, max_tokens: maxTokens } }
function rejectsTemperatureValue(response, payload) { return response.status === 400 && String(payload?.error?.code ?? '').trim().toLowerCase() === 'unsupported_value' && String(payload?.error?.param ?? '').trim().toLowerCase() === 'temperature' }
function withoutTemperature(body) { const { temperature: _temperature, ...request } = body; return request }
function withoutResponseFormat(body) { const { response_format: _responseFormat, ...request } = body; return request }

function normalizeUsage(usage) { return Object.freeze({ inputTokens: Number.isInteger(usage?.prompt_tokens) ? usage.prompt_tokens : null, outputTokens: Number.isInteger(usage?.completion_tokens) ? usage.completion_tokens : null, totalTokens: Number.isInteger(usage?.total_tokens) ? usage.total_tokens : null }) }
function safeFinishReason(value) { return ['stop', 'length', 'content_filter'].includes(value) ? value : null }
function credentialValue(headerName, accessToken) { return headerName === 'authorization' ? `Bearer ${accessToken}` : accessToken }
function safeGatewayError(error) { if (!error || typeof error !== 'object') return null; const detail = {}; for (const field of ['code', 'type', 'param']) if (token(error[field])) detail[field] = String(error[field]).trim(); return Object.keys(detail).length ? Object.freeze(detail) : null }
function safeCompletionSummary(payload) { const choice = payload?.choices?.[0]; const content = choice?.message?.content; return Object.freeze({ choiceCount: Array.isArray(payload?.choices) ? payload.choices.length : 0, finishReason: token(choice?.finish_reason) ? String(choice.finish_reason).trim() : null, contentType: content === null ? 'null' : Array.isArray(content) ? 'array' : typeof content, contentLength: typeof content === 'string' ? content.length : null, hasReasoningContent: Boolean(choice?.message?.reasoning_content) }) }
function failureMessage(status) { if (status === 401 || status === 403) return 'The Azure OpenAI gateway rejected ADX Azure AD credentials or project access. Verify the approved Azure AD credential, shared-quota project access, and gateway routing.'; if (status === 404) return 'The Azure OpenAI gateway route or deployment is unavailable. Verify the reasoning endpoint, deployment name, and API version.'; if (status === 429) return 'The Azure OpenAI gateway quota is temporarily exhausted. Retry after the gateway rate limit resets.'; return 'The Azure OpenAI gateway did not return a usable model response.' }
function messageText(value, maximumLength) { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maximumLength && !value.includes('\u0000') }
function token(value) { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 4_000 && !/[\r\n]/.test(value) }
function validToken(value) { return typeof value === 'string' && value.trim().length > 20 && !/[\r\n]/.test(value) }
