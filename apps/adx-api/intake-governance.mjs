import { ChangeCaseError, canonicalJson, sha256 } from './change-case-ledger.mjs'

export const riskTiers = Object.freeze(['R0', 'R1', 'R2', 'R3', 'R4'])
const assetWeights = Object.freeze({ public: 0, internal: 1, confidential: 2, regulated: 3, restricted: 4 })

export function validateIntent(intent) {
  const required = ['outcome', 'owner', 'acceptanceCriteria', 'targetRepository']
  const missing = required.filter((key) => typeof intent?.[key] !== 'string' || !intent[key].trim())
  if (missing.length) throw new ChangeCaseError('INTENT_INCOMPLETE', 'Intent is missing mandatory delivery information.', { details: { missing } })
  if (!Array.isArray(intent.assets)) throw new ChangeCaseError('INTENT_ASSETS_INVALID', 'Intent assets must be an array.')
  const ambiguities = []
  if (intent.acceptanceCriteria.trim().length < 12) ambiguities.push({ code: 'ACCEPTANCE_CRITERIA_AMBIGUOUS', question: 'What observable outcome proves this work is complete?' })
  if (!intent.sourceContent?.trim()) ambiguities.push({ code: 'SOURCE_CONTENT_MISSING', question: 'Provide the retained source content for this request.' })
  return { normalized: { outcome: intent.outcome.trim(), owner: intent.owner.trim(), acceptanceCriteria: intent.acceptanceCriteria.trim(), targetRepository: intent.targetRepository.trim(), assets: intent.assets.map((asset) => ({ name: String(asset.name ?? '').trim(), classification: String(asset.classification ?? '').toLowerCase() })), sourceContent: intent.sourceContent.trim(), sourceName: String(intent.sourceName ?? 'manual-intake').trim() }, ambiguities }
}

export function classifyRisk(intent, declaredRiskTier) {
  if (!riskTiers.includes(declaredRiskTier)) throw new ChangeCaseError('RISK_TIER_INVALID', 'Declared risk tier is invalid.')
  const factorRows = intent.assets.map((asset) => ({ asset: asset.name || 'unnamed asset', classification: asset.classification, weight: assetWeights[asset.classification] ?? 4 }))
  const assetRisk = Math.max(0, ...factorRows.map((factor) => factor.weight))
  const declared = riskTiers.indexOf(declaredRiskTier)
  const effective = Math.max(declared, assetRisk)
  const riskTier = riskTiers[effective]
  return Object.freeze({ riskTier, explanation: { model: 'adx-intake-risk-v1', declaredRiskTier, effectiveRiskTier: riskTier, escalated: effective > declared, factors: factorRows, rationale: effective > declared ? 'A classified asset requires a higher minimum risk tier.' : 'No asset classification requires risk elevation.' } })
}

export function validateStories(stories) {
  if (!Array.isArray(stories) || !stories.length) throw new ChangeCaseError('STORIES_REQUIRED', 'At least one testable story is required.')
  const normalized = stories.map((story, index) => {
    if (!story || typeof story.title !== 'string' || !story.title.trim() || typeof story.narrative !== 'string' || !story.narrative.trim() || !Array.isArray(story.scenarios) || !story.scenarios.length) throw new ChangeCaseError('STORY_INVALID', `Story ${index + 1} requires title, narrative, and BDD scenarios.`)
    const scenarios = story.scenarios.map((scenario, scenarioIndex) => {
      if (![scenario?.given, scenario?.when, scenario?.then].every((value) => typeof value === 'string' && value.trim())) throw new ChangeCaseError('BDD_SCENARIO_INVALID', `Story ${index + 1}, scenario ${scenarioIndex + 1} requires Given, When, and Then.`)
      return { given: scenario.given.trim(), when: scenario.when.trim(), then: scenario.then.trim() }
    })
    return { key: String(story.key ?? `STORY-${index + 1}`).trim(), title: story.title.trim(), narrative: story.narrative.trim(), scenarios }
  })
  return Object.freeze({ stories: normalized, digest: sha256({ schema: 'adx-story-graph-v1', stories: normalized }), canonical: canonicalJson(normalized) })
}
