import { createHash, randomBytes } from 'node:crypto'

const googleAuthorize = 'https://accounts.google.com/o/oauth2/v2/auth'
const googleToken = 'https://oauth2.googleapis.com/token'
const base64url = (value) => Buffer.from(value).toString('base64url')

export function createPkceTransaction() {
  const verifier = base64url(randomBytes(48))
  return { state: base64url(randomBytes(24)), verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

// The callback can arrive on the API host while the UI is served from another
// local origin. This one-time value lets the API issue the session cookie on
// the UI origin without ever putting an identity token in the URL.
export function createBrowserSessionHandoffCode() {
  return base64url(randomBytes(32))
}

export function oidcAuthorizationUrl({ authorizationEndpoint, clientId, redirectUri, transaction, scope = 'openid email profile' }) {
  const url = new URL(authorizationEndpoint)
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope, state: transaction.state, code_challenge: transaction.challenge, code_challenge_method: 'S256', access_type: 'offline' }).toString()
  return url.toString()
}

export async function exchangeOidcCode({ tokenEndpoint, code, verifier, clientId, clientSecret, redirectUri }) {
  const body = new URLSearchParams({ code, code_verifier: verifier, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' })
  const response = await fetch(tokenEndpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
  if (!response.ok) throw new Error('OIDC_CODE_EXCHANGE_FAILED')
  const tokens = await response.json()
  if (!tokens.id_token) throw new Error('OIDC_ID_TOKEN_MISSING')
  return tokens
}

// Backwards-compatible aliases for existing local Google configuration.
export function googleAuthorizationUrl(options) { return oidcAuthorizationUrl({ authorizationEndpoint: googleAuthorize, ...options }) }
export async function exchangeGoogleCode(options) { return exchangeOidcCode({ tokenEndpoint: googleToken, ...options }) }

export function oidcEndpoints(env = process.env) {
  const issuer = String(env.ADX_OIDC_ISSUER ?? '').replace(/\/$/, '')
  if (env.ADX_OIDC_AUTHORIZATION_ENDPOINT && env.ADX_OIDC_TOKEN_ENDPOINT) return Object.freeze({ authorizationEndpoint: env.ADX_OIDC_AUTHORIZATION_ENDPOINT, tokenEndpoint: env.ADX_OIDC_TOKEN_ENDPOINT })
  if (issuer === 'https://accounts.google.com' || issuer === 'accounts.google.com') return Object.freeze({ authorizationEndpoint: googleAuthorize, tokenEndpoint: googleToken })
  return null
}

/** Returns one complete provider configuration without exposing it to the browser. */
export function oidcProvider(env = process.env, provider = 'google') {
  if (provider === 'google') {
    const clientId = env.ADX_GOOGLE_CLIENT_ID || (env.ADX_OIDC_ISSUER === 'https://accounts.google.com' || env.ADX_OIDC_ISSUER === 'accounts.google.com' ? env.ADX_OIDC_AUDIENCE : '')
    if (!clientId) return null
    return Object.freeze({ id: 'google', issuer: 'https://accounts.google.com', audience: clientId, clientId, clientSecret: env.ADX_GOOGLE_CLIENT_SECRET || env.ADX_OIDC_CLIENT_SECRET, redirectUri: env.ADX_GOOGLE_REDIRECT_URI || env.ADX_OIDC_REDIRECT_URI, jwksUri: env.ADX_GOOGLE_JWKS_URI || 'https://www.googleapis.com/oauth2/v3/certs', authorizationEndpoint: googleAuthorize, tokenEndpoint: googleToken, scope: env.ADX_GOOGLE_OIDC_SCOPE || 'openid profile email' })
  }
  if (provider === 'entra') {
    const tenantId = String(env.ADX_ENTRA_TENANT_ID || '').trim()
    const clientId = env.ADX_ENTRA_CLIENT_ID
    if (!tenantId || !clientId) return null
    const authority = `https://login.microsoftonline.com/${tenantId}`
    return Object.freeze({ id: 'entra', issuer: env.ADX_ENTRA_ISSUER || `${authority}/v2.0`, audience: clientId, clientId, clientSecret: env.ADX_ENTRA_CLIENT_SECRET, redirectUri: env.ADX_ENTRA_REDIRECT_URI || env.ADX_OIDC_REDIRECT_URI, jwksUri: `${authority}/discovery/v2.0/keys`, authorizationEndpoint: `${authority}/oauth2/v2.0/authorize`, tokenEndpoint: `${authority}/oauth2/v2.0/token`, scope: env.ADX_ENTRA_OIDC_SCOPE || 'openid profile email' })
  }
  return null
}
