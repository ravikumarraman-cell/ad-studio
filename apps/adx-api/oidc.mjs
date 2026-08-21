import { createRemoteJWKSet, jwtVerify } from 'jose'
import { mapVerifiedOidcClaims } from '../../packages/identity/src/index.mjs'

export function createOidcVerifier(env = process.env) {
  const issuer = env.ADX_OIDC_ISSUER
  const audience = env.ADX_OIDC_AUDIENCE
  if (!issuer || !audience) return null
  const jwks = createRemoteJWKSet(new URL(jwksUri(env, issuer)))
  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, { issuer: trustedIssuers(issuer), audience })
    return mapVerifiedOidcClaims({ ...payload, iss: issuer }, { issuer, audience })
  }
}

function trustedIssuers(issuer) {
  if (issuer === 'https://accounts.google.com' || issuer === 'accounts.google.com') return ['https://accounts.google.com', 'accounts.google.com']
  return issuer
}

function jwksUri(env, issuer) {
  if (env.ADX_OIDC_JWKS_URI) return env.ADX_OIDC_JWKS_URI
  if (issuer === 'https://accounts.google.com' || issuer === 'accounts.google.com') return 'https://www.googleapis.com/oauth2/v3/certs'
  return `${issuer.replace(/\/$/, '')}/.well-known/jwks.json`
}
