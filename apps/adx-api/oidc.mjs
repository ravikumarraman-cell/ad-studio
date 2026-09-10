import { createRemoteJWKSet, jwtVerify } from 'jose'
import { mapVerifiedOidcClaims } from '../../packages/identity/src/index.mjs'
import { oidcProvider } from './oauth.mjs'

export function createOidcVerifier(config = process.env) {
  const issuer = config.issuer ?? config.ADX_OIDC_ISSUER
  const audience = config.audience ?? config.ADX_OIDC_AUDIENCE
  if (!issuer || !audience) return null
  const jwks = createRemoteJWKSet(new URL(jwksUri(config, issuer)))
  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, { issuer: trustedIssuers(issuer), audience })
    return mapVerifiedOidcClaims({ ...payload, iss: issuer }, { issuer, audience })
  }
}

export function createOidcVerifierRegistry(env = process.env) {
  return Object.freeze(
    [
      ['google', oidcProvider(env, 'google')],
      ['entra', oidcProvider(env, 'entra')],
    ]
      .filter(([, provider]) => Boolean(provider))
      .map(([providerId, provider]) => Object.freeze({ providerId, issuer: provider.issuer, verify: createOidcVerifier(provider) })),
  )
}

export function describeOidcVerifierRegistry(registry = []) {
  const providers = Object.freeze(
    (Array.isArray(registry) ? registry : []).map((entry) =>
      Object.freeze({
        providerId: typeof entry?.providerId === 'string' ? entry.providerId : null,
        issuer: normalizeIssuer(entry?.issuer),
      }),
    ),
  )
  return Object.freeze({
    enabledCount: providers.length,
    profile: providers.map((entry) => entry.providerId || 'unknown').join('+') || 'none',
    providers,
  })
}

export async function verifyOidcTokenWithRegistry(token, registry = []) {
  const issuer = tokenIssuer(token)
  const ordered = orderVerifierRegistry(registry, issuer)
  const attempts = []
  for (const entry of ordered) {
    try {
      const principal = await entry.verify(token)
      return principal
    } catch (error) {
      attempts.push(
        Object.freeze({
          providerId: entry.providerId ?? null,
          issuer: normalizeIssuer(entry.issuer),
          errorCode: typeof error?.code === 'string' ? error.code : null,
          errorName: typeof error?.name === 'string' ? error.name : null,
          errorMessage: typeof error?.message === 'string' ? error.message.slice(0, 180) : null,
        }),
      )
    }
  }
  const failure = attempts.at(-1) ?? null
  const error = new Error(failure?.errorMessage ?? 'OIDC_TOKEN_VERIFICATION_FAILED')
  error.code = failure?.errorCode ?? 'OIDC_TOKEN_VERIFICATION_FAILED'
  error.details = Object.freeze({
    tokenIssuer: issuer,
    attempts: Object.freeze(attempts),
  })
  if (failure?.errorName) error.name = failure.errorName
  return Promise.reject(error)
}

function trustedIssuers(issuer) {
  if (issuer === 'https://accounts.google.com' || issuer === 'accounts.google.com') return ['https://accounts.google.com', 'accounts.google.com']
  return issuer
}

function jwksUri(config, issuer) {
  if (config.jwksUri || config.ADX_OIDC_JWKS_URI) return config.jwksUri || config.ADX_OIDC_JWKS_URI
  if (issuer === 'https://accounts.google.com' || issuer === 'accounts.google.com') return 'https://www.googleapis.com/oauth2/v3/certs'
  return `${issuer.replace(/\/$/, '')}/.well-known/jwks.json`
}

function tokenIssuer(token) {
  if (typeof token !== 'string') return null
  const [, encodedPayload = ''] = token.split('.')
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
    return typeof payload.iss === 'string' ? payload.iss : null
  } catch {
    return null
  }
}

function orderVerifierRegistry(registry, issuer) {
  const verifiers = Array.isArray(registry) ? [...registry] : []
  if (!issuer) return verifiers
  const normalizedIssuer = issuer.replace(/\/$/, '')
  const preferred = verifiers.filter((entry) => normalizeIssuer(entry?.issuer) === normalizedIssuer)
  const fallback = verifiers.filter((entry) => normalizeIssuer(entry?.issuer) !== normalizedIssuer)
  return [...preferred, ...fallback]
}

function normalizeIssuer(issuer) {
  return typeof issuer === 'string' ? issuer.replace(/\/$/, '') : null
}
