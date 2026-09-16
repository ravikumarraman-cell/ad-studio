import { ChangeCaseError } from './change-case-ledger.mjs'

const defaultScope = 'https://cognitiveservices.azure.com/.default'

/**
 * Creates a process-local, single-flight token cache.  Gateway transports use
 * this boundary rather than owning credential state, which keeps session reuse
 * consistent across model providers without persisting a credential anywhere.
 */
export function createCachedTokenProvider(tokenProvider, { maxAgeMs = 3_300_000, refreshSkewMs = 120_000, acquisitionTimeoutMs = 20_000, now = () => Date.now() } = {}) {
  if (typeof tokenProvider !== 'function') throw new TypeError('TOKEN_PROVIDER_REQUIRED')
  let cachedToken = null
  let cachedUntil = 0
  let inFlight = null
  return async (request) => {
    const current = now()
    if (cachedToken && current < cachedUntil) return cachedToken
    if (!inFlight) {
      inFlight = acquireTokenWithinDeadline(tokenProvider, request, acquisitionTimeoutMs)
        .then((credential) => {
          const token = tokenValue(credential)
          if (validToken(token)) {
            cachedToken = token
            cachedUntil = cacheExpiry(credential, { now: now(), maxAgeMs, refreshSkewMs })
          }
          return token
        })
        .finally(() => { inFlight = null })
    }
    return inFlight
  }
}

export function createDefaultAzureAdTokenProvider() {
  return async ({ scope = defaultScope } = {}) => {
    try {
      const accessToken = await (await defaultAzureCredential()).getToken(scope)
      if (accessToken?.token) return accessToken
    } catch (error) {
      if (error?.code === 'ERR_MODULE_NOT_FOUND') throw new ChangeCaseError('AZURE_OPENAI_GATEWAY_IDENTITY_LIBRARY_MISSING', 'Install @azure/identity before enabling Azure AD gateway authentication.', { severity: 'warning' })
    }
    throw new ChangeCaseError('AZURE_OPENAI_GATEWAY_CREDENTIAL_UNAVAILABLE', 'The UAIS AML workload identity did not provide a Cognitive Services token. Verify the hosted identity and project access.', { retryable: true, severity: 'warning' })
  }
}

export function createInteractiveAzureAdTokenProvider({ tenantId } = {}) {
  return async ({ scope = defaultScope } = {}) => {
    try {
      const accessToken = await (await interactiveAzureCredential(tenantId)).getToken(scope)
      if (accessToken?.token) return accessToken
    } catch (error) {
      if (error?.code === 'ERR_MODULE_NOT_FOUND') throw new ChangeCaseError('AZURE_OPENAI_GATEWAY_IDENTITY_LIBRARY_MISSING', 'Install @azure/identity before enabling Azure AD gateway authentication.', { severity: 'warning' })
    }
    throw new ChangeCaseError('AZURE_OPENAI_GATEWAY_CREDENTIAL_UNAVAILABLE', 'Interactive Azure AD sign-in did not provide a Cognitive Services token. Sign in with the approved Optum Microsoft identity and verify project access.', { retryable: true, severity: 'warning' })
  }
}

async function acquireTokenWithinDeadline(tokenProvider, request, timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) return tokenProvider(request)
  let timeout
  try {
    return await Promise.race([
      Promise.resolve(tokenProvider(request)),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new ChangeCaseError(
          'AZURE_OPENAI_GATEWAY_CREDENTIAL_TIMEOUT',
          'Azure AD token acquisition did not complete promptly. Complete sign-in or configure a server-owned workload identity, then retry.',
          { retryable: true, severity: 'warning' },
        )), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

let defaultCredentialPromise
const interactiveCredentialPromises = new Map()

function defaultAzureCredential() {
  defaultCredentialPromise ??= import('@azure/identity').then(({ DefaultAzureCredential }) => new DefaultAzureCredential())
  return defaultCredentialPromise
}

function interactiveAzureCredential(tenantId) {
  const key = tenantId ?? ''
  let credential = interactiveCredentialPromises.get(key)
  if (!credential) {
    credential = import('@azure/identity').then(({ InteractiveBrowserCredential }) => new InteractiveBrowserCredential(tenantId ? { tenantId } : undefined))
    interactiveCredentialPromises.set(key, credential)
  }
  return credential
}

function tokenValue(credential) { return typeof credential === 'string' ? credential : credential?.token }
function validToken(value) { return typeof value === 'string' && value.trim().length > 20 && !/[\r\n]/.test(value) }
function cacheExpiry(credential, { now, maxAgeMs, refreshSkewMs }) {
  const boundedMaxAge = Number.isFinite(maxAgeMs) && maxAgeMs > 0 ? maxAgeMs : 0
  const expiry = Number(credential?.expiresOnTimestamp)
  const safeExpiry = Number.isFinite(expiry) && expiry > now
    ? Math.max(now, expiry - Math.max(0, Number(refreshSkewMs) || 0))
    : now + boundedMaxAge
  return Math.min(now + boundedMaxAge, safeExpiry)
}
