import { createRemoteJWKSet, jwtVerify } from 'jose'
import { mapVerifiedOidcClaims } from '../../packages/identity/src/index.mjs'

export function createOidcVerifier(env = process.env) {
  const issuer = env.ADX_OIDC_ISSUER
  const audience = env.ADX_OIDC_AUDIENCE
  if (!issuer || !audience) return null
  const jwks = createRemoteJWKSet(new URL(env.ADX_OIDC_JWKS_URI ?? `${issuer.replace(/\/$/, '')}/.well-known/jwks.json`))
  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience })
    return mapVerifiedOidcClaims(payload, { issuer, audience })
  }
}
