import assert from 'node:assert/strict'
import test from 'node:test'
import { createStorySuggestionService } from '../story-suggestions.mjs'

const changeCase = { title: 'Member can review an authorization decision', riskTier: 'R2' }
const governance = { intent: { outcome: 'Make an authorization decision understandable', acceptanceCriteria: 'The decision and reason are visible.', targetRepository: 'health-auth-service', assets: [{ name: 'member decision', classification: 'confidential' }] }, assessment: { riskTier: 'R3' } }
const result = { stories: [{ title: 'View decision', narrative: 'As a member, I want to view my authorization decision, so that I understand the outcome.', scenarios: [{ given: 'a completed decision', when: 'the member opens the decision', then: 'the outcome and reason are displayed' }] }] }

function response(body, headers = {}) { return { ok: true, status: 200, headers: new Headers(headers), json: async () => body } }

test('Gemini requests JSON story suggestions with a server-side key', async () => {
  let captured
  const service = createStorySuggestionService({ provider: 'gemini', apiKey: 'gemini-secret', model: 'gemini-free-tier-model', fetchImpl: async (url, init) => { captured = { url, init }; return response({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] }, { 'x-request-id': 'gemini-request-1' }) } })
  const suggested = await service.suggest({ changeCase, governance, correlationId: 'trace-1' })
  assert.equal(service.status().provider, 'GEMINI_GENERATE_CONTENT')
  assert.equal(suggested.provider, 'GEMINI_GENERATE_CONTENT')
  assert.equal(suggested.providerLabel, 'Google Gemini')
  assert.equal(suggested.providerRequestId, 'gemini-request-1')
  assert.equal(suggested.suggestions[0].title, 'View decision')
  assert.equal(captured.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-free-tier-model:generateContent')
  assert.equal(captured.init.headers['x-goog-api-key'], 'gemini-secret')
  const request = JSON.parse(captured.init.body)
  assert.equal(request.generationConfig.responseMimeType, 'application/json')
  assert.match(request.systemInstruction.parts[0].text, /ADX product-analysis assistant/)
  assert.doesNotMatch(captured.init.body, /gemini-secret/)
})

test('OpenAI remains the default provider for existing configuration', async () => {
  let captured
  const service = createStorySuggestionService({ apiKey: 'openai-secret', model: 'existing-model', fetchImpl: async (url, init) => { captured = { url, init }; return response({ output_text: JSON.stringify(result) }) } })
  const suggested = await service.suggest({ changeCase, governance, correlationId: 'trace-2' })
  assert.equal(suggested.provider, 'OPENAI_RESPONSES')
  assert.equal(captured.url, 'https://api.openai.com/v1/responses')
  assert.equal(captured.init.headers.authorization, 'Bearer openai-secret')
})

test('only server-approved models can be selected for a suggestion request', async () => {
  let requestedUrl
  const service = createStorySuggestionService({ provider: 'gemini', apiKey: 'gemini-secret', model: 'gemini-default', models: 'gemini-fast, gemini-careful', fetchImpl: async (url) => { requestedUrl = url; return response({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] }) } })
  assert.deepEqual(service.status().models, ['gemini-default', 'gemini-fast', 'gemini-careful'])
  const suggested = await service.suggest({ changeCase, governance, correlationId: 'trace-allowed', model: 'gemini-careful' })
  assert.equal(suggested.model, 'gemini-careful')
  assert.match(requestedUrl, /gemini-careful:generateContent$/)
  await assert.rejects(() => service.suggest({ changeCase, governance, correlationId: 'trace-denied', model: 'an-unapproved-model' }), { message: /not enabled/ })
})

test('an unsupported provider remains disabled with actionable guidance', () => {
  const service = createStorySuggestionService({ provider: 'unknown', apiKey: 'key', model: 'model', fetchImpl: async () => response({}) })
  assert.equal(service.status().configured, false)
  return assert.rejects(() => service.suggest({ changeCase, governance, correlationId: 'trace-3' }), { message: /openai, gemini, or ollama/ })
})

test('Gemini authorization failures tell the author what to check', async () => {
  const service = createStorySuggestionService({ provider: 'gemini', apiKey: 'gemini-secret', model: 'gemini-model', fetchImpl: async () => ({ ok: false, status: 403, headers: new Headers(), json: async () => ({}) }) })
  await assert.rejects(() => service.suggest({ changeCase, governance, correlationId: 'trace-403' }), { message: /generativelanguage\.googleapis\.com/ })
})

test('Ollama generates structured local story suggestions without an API key', async () => {
  let captured
  const service = createStorySuggestionService({ provider: 'ollama', model: 'local-story-model', models: 'local-story-model,local-fast-model', fetchImpl: async (url, init) => { captured = { url, init }; return response({ response: JSON.stringify(result) }) } })
  const suggested = await service.suggest({ changeCase, governance, correlationId: 'trace-local', model: 'local-fast-model' })
  assert.equal(service.status().provider, 'OLLAMA_LOCAL')
  assert.equal(suggested.providerLabel, 'Local Ollama')
  assert.equal(suggested.model, 'local-fast-model')
  assert.equal(captured.url, 'http://127.0.0.1:11434/api/generate')
  assert.equal(captured.init.headers.authorization, undefined)
  const request = JSON.parse(captured.init.body)
  assert.equal(request.format.type, 'object')
  assert.equal(request.format.properties.stories.items.properties.scenarios.maxItems, 1)
  assert.equal(JSON.parse(captured.init.body).stream, false)
  assert.equal(JSON.parse(captured.init.body).keep_alive, '10m')
  assert.equal(JSON.parse(captured.init.body).options.num_ctx, 2048)
  assert.equal(request.options.num_predict, 768)
  assert.match(request.system, /1 to 3 distinct/)
})

test('near-duplicate AI stories are returned only once', async () => {
  const duplicate = {
    stories: [
      { title: 'Sign in securely', narrative: 'As a registered user, I want to sign in securely, so that I can access my authorized workspace.', scenarios: [{ given: 'a registered account', when: 'the user signs in', then: 'the authorized workspace opens' }] },
      { title: 'Secure workspace sign-in', narrative: 'As a registered user, I want to sign in securely using my credentials, so that I can access my authorized workspace without being redirected to a login page.', scenarios: [{ given: 'a registered account', when: 'the user provides credentials', then: 'the authorized workspace opens' }] }
    ]
  }
  const service = createStorySuggestionService({ provider: 'ollama', model: 'local-story-model', fetchImpl: async () => response({ response: JSON.stringify(duplicate) }) })
  const suggested = await service.suggest({ changeCase, governance, correlationId: 'trace-dedupe' })
  assert.equal(suggested.suggestions.length, 1)
})

test('Ollama only accepts a loopback endpoint and explains when it is unavailable', async () => {
  const remote = createStorySuggestionService({ provider: 'ollama', model: 'local-story-model', ollamaBaseUrl: 'http://example.test:11434', fetchImpl: async () => response({}) })
  assert.equal(remote.status().configured, false)
  const offline = createStorySuggestionService({ provider: 'ollama', model: 'local-story-model', fetchImpl: async () => { throw new Error('connection refused') } })
  await assert.rejects(() => offline.suggest({ changeCase, governance, correlationId: 'trace-offline' }), { message: /Local Ollama is unavailable/ })
})
