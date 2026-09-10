import assert from 'node:assert/strict'
import test from 'node:test'
import { createBrowserSessionHandoffCode, createPkceTransaction, googleAuthorizationUrl, oidcAuthorizationUrl, oidcEndpoints, oidcProvider } from '../oauth.mjs'
import { describeOidcVerifierRegistry, verifyOidcTokenWithRegistry } from '../oidc.mjs'

test('browser session handoff codes are opaque and unique', () => {
  const first = createBrowserSessionHandoffCode()
  const second = createBrowserSessionHandoffCode()
  assert.match(first, /^[A-Za-z0-9_-]{40,}$/)
  assert.notEqual(first, second)
})

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

test('OIDC bearer verification prefers the matching issuer and falls back to other configured verifiers', async () => {
  const calls = []
  const token = ['header', Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com' })).toString('base64url'), 'sig'].join('.')
  const registry = [
    { providerId: 'entra', issuer: 'https://login.microsoftonline.com/tenant-id/v2.0', verify: async () => { calls.push('entra'); throw Object.assign(new Error('no key'), { code: 'ERR_JWKS_NO_MATCHING_KEY' }) } },
    { providerId: 'google', issuer: 'https://accounts.google.com', verify: async () => { calls.push('google'); return { id: 'oidc:https://accounts.google.com:subject' } } },
  ]
  const principal = await verifyOidcTokenWithRegistry(token, registry)
  assert.deepEqual(calls, ['google'])
  assert.equal(principal.id, 'oidc:https://accounts.google.com:subject')
})

test('OIDC bearer verification reports every attempted verifier when all verifiers fail', async () => {
  const token = ['header', Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com' })).toString('base64url'), 'sig'].join('.')
  await assert.rejects(
    () => verifyOidcTokenWithRegistry(token, [
      { providerId: 'google', issuer: 'https://accounts.google.com', verify: async () => { throw Object.assign(new Error('missing key'), { code: 'ERR_JWKS_NO_MATCHING_KEY' }) } },
      { providerId: 'entra', issuer: 'https://login.microsoftonline.com/tenant-id/v2.0', verify: async () => { throw Object.assign(new Error('wrong issuer'), { code: 'ERR_JWT_CLAIM_VALIDATION_FAILED' }) } },
    ]),
    (error) => {
      assert.equal(error.code, 'ERR_JWT_CLAIM_VALIDATION_FAILED')
      assert.deepEqual(error.details, {
        tokenIssuer: 'https://accounts.google.com',
        attempts: [
          {
            providerId: 'google',
            issuer: 'https://accounts.google.com',
            errorCode: 'ERR_JWKS_NO_MATCHING_KEY',
            errorName: 'Error',
            errorMessage: 'missing key',
          },
          {
            providerId: 'entra',
            issuer: 'https://login.microsoftonline.com/tenant-id/v2.0',
            errorCode: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
            errorName: 'Error',
            errorMessage: 'wrong issuer',
          },
        ],
      })
      return true
    },
  )
})

test('OIDC verifier registry summary stays compact and ordered', () => {
  const summary = describeOidcVerifierRegistry([
    { providerId: 'google', issuer: 'https://accounts.google.com/' },
    { providerId: 'entra', issuer: 'https://login.microsoftonline.com/tenant-id/v2.0/' },
  ])
  assert.deepEqual(summary, {
    enabledCount: 2,
    profile: 'google+entra',
    providers: [
      { providerId: 'google', issuer: 'https://accounts.google.com' },
      { providerId: 'entra', issuer: 'https://login.microsoftonline.com/tenant-id/v2.0' },
    ],
  })
})
