import { ChangeCaseError } from './change-case-ledger.mjs'

/** Shared, side-effect-free contract rules for model-patch requests and repairs. */
export function requiredStoryOwnerRequirements(story) {
  const text = [
    story.title,
    story.narrative,
    ...story.scenarios.flatMap((scenario) => [scenario.given, scenario.when, scenario.then]),
  ].join(' ').toLowerCase()
  const requirements = [
    { label: 'frontend/page owner', textPattern: /\b(?:view|page|screen|frontend|render|visible|visibility|display)\b/, pathPattern: /(?:^|\/)frontend\/|(?:^|\/)(?:pages?|components?|routes?)(?:\/|\.)/i },
    { label: 'authoritative API or extracted-account data owner', textPattern: /\b(?:api|extract|extracted|financial|source data|account data)\b/, pathPattern: /(?:^|\/)(?:api|routes?|services?|account[^/]*|extract[^/]*|financial[^/]*|aide_lookup[^/]*)(?:\/|\.|_|-)/i },
    { label: 'action persistence owner', textPattern: /\b(?:action|follow[ -]?up|persist|recorded action)\b/, pathPattern: /(?:^|\/)[^/]*(?:action|follow)[^/]*(?:\/|\.|_|-)/i },
    { label: 'notification delivery owner', textPattern: /\b(?:notify|notification|email|recipient)\b/, pathPattern: /(?:^|\/)[^/]*(?:notif|notify|email|mail|message|event|queue|graph|communication|account_field_log|tenant_action)[^/]*(?:\/|\.|_|-)/i },
    { label: 'report owner', textPattern: /\b(?:report|reporting|historical|history|dashboard)\b/, pathPattern: /(?:^|\/)[^/]*(?:report|history|historical|dashboard)[^/]*(?:\/|\.|_|-)/i },
    { label: 'SBL owner', textPattern: /\bsbl\b/, pathPattern: /(?:^|\/)[^/]*sbl[^/]*(?:\/|\.|_|-)/i },
    { label: 'tooling owner', textPattern: /\btooling\b/, pathPattern: /(?:^|\/)(?:sbl(?:\/|\.|_|-)|[^/]*(?:tool|security|servicebasedlaunchpad)[^/]*(?:\/|\.|_|-))/i },
  ]
  return requirements.filter((requirement) => requirement.textPattern.test(text))
}

export function normalizeModelPatchPath(value) {
  if (typeof value !== 'string') return ''
  return value.trim().replaceAll('\\', '/').replace(/^(?:\.\/)+/, '')
}

export function safePatchPath(value) {
  return JSON.stringify(String(value ?? '').slice(0, 240))
}

export function isTestPath(path) {
  return /(^|\/)(__tests__\/|tests?\/)|(^|\/)(?:test_[^/]+|[^/]+_tests?)\.py$|(^|\/)[^/]+\.(?:test|spec)\.[^/]+$/i.test(path)
}

export function unwrapJsonFence(text) {
  const trimmed = String(text ?? '').trim()
  const match = trimmed.match(/^```json\s*\n?([\s\S]*?)\n?```$/i)
  return match ? match[1].trim() : trimmed
}

export function patchResponseError(responseIssue, message, completion, responseCorrection = null, additionalDetails = {}) {
  const finishReason = completion?.finishReason ?? null
  const safeFinishReason = ['stop', 'length', 'content_filter'].includes(finishReason) ? finishReason : null
  const providerRequestId = typeof completion?.providerRequestId === 'string' && completion.providerRequestId.length <= 256
    ? completion.providerRequestId
    : null
  const correction = responseCorrection ?? defaultResponseCorrection(responseIssue)
  return new ChangeCaseError('MODEL_PATCH_RESPONSE_INVALID', message, {
    details: {
      responseIssue,
      responseCorrection: typeof correction === 'string' && correction.length <= 2048 ? correction : null,
      modelFinishReason: safeFinishReason,
      providerRequestId,
      ...additionalDetails,
    },
  })
}

function defaultResponseCorrection(responseIssue) {
  if (responseIssue === 'NON_JSON' || responseIssue === 'SCHEMA_INVALID') return 'Return exactly one JSON object matching responseSchema, with a non-empty patches array, featureSpotlight, and storyCoverage. Do not include markdown or explanatory text.'
  if (responseIssue === 'SEMANTIC_VERIFICATION_SCHEMA_INVALID') return 'Return exactly one adx-candidate-semantic-verification-v1 JSON object. Use passed:true with findings:[], or passed:false with at least one finding containing an approved storyKey, non-empty code/message, and evidencePaths drawn only from supplied files. Do not include any other fields or prose.'
  if (responseIssue === 'SEMANTIC_VERIFICATION_NON_JSON') return 'Return exactly one adx-candidate-semantic-verification-v1 JSON object with no markdown or prose.'
  if (responseIssue === 'PATCH_INVALID') return 'Return only authorized relative writable paths. For each patch, provide either complete string content with no replacements or null content with at least one exact anchored replacement.'
  return null
}
