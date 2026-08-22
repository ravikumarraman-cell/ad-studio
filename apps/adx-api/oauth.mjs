import { createHash, randomBytes } from 'node:crypto'

const googleAuthorize = 'https://accounts.google.com/o/oauth2/v2/auth'
const googleToken = 'https://oauth2.googleapis.com/token'
const base64url = (value) => Buffer.from(value).toString('base64url')

export function createPkceTransaction() {
  const verifier = base64url(randomBytes(48))
  return { state: base64url(randomBytes(24)), verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

export function googleAuthorizationUrl({ clientId, redirectUri, transaction }) {
  const url = new URL(googleAuthorize)
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', state: transaction.state, code_challenge: transaction.challenge, code_challenge_method: 'S256', access_type: 'offline' }).toString()
  return url.toString()
}

export async function exchangeGoogleCode({ code, verifier, clientId, clientSecret, redirectUri }) {
  const body = new URLSearchParams({ code, code_verifier: verifier, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' })
  const response = await fetch(googleToken, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
  if (!response.ok) throw new Error('OIDC_CODE_EXCHANGE_FAILED')
  const tokens = await response.json()
  if (!tokens.id_token) throw new Error('OIDC_ID_TOKEN_MISSING')
  return tokens
}
