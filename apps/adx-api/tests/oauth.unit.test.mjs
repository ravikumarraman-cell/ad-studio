import assert from 'node:assert/strict'
import test from 'node:test'
import { createPkceTransaction, googleAuthorizationUrl } from '../oauth.mjs'

test('Google authorization URL allows an existing Google session to continue without an account picker', () => {
  const transaction = createPkceTransaction()
  const url = new URL(googleAuthorizationUrl({ clientId: 'client-id', redirectUri: 'http://127.0.0.1:3100/auth/callback', transaction }))
  assert.equal(url.searchParams.get('prompt'), null)
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:3100/auth/callback')
  assert.equal(url.searchParams.get('state'), transaction.state)
})