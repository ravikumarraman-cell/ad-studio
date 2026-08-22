import { ChangeCaseError, sha256 } from './change-case-ledger.mjs'

const supportedCredentialHeaders = new Set(['authorization', 'x-api-key', 'api-key', 'ocp-apim-subscription-key'])

/**
 * Transport for an Anthropic Messages-compatible enterprise gateway. It owns
 * no credentials: a server-side callback supplies a short-lived header for
 * each request, and neither the header nor its value is retained in receipts.
 */
export function createAnthropicGatewayAdapter({ endpoint, requestPath = '/v1/messages', deployment, projectId, credentialForRequest, routingHeaders = {}, anthropicVersion = '2023-06-01', fetchImpl = globalThis.fetch } = {}) {
  const gateway = normalizeGateway(endpoint, requestPath)
  const configuration = normalizeConfiguration({ deployment, projectId, routingHeaders, anthropicVersion })
  const configured = Boolean(gateway && configuration && typeof credentialForRequest === 'function' && fetchImpl)
  return Object.freeze({
    status: () => Object.freeze({ configured, provider: configured ? 'ANTHROPIC_GATEWAY' : null, deployment: configured ? configuration.deployment : null, projectId: configured ? configuration.projectId : null, endpoint: configured ? gateway.origin : null }),
    async complete({ system, prompt, correlationId, maxTokens = 2_000, temperature = 0.2 }) {
      if (!configured) throw new ChangeCaseError('ANTHROPIC_GATEWAY_NOT_CONFIGURED', 'The Anthropic gateway adapter requires a secure HTTPS endpoint, deployment, project ID, routing headers, and server-side credential provider.', { severity: 'warning' })
      const request = normalizeRequest({ system, prompt, correlationId, maxTokens, temperature })
      const credential = normalizeCredential(await credentialForRequest({ audience: gateway.origin, deployment: configuration.deployment, projectId: configuration.projectId, correlationId: request.correlationId }))
      const headers = Object.freeze({
        accept: 'application/json',
        'content-type': 'application/json',
        'anthropic-version': configuration.anthropicVersion,
        'x-client-request-id': request.correlationId,
        ...configuration.routingHeaders,
        [credential.headerName]: credential.value
      })
      const body = { model: configuration.deployment, max_tokens: request.maxTokens, temperature: request.temperature, system: request.system, messages: [{ role: 'user', content: request.prompt }] }
      let response
      try { response = await fetchImpl(gateway.url, { method: 'POST', headers, body: JSON.stringify(body) }) } catch { throw new ChangeCaseError('ANTHROPIC_GATEWAY_UNAVAILABLE', 'The configured Anthropic gateway could not be reached.', { retryable: true, severity: 'warning' }) }
      const payload = await response.json().catch(() => null)
      const providerRequestId = response.headers.get('x-request-id') ?? response.headers.get('x-correlation-id') ?? response.headers.get('apim-request-id') ?? null
      if (!response.ok) throw new ChangeCaseError('ANTHROPIC_GATEWAY_REQUEST_FAILED', gatewayFailureMessage(response.status), { retryable: response.status === 429 || response.status >= 500, severity: 'warning', details: { provider: 'ANTHROPIC_GATEWAY', providerStatus: response.status, providerRequestId } })
      const text = payload?.content?.filter((item) => item?.type === 'text').map((item) => item.text).join('')
      if (typeof text !== 'string' || !text.trim()) throw new ChangeCaseError('ANTHROPIC_GATEWAY_RESPONSE_INVALID', 'The Anthropic gateway returned no text content.', { retryable: true, severity: 'warning' })
      return Object.freeze({ provider: 'ANTHROPIC_GATEWAY', deployment: configuration.deployment, projectId: configuration.projectId, text, providerRequestId, usage: normalizeUsage(payload?.usage), responseDigest: sha256({ deployment: configuration.deployment, text, usage: normalizeUsage(payload?.usage) }) })
    }
  })
}

function normalizeGateway(endpoint, requestPath) {
  try {
    const origin = new URL(endpoint)
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return null
    if (typeof requestPath !== 'string' || !requestPath.startsWith('/') || requestPath.includes('..') || requestPath.includes('?') || requestPath.includes('#')) return null
    return Object.freeze({ origin: origin.origin, url: new URL(requestPath, origin).toString() })
  } catch { return null }
}

function normalizeConfiguration({ deployment, projectId, routingHeaders, anthropicVersion }) {
  if (!token(deployment) || !token(projectId) || !token(anthropicVersion) || !routingHeaders || typeof routingHeaders !== 'object' || Array.isArray(routingHeaders)) return null
  const normalizedHeaders = {}
  for (const [name, value] of Object.entries(routingHeaders)) {
    const headerName = String(name).trim().toLowerCase()
    if (!/^[a-z0-9-]+$/.test(headerName) || !token(value) || ['authorization', 'x-api-key', 'api-key', 'ocp-apim-subscription-key', 'content-type', 'anthropic-version'].includes(headerName)) return null
    normalizedHeaders[headerName] = String(value).trim()
  }
  return Object.freeze({ deployment: String(deployment).trim(), projectId: String(projectId).trim(), routingHeaders: Object.freeze(normalizedHeaders), anthropicVersion: String(anthropicVersion).trim() })
}

function normalizeCredential(value) {
  const headerName = String(value?.headerName ?? '').trim().toLowerCase()
  if (!supportedCredentialHeaders.has(headerName) || !token(value?.value)) throw new ChangeCaseError('ANTHROPIC_GATEWAY_CREDENTIAL_UNAVAILABLE', 'The Anthropic gateway credential provider did not return an approved request credential.', { severity: 'warning' })
  return Object.freeze({ headerName, value: String(value.value).trim() })
}

function normalizeRequest({ system, prompt, correlationId, maxTokens, temperature }) {
  if (!token(system) || !token(prompt) || !token(correlationId) || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8_192 || !Number.isFinite(temperature) || temperature < 0 || temperature > 1) throw new ChangeCaseError('ANTHROPIC_GATEWAY_REQUEST_INVALID', 'Anthropic gateway requests require bounded system, prompt, correlation, token, and temperature values.', { severity: 'warning' })
  return Object.freeze({ system: String(system).trim(), prompt: String(prompt).trim(), correlationId: String(correlationId).trim(), maxTokens, temperature })
}

function normalizeUsage(usage) { return Object.freeze({ inputTokens: Number.isInteger(usage?.input_tokens) ? usage.input_tokens : null, outputTokens: Number.isInteger(usage?.output_tokens) ? usage.output_tokens : null }) }
function gatewayFailureMessage(status) { if (status === 401 || status === 403) return 'The Anthropic gateway rejected ADX credentials or project access. Verify the server-side credential grant and approved project routing.'; if (status === 404) return 'The Anthropic gateway route or deployment is unavailable. Verify the gateway request path and approved deployment name.'; if (status === 429) return 'The Anthropic gateway quota is temporarily exhausted. Retry after the gateway rate limit resets.'; return 'The Anthropic gateway did not return a usable model response.' }
function token(value) { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 4_000 && !/[\r\n]/.test(value) }