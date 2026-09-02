import { createRemoteJWKSet, jwtVerify } from 'jose'
import { mapVerifiedOidcClaims } from '../../packages/identity/src/index.mjs'

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

function trustedIssuers(issuer) {
  if (issuer === 'https://accounts.google.com' || issuer === 'accounts.google.com') return ['https://accounts.google.com', 'accounts.google.com']
  return issuer
}

function jwksUri(config, issuer) {
  if (config.jwksUri || config.ADX_OIDC_JWKS_URI) return config.jwksUri || config.ADX_OIDC_JWKS_URI
  if (issuer === 'https://accounts.google.com' || issuer === 'accounts.google.com') return 'https://www.googleapis.com/oauth2/v3/certs'
  return `${issuer.replace(/\/$/, '')}/.well-known/jwks.json`
}
