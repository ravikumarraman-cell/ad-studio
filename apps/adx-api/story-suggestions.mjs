import { ChangeCaseError } from './change-case-ledger.mjs'
import { validateStories } from './intake-governance.mjs'

const maxSuggestions = 8

export function createStorySuggestionService({ apiKey, model, fetchImpl = globalThis.fetch } = {}) {
  const configured = Boolean(apiKey && model && fetchImpl)
  const status = Object.freeze({ configured, provider: configured ? 'OPENAI_RESPONSES' : null, model: configured ? model : null, mode: configured ? 'MODEL_BACKED_PREVIEW' : 'NOT_CONFIGURED' })
  return Object.freeze({
    status: () => status,
    async suggest({ changeCase, governance, correlationId }) {
      if (!configured) throw new ChangeCaseError('STORY_AI_NOT_CONFIGURED', 'AI story suggestions are not configured. Add the server-side ADX_STORY_AI_API_KEY and ADX_STORY_AI_MODEL values.', { retryable: false, severity: 'warning' })
      const response = await fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'x-client-request-id': correlationId },
        body: JSON.stringify({ model, store: false, input: prompt(changeCase, governance) })
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new ChangeCaseError('STORY_AI_REQUEST_FAILED', 'The AI story-suggestion provider did not return a usable response.', { retryable: response.status >= 500 || response.status === 429, severity: 'warning', details: { providerStatus: response.status, requestId: response.headers.get('x-request-id') ?? null } })
      const raw = outputText(payload)
      const stories = parseStories(raw)
      return Object.freeze({ provider: 'OPENAI_RESPONSES', model, mode: 'MODEL_BACKED_PREVIEW', suggestions: stories, providerRequestId: response.headers.get('x-request-id') ?? null })
    }
  })
}

function prompt(changeCase, governance) {
  const context = {
    featureTitle: changeCase.title,
    outcome: governance.intent?.outcome ?? '',
    acceptanceCriteria: governance.intent?.acceptanceCriteria ?? '',
    targetRepository: governance.intent?.targetRepository ?? '',
    riskTier: governance.assessment?.riskTier ?? changeCase.riskTier,
    assets: governance.intent?.assets ?? []
  }
  return [{ role: 'system', content: 'You are an ADX product-analysis assistant. Propose 1 to 8 independently valuable, user-centred stories. Do not propose implementation tasks or claim facts absent from the supplied context. Each story must contain title, narrative in “As a…, I want…, so that…” form, and exactly one Given/When/Then scenario. Return only valid JSON: {"stories":[{"title":"","narrative":"","scenarios":[{"given":"","when":"","then":""}]}]}. Do not include markdown.' }, { role: 'user', content: JSON.stringify(context) }]
}

function outputText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text
  const text = payload?.output?.flatMap((item) => item?.content ?? []).find((content) => content?.type === 'output_text')?.text
  if (typeof text !== 'string') throw new ChangeCaseError('STORY_AI_RESPONSE_INVALID', 'The AI provider returned no text response.', { retryable: true, severity: 'warning' })
  return text
}

function parseStories(raw) {
  let parsed
  try { parsed = JSON.parse(raw) } catch { throw new ChangeCaseError('STORY_AI_RESPONSE_INVALID', 'The AI provider returned an invalid story suggestion.', { retryable: true, severity: 'warning' }) }
  if (!Array.isArray(parsed?.stories) || parsed.stories.length > maxSuggestions) throw new ChangeCaseError('STORY_AI_RESPONSE_INVALID', `The AI provider must return between 1 and ${maxSuggestions} stories.`, { retryable: true, severity: 'warning' })
  return validateStories(parsed.stories).stories
}
