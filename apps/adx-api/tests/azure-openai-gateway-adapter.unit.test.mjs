import assert from 'node:assert/strict'
import test from 'node:test'
import { createAzureOpenAiGatewayAdapter } from '../azure-openai-gateway-adapter.mjs'

function response(body, { status = 200, headers = {} } = {}) { return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body } }

const configuration = {
  endpoint: 'https://api.uhg.com/api/cloud/api-management/ai-gateway-reasoning/1.0',
  apiVersion: '2025-01-01-preview',
  deployment: 'gpt-5.6-terra_2026-07-09',
  model: 'gpt-5.6-terra',
  projectId: 'cebcbf08-69a0-4c1c-b8d8-ad45f2e8c5ef',
  tokenProvider: async ({ scope }) => { assert.equal(scope, 'https://cognitiveservices.azure.com/.default'); return 'azure-ad-short-lived-access-token-value' }
}

test('Azure OpenAI gateway adapter uses the approved UHG endpoint, Azure AD headers, and Chat Completions payload', async () => {
  let captured
  const adapter = createAzureOpenAiGatewayAdapter({ ...configuration, fetchImpl: async (url, init) => { captured = { url, init }; return response({ choices: [{ message: { content: 'A prime number has exactly two positive divisors.' } }], usage: { prompt_tokens: 11, completion_tokens: 9, total_tokens: 20 } }, { headers: { 'x-ms-request-id': 'uhg-request-1' } }) } })
  const result = await adapter.complete({ system: 'Be concise.', prompt: 'Explain a prime number.', correlationId: 'trace-1' })
  assert.equal(captured.url, 'https://api.uhg.com/api/cloud/api-management/ai-gateway-reasoning/1.0/openai/deployments/gpt-5.6-terra_2026-07-09/chat/completions?api-version=2025-01-01-preview')
  assert.equal(captured.init.headers.authorization, 'Bearer azure-ad-short-lived-access-token-value')
  assert.equal(captured.init.headers.projectId, configuration.projectId)
  assert.equal(captured.init.headers['x-idp'], 'azuread')
  assert.doesNotMatch(JSON.stringify(result), /azure-ad-short-lived-access-token-value/)
  assert.equal(result.providerRequestId, 'uhg-request-1')
  assert.deepEqual(result.usage, { inputTokens: 11, outputTokens: 9, totalTokens: 20 })
  assert.deepEqual(JSON.parse(captured.init.body).messages.map((message) => message.role), ['system', 'user'])
  assert.equal(JSON.parse(captured.init.body).model, 'gpt-5.6-terra')
  assert.equal(JSON.parse(captured.init.body).max_completion_tokens, 2_000)
  assert.equal(JSON.parse(captured.init.body).max_tokens, undefined)
  assert.equal(JSON.parse(captured.init.body).temperature, 1)
})

test('Azure OpenAI gateway adapter accepts a bounded source-context prompt', async () => {
  let captured
  const prompt = `source context\n${'x'.repeat(8_000)}`
  const adapter = createAzureOpenAiGatewayAdapter({ ...configuration, fetchImpl: async (_url, init) => { captured = init; return response({ choices: [{ message: { content: '{"schema":"adx-model-patch-response-v1","patches":[]}' } }] }) } })
  await adapter.complete({ system: 'Return JSON only.', prompt, correlationId: 'trace-source-context' })
  assert.equal(JSON.parse(captured.body).messages[1].content, prompt)
})

test('Azure OpenAI gateway adapter sanitizes project authorization failures', async () => {
  const adapter = createAzureOpenAiGatewayAdapter({ ...configuration, fetchImpl: async () => response({}, { status: 403, headers: { 'x-request-id': 'denied-1' } }) })
  await assert.rejects(() => adapter.complete({ system: 'Be concise.', prompt: 'Explain.', correlationId: 'trace-2' }), (error) => error.code === 'AZURE_OPENAI_GATEWAY_REQUEST_FAILED' && error.details.providerRequestId === 'denied-1' && !JSON.stringify(error).includes('azure-ad-short-lived'))
})

test('Azure OpenAI gateway adapter retains only structured gateway validation metadata', async () => {
  const adapter = createAzureOpenAiGatewayAdapter({ ...configuration, fetchImpl: async () => response({ error: { code: 'unsupported_parameter', type: 'invalid_request_error', param: 'temperature', message: 'Do not retain this message.' } }, { status: 400 }) })
  await assert.rejects(() => adapter.complete({ system: 'Be concise.', prompt: 'Explain.', correlationId: 'trace-structured-error' }), (error) => error.details.gatewayError?.code === 'unsupported_parameter' && error.details.gatewayError?.param === 'temperature' && !JSON.stringify(error).includes('Do not retain this message.'))
})

test('Azure OpenAI gateway adapter retains no completion text when a successful response is empty', async () => {
  const adapter = createAzureOpenAiGatewayAdapter({ ...configuration, fetchImpl: async () => response({ choices: [{ finish_reason: 'length', message: { content: null, reasoning_content: 'Do not retain this.' } }] }) })
  await assert.rejects(() => adapter.complete({ system: 'Be concise.', prompt: 'Explain.', correlationId: 'trace-empty-response' }), (error) => error.code === 'AZURE_OPENAI_GATEWAY_RESPONSE_INVALID' && error.details.completion?.finishReason === 'length' && error.details.completion?.contentType === 'null' && !JSON.stringify(error).includes('Do not retain this.'))
})

test('Azure OpenAI gateway adapter supports an explicit API-key gateway contract', async () => {
  let captured
  const adapter = createAzureOpenAiGatewayAdapter({ ...configuration, credentialHeaderName: 'api-key', fetchImpl: async (_url, init) => { captured = init; return response({ choices: [{ message: { content: 'ready' } }] }) } })
  await adapter.complete({ system: 'Be concise.', prompt: 'Reply ready.', correlationId: 'trace-3' })
  assert.equal(captured.headers['api-key'], 'azure-ad-short-lived-access-token-value')
  assert.equal(captured.headers.authorization, undefined)
})

test('Azure OpenAI gateway adapter fails closed without an HTTPS endpoint and Azure AD token provider', () => {
  const adapter = createAzureOpenAiGatewayAdapter({ ...configuration, endpoint: 'http://api.uhg.com', tokenProvider: null })
  assert.equal(adapter.status().configured, false)
})