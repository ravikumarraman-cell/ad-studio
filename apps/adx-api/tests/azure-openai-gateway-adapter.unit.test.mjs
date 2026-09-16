import assert from 'node:assert/strict'
import test from 'node:test'
import { createAzureOpenAiGatewayAdapter } from '../azure-openai-gateway-adapter.mjs'
import { createCachedTokenProvider } from '../azure-ad-token-provider.mjs'

function response(body, { status = 200, headers = {} } = {}) { return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body } }

const configuration = {
  endpoint: 'https://api.uhg.com/api/cloud/api-management/ai-gateway-reasoning/1.0',
  apiVersion: '2025-01-01-preview',
  deployment: 'gpt-5.6-terra_2026-07-09',
  model: 'gpt-5.6-terra',
  projectId: 'cebcbf08-69a0-4c1c-b8d8-ad45f2e8c5ef',
  tokenProvider: async ({ scope }) => { assert.equal(scope, 'https://cognitiveservices.azure.com/.default'); return 'azure-ad-short-lived-access-token-value' }
}

test('cached token provider shares one acquisition across concurrent model requests', async () => {
  let acquisitions = 0
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const provider = createCachedTokenProvider(async () => {
    acquisitions += 1
    await gate
    return 'shared-token-with-sufficient-safe-length'
  })
  const first = provider({ scope: 'scope' })
  const second = provider({ scope: 'scope' })
  release()
  assert.deepEqual(await Promise.all([first, second]), ['shared-token-with-sufficient-safe-length', 'shared-token-with-sufficient-safe-length'])
  assert.equal(acquisitions, 1)
  assert.equal(await provider({ scope: 'scope' }), 'shared-token-with-sufficient-safe-length')
  assert.equal(acquisitions, 1)
})

test('cached token provider reuses the Azure session token until its safe refresh window', async () => {
  let currentTime = 1_000
  let acquisitions = 0
  const provider = createCachedTokenProvider(async () => {
    acquisitions += 1
    return { token: `session-token-with-sufficient-safe-length-${acquisitions}`, expiresOnTimestamp: 11_000 }
  }, { now: () => currentTime, refreshSkewMs: 2_000, maxAgeMs: 60_000 })
  assert.equal(await provider({ scope: 'scope' }), 'session-token-with-sufficient-safe-length-1')
  currentTime = 8_999
  assert.equal(await provider({ scope: 'scope' }), 'session-token-with-sufficient-safe-length-1')
  currentTime = 9_000
  assert.equal(await provider({ scope: 'scope' }), 'session-token-with-sufficient-safe-length-2')
  assert.equal(acquisitions, 2)
})

test('cached token provider fails fast when interactive acquisition does not settle', async () => {
  const provider = createCachedTokenProvider(
    async () => new Promise(() => {}),
    { acquisitionTimeoutMs: 1 },
  )
  await assert.rejects(
    () => provider({ scope: 'scope' }),
    (error) => error.code === 'AZURE_OPENAI_GATEWAY_CREDENTIAL_TIMEOUT',
  )
})

test('Azure OpenAI gateway adapter uses the approved UHG endpoint, Azure AD headers, and Chat Completions payload', async () => {
  let captured
  const adapter = createAzureOpenAiGatewayAdapter({ ...configuration, fetchImpl: async (url, init) => { captured = { url, init }; return response({ choices: [{ message: { content: 'A prime number has exactly two positive divisors.' } }], usage: { prompt_tokens: 11, completion_tokens: 9, total_tokens: 20 } }, { headers: { 'x-ms-request-id': 'uhg-request-1' } }) } })
  const result = await adapter.complete({ system: 'Be concise.', prompt: 'Explain a prime number.', correlationId: 'trace-1' })
  assert.equal(captured.url, 'https://api.uhg.com/api/cloud/api-management/ai-gateway-reasoning/1.0/openai/deployments/gpt-5.6-terra_2026-07-09/chat/completions?api-version=2025-01-01-preview')
  assert.equal(captured.init.headers.authorization, 'Bearer azure-ad-short-lived-access-token-value')
  assert.equal(captured.init.headers.projectId, configuration.projectId)
  assert.equal(captured.init.headers['x-idp'], 'azuread')
  assert.equal(captured.init.headers.connection, 'close')
  assert.doesNotMatch(JSON.stringify(result), /azure-ad-short-lived-access-token-value/)
  assert.equal(result.providerRequestId, 'uhg-request-1')
  assert.deepEqual(result.usage, { inputTokens: 11, outputTokens: 9, totalTokens: 20 })
  assert.deepEqual(JSON.parse(captured.init.body).messages.map((message) => message.role), ['system', 'user'])
  assert.equal(JSON.parse(captured.init.body).model, 'gpt-5.6-terra')
  assert.equal(JSON.parse(captured.init.body).max_completion_tokens, 2_000)
  assert.equal(JSON.parse(captured.init.body).max_tokens, undefined)
  assert.equal(JSON.parse(captured.init.body).temperature, 1)
})

test('gateway forwards a strict JSON Schema response contract', async () => {
  let captured
  const adapter = createAzureOpenAiGatewayAdapter({ ...configuration, fetchImpl: async (_url, init) => { captured = JSON.parse(init.body); return response({ choices: [{ message: { content: '{"ok":true}' } }] }) } })
  await adapter.complete({ system: 'Return JSON.', prompt: 'Return an object.', correlationId: 'trace-structured-output', temperature: 0, responseSchema: { name: 'result', strict: true, schema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } } } })
  assert.deepEqual(captured.response_format, { type: 'json_schema', json_schema: { name: 'result', strict: true, schema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } } } })
  assert.equal(captured.temperature, 0)
})

test('gateway safely downgrades JSON schema to JSON-object mode when supported', async () => {
  const requests = []
  const adapter = createAzureOpenAiGatewayAdapter({ ...configuration, fetchImpl: async (_url, init) => { requests.push(JSON.parse(init.body)); return requests.length === 1 ? response({ error: { code: 'unsupported_parameter', param: 'response_format' } }, { status: 400 }) : response({ choices: [{ message: { content: '{"schema":"adx-model-patch-response-v1","patches":[]}' } }] }) } })
  const result = await adapter.complete({ system: 'Return JSON.', prompt: 'Return an object.', correlationId: 'trace-structured-fallback', responseSchema: { name: 'result', strict: true, schema: { type: 'object', additionalProperties: false } } })
  assert.equal(result.text, '{"schema":"adx-model-patch-response-v1","patches":[]}')
  assert.equal(requests.length, 2)
  assert.equal(requests[0].response_format.type, 'json_schema')
  assert.deepEqual(requests[1].response_format, { type: 'json_object' })
})

test('gateway recognizes a structured-output rejection reported only in the gateway message', async () => {
  const requests = []
  const adapter = createAzureOpenAiGatewayAdapter({ ...configuration, fetchImpl: async (_url, init) => {
    requests.push(JSON.parse(init.body))
    return requests.length === 1
      ? response({ error: { message: 'Structured output response_format is not supported by this route.' } }, { status: 400 })
      : response({ choices: [{ message: { content: '{"ok":true}' } }] })
  } })
  const result = await adapter.complete({ system: 'Return JSON.', prompt: 'Return an object.', correlationId: 'trace-message-structured-fallback', responseSchema: { name: 'result', strict: true, schema: { type: 'object', additionalProperties: false } } })
  assert.equal(result.text, '{"ok":true}')
  assert.equal(requests.length, 2)
  assert.deepEqual(requests[1].response_format, { type: 'json_object' })
})

test('gateway safely downgrades a rejected JSON schema to JSON-object mode', async () => {
  const requests = []
  const adapter = createAzureOpenAiGatewayAdapter({ ...configuration, fetchImpl: async (_url, init) => { requests.push(JSON.parse(init.body)); return requests.length === 1 ? response({ error: { code: 'invalid_json_schema', param: 'response_format.json_schema.schema' } }, { status: 400 }) : response({ choices: [{ message: { content: '{"ok":true}' } }] }) } })
  const result = await adapter.complete({ system: 'Return JSON.', prompt: 'Return an object.', correlationId: 'trace-schema-fallback', responseSchema: { name: 'result', strict: true, schema: { type: 'object', additionalProperties: false } } })
  assert.equal(result.text, '{"ok":true}')
  assert.equal(requests.length, 2)
  assert.deepEqual(requests[1].response_format, { type: 'json_object' })
})

test('gateway retries JSON-object mode for an unstructured 400 when JSON output is required', async () => {
  const requests = []
  const adapter = createAzureOpenAiGatewayAdapter({ ...configuration, fetchImpl: async (_url, init) => {
    requests.push(JSON.parse(init.body))
    return requests.length === 1
      ? response({ error: { message: 'bad request' } }, { status: 400 })
      : response({ choices: [{ message: { content: '{"ok":true}' } }] })
  } })
  const result = await adapter.complete({ system: 'Return JSON.', prompt: 'Return an object.', correlationId: 'trace-generic-400-fallback', responseSchema: { name: 'result', strict: true, schema: { type: 'object', additionalProperties: false } } })
  assert.equal(result.text, '{"ok":true}')
  assert.equal(requests.length, 2)
  assert.equal(requests[0].response_format.type, 'json_schema')
  assert.deepEqual(requests[1].response_format, { type: 'json_object' })
})

test('gateway never infers a legacy token field from an unstructured 400', async () => {
  const requests = []
  const adapter = createAzureOpenAiGatewayAdapter({ ...configuration, fetchImpl: async (_url, init) => {
    requests.push(JSON.parse(init.body))
    return response({ error: { message: 'bad request' } }, { status: 400 })
  } })
  await assert.rejects(() => adapter.complete({ system: 'Return JSON.', prompt: 'Return an object.', correlationId: 'trace-generic-token-safety', responseSchema: { name: 'result', strict: true, schema: { type: 'object', additionalProperties: false } } }), (error) => error.code === 'AZURE_OPENAI_GATEWAY_REQUEST_FAILED')
  assert.equal(requests.length, 2)
  assert.equal(requests[0].response_format.type, 'json_schema')
  assert.equal(requests[0].max_completion_tokens, 2_000)
  assert.deepEqual(requests[1].response_format, { type: 'json_object' })
  assert.equal(requests[1].max_completion_tokens, 2_000)
  assert.equal(requests.some((request) => Object.hasOwn(request, 'max_tokens')), false)
})

test('gateway falls back to the legacy token-limit field when required by its route', async () => {
  const requests = []
  const adapter = createAzureOpenAiGatewayAdapter({ ...configuration, fetchImpl: async (_url, init) => { requests.push(JSON.parse(init.body)); return requests.length === 1 ? response({ error: { code: 'unsupported_parameter', param: 'max_completion_tokens' } }, { status: 400 }) : response({ choices: [{ message: { content: 'ready' } }] }) } })
  const result = await adapter.complete({ system: 'Be concise.', prompt: 'Reply ready.', correlationId: 'trace-legacy-token-field' })
  assert.equal(result.text, 'ready')
  assert.equal(requests.length, 2)
  assert.equal(requests[1].max_completion_tokens, undefined)
  assert.equal(requests[1].max_tokens, 2_000)
})

test('gateway retries without temperature when its route rejects that value', async () => {
  const requests = []
  const adapter = createAzureOpenAiGatewayAdapter({ ...configuration, fetchImpl: async (_url, init) => { requests.push(JSON.parse(init.body)); return requests.length === 1 ? response({ error: { code: 'unsupported_value', param: 'temperature' } }, { status: 400 }) : response({ choices: [{ message: { content: 'ready' } }] }) } })
  const result = await adapter.complete({ system: 'Be concise.', prompt: 'Reply ready.', correlationId: 'trace-temperature-fallback', temperature: 0 })
  assert.equal(result.text, 'ready')
  assert.equal(requests.length, 2)
  assert.equal(requests[0].temperature, 0)
  assert.equal(requests[1].temperature, undefined)
})

test('gateway isolates a temperature compatibility retry from a rejected connection', async () => {
  const requests = []
  const adapter = createAzureOpenAiGatewayAdapter({ ...configuration, fetchImpl: async (_url, init) => {
    requests.push({ body: JSON.parse(init.body), connection: init.headers.connection })
    if (requests.length === 1) return response({ error: { code: 'unsupported_value', param: 'temperature' } }, { status: 400 })
    assert.equal(init.headers.connection, 'close')
    return response({ choices: [{ message: { content: 'ready' } }] })
  } })
  const result = await adapter.complete({ system: 'Be concise.', prompt: 'Reply ready.', correlationId: 'trace-temperature-connection-retry', temperature: 0 })
  assert.equal(result.text, 'ready')
  assert.deepEqual(requests.map((request) => request.connection), ['close', 'close'])
  assert.equal(requests[0].body.temperature, 0)
  assert.equal(requests[1].body.temperature, undefined)
})

test('gateway preserves structured output while applying compatible field retries', async () => {
  const requests = []
  const responses = [
    response({ error: { code: 'unsupported_value', param: 'temperature' } }, { status: 400 }),
    response({ error: { code: 'unsupported_parameter', param: 'response_format' } }, { status: 400 }),
    response({ error: { code: 'unsupported_parameter', param: 'max_completion_tokens' } }, { status: 400 }),
    response({ choices: [{ message: { content: 'ready' } }] })
  ]
  const adapter = createAzureOpenAiGatewayAdapter({ ...configuration, fetchImpl: async (_url, init) => { requests.push(JSON.parse(init.body)); return responses.shift() } })
  const result = await adapter.complete({ system: 'Return JSON.', prompt: 'Reply ready.', correlationId: 'trace-composed-fallbacks', temperature: 0, responseSchema: { name: 'result', strict: true, schema: { type: 'object', additionalProperties: false } } })
  assert.equal(result.text, 'ready')
  assert.equal(requests.length, 4)
  assert.equal(requests[1].temperature, undefined)
  assert.equal(requests[1].response_format.type, 'json_schema')
  assert.equal(requests[2].response_format.type, 'json_object')
  assert.equal(requests[3].max_tokens, 2_000)
  assert.equal(requests[3].response_format.type, 'json_object')
})

test('gateway never drops structured output in compatibility-rejection orders', async () => {
  const adjustments = [
    { error: { code: 'unsupported_value', param: 'temperature' }, omitted: 'temperature' },
    { error: { code: 'unsupported_parameter', param: 'response_format' }, omitted: 'response_format' },
    { error: { code: 'unsupported_parameter', param: 'max_completion_tokens' }, omitted: 'max_completion_tokens' }
  ]
  const orders = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]
  ]
  for (const order of orders) {
    const requests = []
    const responses = [...order.map((index) => response({ error: adjustments[index].error }, { status: 400 })), response({ choices: [{ message: { content: 'ready' } }] })]
    const adapter = createAzureOpenAiGatewayAdapter({ ...configuration, fetchImpl: async (_url, init) => { requests.push(JSON.parse(init.body)); return responses.shift() } })
    const result = await adapter.complete({ system: 'Return JSON.', prompt: 'Reply ready.', correlationId: `trace-compatibility-order-${order.join('')}`, temperature: 0, responseSchema: { name: 'result', strict: true, schema: { type: 'object', additionalProperties: false } } })
    assert.equal(result.text, 'ready')
    assert.equal(requests.length, 4)
    for (let requestIndex = 1; requestIndex < requests.length; requestIndex += 1) {
      for (const adjustmentIndex of order.slice(0, requestIndex)) {
        if (adjustments[adjustmentIndex].omitted !== 'response_format') assert.equal(requests[requestIndex][adjustments[adjustmentIndex].omitted], undefined)
      }
      assert.equal(requests[requestIndex].response_format.type, requestIndex > order.indexOf(1) ? 'json_object' : 'json_schema')
    }
    assert.equal(requests[3].max_tokens, 2_000)
  }
})

test('gateway retries a transient upstream failure before surfacing the result', async () => {
  const requests = []
  const adapter = createAzureOpenAiGatewayAdapter({
    ...configuration,
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body))
      return requests.length === 1
        ? response({}, { status: 502, headers: { 'x-request-id': 'retry-1' } })
        : response({ choices: [{ message: { content: 'ready' } }], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } }, { headers: { 'x-request-id': 'retry-2' } })
    },
  })
  const result = await adapter.complete({ system: 'Be concise.', prompt: 'Reply ready.', correlationId: 'trace-transient-retry' })
  assert.equal(result.text, 'ready')
  assert.equal(result.providerRequestId, 'retry-2')
  assert.equal(requests.length, 2)
  assert.equal(requests[0].temperature, 1)
  assert.equal(requests[1].temperature, 1)
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
  let calls = 0
  const adapter = createAzureOpenAiGatewayAdapter({ ...configuration, fetchImpl: async () => { calls += 1; return response({ error: { code: 'unsupported_parameter', type: 'invalid_request_error', param: 'temperature', message: 'Do not retain this message.' } }, { status: 400 }) } })
  await assert.rejects(() => adapter.complete({ system: 'Be concise.', prompt: 'Explain.', correlationId: 'trace-structured-error' }), (error) => error.details.gatewayError?.code === 'unsupported_parameter' && error.details.gatewayError?.param === 'temperature' && !JSON.stringify(error).includes('Do not retain this message.'))
  assert.equal(calls, 1)
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

test('Azure OpenAI gateway adapter aborts a hung request when the timeout expires', async () => {
  const adapter = createAzureOpenAiGatewayAdapter({
    ...configuration,
    fetchImpl: async (_url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }),
  })

  await assert.rejects(
    () => adapter.complete({ system: 'Be concise.', prompt: 'Explain.', correlationId: 'trace-timeout', timeoutMs: 1 }),
    (error) => error.code === 'AZURE_OPENAI_GATEWAY_REQUEST_TIMEOUT',
  )
})

test('Azure OpenAI gateway adapter fails closed without an HTTPS endpoint and Azure AD token provider', () => {
  const adapter = createAzureOpenAiGatewayAdapter({ ...configuration, endpoint: 'http://api.uhg.com', tokenProvider: null })
  assert.equal(adapter.status().configured, false)
})
