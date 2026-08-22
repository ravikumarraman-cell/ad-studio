import assert from 'node:assert/strict'
import test from 'node:test'
import { createAnthropicGatewayAdapter } from '../anthropic-gateway-adapter.mjs'

function response(body, { status = 200, headers = {} } = {}) { return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body } }

const configuration = {
  endpoint: 'https://api.uhg.com',
  requestPath: '/api/cloud/api-management/ai-gateway/1.0/v1/messages',
  deployment: 'us.anthropic.claude-opus-4-8',
  projectId: 'cebcbf08-69a0-4c1c-b8d8-ad45f2e8c5ef',
  routingHeaders: { 'x-project-id': 'cebcbf08-69a0-4c1c-b8d8-ad45f2e8c5ef', 'x-deployment-name': 'us.anthropic.claude-opus-4-8' },
  credentialForRequest: async () => ({ headerName: 'authorization', value: 'Bearer short-lived-token' })
}

test('Anthropic gateway adapter sends Messages payload with server-injected credential and routing metadata', async () => {
  let captured
  const adapter = createAnthropicGatewayAdapter({ ...configuration, fetchImpl: async (url, init) => { captured = { url, init }; return response({ content: [{ type: 'text', text: 'Implement the accepted change.' }], usage: { input_tokens: 12, output_tokens: 8 } }, { headers: { 'x-request-id': 'gateway-request-1' } }) } })
  const result = await adapter.complete({ system: 'Follow the ADX lease.', prompt: 'Implement one small change.', correlationId: 'trace-1' })
  assert.equal(adapter.status().configured, true)
  assert.equal(captured.url, 'https://api.uhg.com/api/cloud/api-management/ai-gateway/1.0/v1/messages')
  assert.equal(captured.init.headers.authorization, 'Bearer short-lived-token')
  assert.equal(captured.init.headers['x-project-id'], configuration.projectId)
  assert.equal(captured.init.headers['anthropic-version'], '2023-06-01')
  assert.doesNotMatch(JSON.stringify(result), /short-lived-token/)
  assert.equal(result.providerRequestId, 'gateway-request-1')
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 8 })
  assert.equal(JSON.parse(captured.init.body).model, configuration.deployment)
})

test('Anthropic gateway adapter sanitizes authorization failures and excludes credential details', async () => {
  const adapter = createAnthropicGatewayAdapter({ ...configuration, fetchImpl: async () => response({}, { status: 403, headers: { 'x-request-id': 'denied-1' } }) })
  await assert.rejects(() => adapter.complete({ system: 'Follow ADX.', prompt: 'Implement.', correlationId: 'trace-2' }), (error) => error.code === 'ANTHROPIC_GATEWAY_REQUEST_FAILED' && error.details.providerRequestId === 'denied-1' && !JSON.stringify(error).includes('short-lived-token'))
})

test('Anthropic gateway adapter fails closed for an insecure or malformed gateway route', () => {
  const adapter = createAnthropicGatewayAdapter({ ...configuration, endpoint: 'http://api.uhg.com' })
  assert.equal(adapter.status().configured, false)
})