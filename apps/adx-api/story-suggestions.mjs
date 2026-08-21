import { ChangeCaseError } from './change-case-ledger.mjs'
import { validateStories } from './intake-governance.mjs'

const maxSuggestions = 3
const providerDefinitions = Object.freeze({
  OPENAI_RESPONSES: Object.freeze({
    label: 'OpenAI Responses',
    endpoint: 'https://api.openai.com/v1/responses'
  }),
  GEMINI_GENERATE_CONTENT: Object.freeze({
    label: 'Google Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models'
  }),
  OLLAMA_LOCAL: Object.freeze({
    label: 'Local Ollama',
    endpoint: 'http://127.0.0.1:11434'
  })
})

export function createStorySuggestionService({ provider, apiKey, model, models, ollamaBaseUrl, fetchImpl = globalThis.fetch } = {}) {
  const providerId = normalizeProvider(provider)
  const allowedModels = configuredModels(model, models)
  const ollamaEndpoint = providerId === 'OLLAMA_LOCAL' ? localOllamaEndpoint(ollamaBaseUrl) : null
  const configured = Boolean(providerId && allowedModels.length && fetchImpl && (providerId === 'OLLAMA_LOCAL' ? ollamaEndpoint : apiKey))
  const status = Object.freeze({ configured, provider: configured ? providerId : null, providerLabel: configured ? providerDefinitions[providerId].label : null, model: configured ? allowedModels[0] : null, models: configured ? allowedModels : [], mode: configured ? 'MODEL_BACKED_PREVIEW' : 'NOT_CONFIGURED' })
  return Object.freeze({
    status: () => status,
    async suggest({ changeCase, governance, correlationId, model: requestedModel }) {
      if (!configured) throw new ChangeCaseError('STORY_AI_NOT_CONFIGURED', configurationMessage(provider), { retryable: false, severity: 'warning' })
      const selectedModel = requestedModel ?? allowedModels[0]
      if (typeof selectedModel !== 'string' || !allowedModels.includes(selectedModel)) throw new ChangeCaseError('STORY_AI_MODEL_NOT_ALLOWED', 'The requested AI model is not enabled for story decomposition.', { retryable: false, severity: 'warning' })
      const request = providerId === 'GEMINI_GENERATE_CONTENT'
        ? geminiRequest({ apiKey, model: selectedModel, changeCase, governance, correlationId })
        : providerId === 'OLLAMA_LOCAL'
          ? ollamaRequest({ endpoint: ollamaEndpoint, model: selectedModel, changeCase, governance, correlationId })
        : openAiRequest({ apiKey, model: selectedModel, changeCase, governance, correlationId })
      let response
      try { response = await fetchImpl(request.url, request.init) } catch { throw new ChangeCaseError('STORY_AI_UNAVAILABLE', providerUnavailableMessage(providerId), { retryable: true, severity: 'warning' }) }
      const payload = await response.json().catch(() => null)
      const requestId = response.headers.get('x-request-id') ?? response.headers.get('x-guploader-uploadid') ?? null
      if (!response.ok) throw new ChangeCaseError('STORY_AI_REQUEST_FAILED', providerFailureMessage(providerId, response.status), { retryable: response.status >= 500 || response.status === 429, severity: 'warning', details: { provider: providerId, providerStatus: response.status, requestId } })
      const raw = providerId === 'GEMINI_GENERATE_CONTENT' ? geminiOutputText(payload) : providerId === 'OLLAMA_LOCAL' ? ollamaOutputText(payload) : openAiOutputText(payload)
      const stories = parseStories(raw)
      return Object.freeze({ provider: providerId, providerLabel: providerDefinitions[providerId].label, model: selectedModel, mode: 'MODEL_BACKED_PREVIEW', suggestions: stories, providerRequestId: requestId })
    }
  })
}

function normalizeProvider(provider) {
  const value = String(provider ?? '').trim().toLowerCase() || 'openai'
  if (value === 'openai' || value === 'openai_responses') return 'OPENAI_RESPONSES'
  if (value === 'gemini' || value === 'gemini_generate_content') return 'GEMINI_GENERATE_CONTENT'
  if (value === 'ollama' || value === 'ollama_local') return 'OLLAMA_LOCAL'
  return null
}

function configurationMessage(provider) {
  if (provider && !normalizeProvider(provider)) return 'AI story suggestions have an unsupported provider. Set ADX_STORY_AI_PROVIDER to openai, gemini, or ollama.'
  return 'AI story suggestions are not configured. Set a provider, an approved model, and provider configuration on the ADX API server.'
}

function configuredModels(defaultModel, configured) {
  const values = [defaultModel, ...(Array.isArray(configured) ? configured : String(configured ?? '').split(','))]
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)
  return Object.freeze([...new Set(values)])
}

function providerFailureMessage(providerId, status) {
  if (status === 403 && providerId === 'GEMINI_GENERATE_CONTENT') return 'Google Gemini rejected this request. Check that the API key belongs to an AI Studio project with Gemini API access and that your corporate network permits generativelanguage.googleapis.com.'
  if (status === 404 && providerId === 'OLLAMA_LOCAL') return 'The selected Ollama model is not installed locally. Pull or import that exact model, then try again.'
  if (status === 404) return 'The selected AI model is unavailable. Choose a model listed in your provider console and in the ADX model picker.'
  if (status === 429) return 'The AI provider rate limit has been reached. Wait for quota to reset or choose another approved model.'
  return 'The AI story-suggestion provider did not return a usable response.'
}

function providerUnavailableMessage(providerId) {
  return providerId === 'OLLAMA_LOCAL'
    ? 'Local Ollama is unavailable. Start Ollama and confirm ADX can reach its loopback URL.'
    : 'The AI story-suggestion provider could not be reached. Check its service status and network configuration.'
}

function localOllamaEndpoint(value) {
  try {
    const url = new URL(value || providerDefinitions.OLLAMA_LOCAL.endpoint)
    const localHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
    if (url.protocol !== 'http:' || !localHosts.has(url.hostname)) return null
    return url.origin
  } catch { return null }
}

function storyPrompt(changeCase, governance) {
  const context = {
    featureTitle: changeCase.title,
    outcome: governance.intent?.outcome ?? '',
    acceptanceCriteria: governance.intent?.acceptanceCriteria ?? '',
    targetRepository: governance.intent?.targetRepository ?? '',
    riskTier: governance.assessment?.riskTier ?? changeCase.riskTier,
    assets: governance.intent?.assets ?? []
  }
  return Object.freeze({
    instructions: 'You are an ADX product-analysis assistant. Propose 1 to 3 distinct, independently valuable, user-centred stories based on feature complexity: use one for a focused outcome, two for a feature with a meaningful secondary user outcome, and three only when the supplied context contains three clearly separate value slices. Do not repeat the same user outcome in different wording, propose implementation tasks, or claim facts absent from the supplied context. Each story must contain title, narrative in “As a…, I want…, so that…” form, and exactly one concise Given/When/Then scenario. Return only valid JSON: {"stories":[{"title":"","narrative":"","scenarios":[{"given":"","when":"","then":""}]}]}. Do not include markdown.',
    context: JSON.stringify(context)
  })
}

function openAiRequest({ apiKey, model, changeCase, governance, correlationId }) {
  const prompt = storyPrompt(changeCase, governance)
  return Object.freeze({ url: providerDefinitions.OPENAI_RESPONSES.endpoint, init: { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'x-client-request-id': correlationId }, body: JSON.stringify({ model, store: false, input: [{ role: 'system', content: prompt.instructions }, { role: 'user', content: prompt.context }] }) } })
}

function geminiRequest({ apiKey, model, changeCase, governance, correlationId }) {
  const prompt = storyPrompt(changeCase, governance)
  return Object.freeze({ url: `${providerDefinitions.GEMINI_GENERATE_CONTENT.endpoint}/${encodeURIComponent(model)}:generateContent`, init: { method: 'POST', headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json', 'x-client-request-id': correlationId }, body: JSON.stringify({ systemInstruction: { parts: [{ text: prompt.instructions }] }, contents: [{ role: 'user', parts: [{ text: prompt.context }] }], generationConfig: { responseMimeType: 'application/json' } }) } })
}

function ollamaRequest({ endpoint, model, changeCase, governance, correlationId }) {
  const prompt = storyPrompt(changeCase, governance)
  // A local CPU model can otherwise spend minutes elaborating on a small feature.
  // The response contract only needs a compact set of draft cards; authors retain
  // complete control to edit or add stories after generation.
  return Object.freeze({ url: `${endpoint}/api/generate`, init: { method: 'POST', headers: { 'content-type': 'application/json', 'x-client-request-id': correlationId }, body: JSON.stringify({ model, system: `${prompt.instructions} For this latency-sensitive local request, generate no more than three stories and one scenario per story. Keep every field concise. Finish the JSON object before stopping.`, prompt: prompt.context, format: storyResponseSchema(), stream: false, keep_alive: '10m', options: { temperature: 0.2, num_ctx: 2048, num_predict: 320 } }) } })
}

function storyResponseSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['stories'],
    properties: {
      stories: {
        type: 'array',
        minItems: 1,
        maxItems: maxSuggestions,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'narrative', 'scenarios'],
          properties: {
            title: { type: 'string' },
            narrative: { type: 'string' },
            scenarios: {
              type: 'array',
              minItems: 1,
              maxItems: 1,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['given', 'when', 'then'],
                properties: { given: { type: 'string' }, when: { type: 'string' }, then: { type: 'string' } }
              }
            }
          }
        }
      }
    }
  }
}

function openAiOutputText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text
  const text = payload?.output?.flatMap((item) => item?.content ?? []).find((content) => content?.type === 'output_text')?.text
  if (typeof text !== 'string') throw new ChangeCaseError('STORY_AI_RESPONSE_INVALID', 'The AI provider returned no text response.', { retryable: true, severity: 'warning' })
  return text
}

function geminiOutputText(payload) {
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part?.text ?? '').join('')
  if (typeof text !== 'string' || !text.trim()) throw new ChangeCaseError('STORY_AI_RESPONSE_INVALID', 'The AI provider returned no text response.', { retryable: true, severity: 'warning' })
  return text
}

function ollamaOutputText(payload) {
  if (typeof payload?.response !== 'string' || !payload.response.trim()) throw new ChangeCaseError('STORY_AI_RESPONSE_INVALID', 'Local Ollama returned no text response.', { retryable: true, severity: 'warning' })
  return payload.response
}

function parseStories(raw) {
  let parsed
  try { parsed = JSON.parse(extractJsonObject(raw)) } catch { throw new ChangeCaseError('STORY_AI_RESPONSE_INVALID', 'The AI provider returned an incomplete or invalid story suggestion. Please try again.', { retryable: true, severity: 'warning' }) }
  if (!Array.isArray(parsed?.stories) || parsed.stories.length < 1 || parsed.stories.length > maxSuggestions) throw new ChangeCaseError('STORY_AI_RESPONSE_INVALID', `The AI provider must return between 1 and ${maxSuggestions} stories.`, { retryable: true, severity: 'warning' })
  return deduplicateStories(validateStories(parsed.stories).stories)
}

function extractJsonObject(raw) {
  if (typeof raw !== 'string') return raw
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed
}

const duplicateStopWords = new Set(['a', 'an', 'and', 'as', 'at', 'be', 'by', 'can', 'for', 'from', 'i', 'in', 'is', 'my', 'of', 'on', 'or', 'so', 'that', 'the', 'to', 'using', 'want', 'with'])

function storyTerms(story) {
  return new Set(`${story.title} ${story.narrative}`.toLowerCase().match(/[a-z0-9]+/g)?.filter((term) => !duplicateStopWords.has(term)) ?? [])
}

function isNearDuplicateStory(candidate, existing) {
  const candidateTerms = storyTerms(candidate)
  const existingTerms = storyTerms(existing)
  const overlap = [...candidateTerms].filter((term) => existingTerms.has(term)).length
  return overlap / Math.max(1, Math.min(candidateTerms.size, existingTerms.size)) >= 0.8
}

function deduplicateStories(stories) {
  return stories.reduce((unique, story) => unique.some((existing) => isNearDuplicateStory(story, existing)) ? unique : [...unique, story], [])
}
