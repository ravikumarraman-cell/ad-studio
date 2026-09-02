import assert from 'node:assert/strict'
import test from 'node:test'
import { createPkceTransaction, googleAuthorizationUrl, oidcAuthorizationUrl, oidcEndpoints, oidcProvider } from '../oauth.mjs'

test('Google authorization URL allows an existing Google session to continue without an account picker', () => {
  const transaction = createPkceTransaction()
  const url = new URL(googleAuthorizationUrl({ clientId: 'client-id', redirectUri: 'http://127.0.0.1:3100/auth/callback', transaction }))
  assert.equal(url.searchParams.get('prompt'), null)
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:3100/auth/callback')
  assert.equal(url.searchParams.get('state'), transaction.state)
})

test('Entra authorization URL uses the configured tenant endpoint and PKCE', () => {
  const transaction = createPkceTransaction()
  const url = new URL(oidcAuthorizationUrl({ authorizationEndpoint: 'https://login.microsoftonline.com/tenant-id/oauth2/v2.0/authorize', clientId: 'app-id', redirectUri: 'http://127.0.0.1:3100/auth/callback', transaction }))
  assert.equal(url.hostname, 'login.microsoftonline.com')
  assert.equal(url.searchParams.get('client_id'), 'app-id')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
})

test('explicit OIDC endpoints enable Entra without a Google-specific adapter', () => {
  assert.deepEqual(oidcEndpoints({ ADX_OIDC_ISSUER: 'https://login.microsoftonline.com/tenant-id/v2.0', ADX_OIDC_AUTHORIZATION_ENDPOINT: 'https://login.microsoftonline.com/tenant-id/oauth2/v2.0/authorize', ADX_OIDC_TOKEN_ENDPOINT: 'https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token' }), { authorizationEndpoint: 'https://login.microsoftonline.com/tenant-id/oauth2/v2.0/authorize', tokenEndpoint: 'https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token' })
})

test('Entra configuration is independent from Google configuration', () => {
  const provider = oidcProvider({ ADX_ENTRA_TENANT_ID: 'tenant-id', ADX_ENTRA_CLIENT_ID: 'app-id', ADX_ENTRA_CLIENT_SECRET: 'secret', ADX_OIDC_REDIRECT_URI: 'http://127.0.0.1:3100/auth/callback' }, 'entra')
  assert.equal(provider.issuer, 'https://login.microsoftonline.com/tenant-id/v2.0')
  assert.equal(provider.audience, 'app-id')
})
