import { ChangeCaseError, sha256 } from './change-case-ledger.mjs'
import { validateStories } from './intake-governance.mjs'
import { listAgentSpecTemplates, resolveAgentSpecTemplate } from './agent-spec-templates.mjs'

export const storyDecompositionAgentFunctions = Object.freeze([
  Object.freeze({ id: 'CURATE_RETAINED_CONTEXT', authority: 'READ_ONLY', purpose: 'Selects retained Feature intent, risk, assets, and approved template guidance for the model request.' }),
  Object.freeze({ id: 'DRAFT_USER_VALUE_STORIES', authority: 'MODEL_CALL', purpose: 'Invokes the configured, server-approved story model to propose user-value stories.' }),
  Object.freeze({ id: 'INSPECT_STORY_QUALITY', authority: 'READ_ONLY', purpose: 'Checks the returned set for BDD structure, user-story narrative form, scenario coverage, and duplicate slices.' }),
  Object.freeze({ id: 'ISSUE_RUN_RECEIPT', authority: 'READ_ONLY', purpose: 'Returns digests binding the bounded input and proposed output to this agent run.' })
])

const allowedStates = new Set(['RISK_REVIEW', 'AWAITING_STORY_APPROVAL', 'DESIGN_REVIEW'])

export function createStoryDecompositionAgent({ suggestionService, agentId = 'adx-story-decomposition-agent', agentVersion = '1.0.0' } = {}) {
  if (!suggestionService?.suggest || !suggestionService?.status) throw new ChangeCaseError('STORY_AGENT_SERVICE_REQUIRED', 'A configured story suggestion service is required for the decomposition agent.')
  if (typeof agentId !== 'string' || !agentId.trim() || typeof agentVersion !== 'string' || !agentVersion.trim()) throw new ChangeCaseError('STORY_AGENT_CONFIGURATION_INVALID', 'The story decomposition agent requires a stable identifier and version.')
  const identity = Object.freeze({ agentId: agentId.trim(), agentVersion: agentVersion.trim(), mode: 'BOUNDED_READ_ONLY', functions: storyDecompositionAgentFunctions })
  return Object.freeze({
    status: () => Object.freeze({ ...suggestionService.status(), ...identity, templates: listAgentSpecTemplates('story') }),
    async run({ changeCase, governance, correlationId, model, templateId }) {
      if (!changeCase?.id || !allowedStates.has(changeCase.state)) throw new ChangeCaseError('STORY_AGENT_NOT_ALLOWED', 'The story decomposition agent is available only after risk classification and before delivery execution.', { retryable: false, severity: 'warning' })
      const template = resolveAgentSpecTemplate('story', templateId)
      const guidance = template?.guidance ?? ''
      const context = curateRetainedContext({ changeCase, governance, guidance, model, template })
      console.info(
        `[ADX story decomposition input ${correlationId}]\n${JSON.stringify({
          changeCase,
          governance,
          correlationId,
          model: model ?? null,
          guidance,
          retainedContext: context.retained,
          inputDigest: context.inputDigest,
        }, null, 2)}`,
      )
      const proposal = await suggestionService.suggest({ changeCase, governance, correlationId, model, guidance })
      const inspection = inspectStoryQuality(proposal.suggestions)
      const outputDigest = sha256({ stories: inspection.stories, provider: proposal.provider, model: proposal.model })
      const runDigest = sha256({ schema: 'adx-story-decomposition-agent-run-v1', ...identity, changeCaseId: changeCase.id, inputDigest: context.inputDigest, outputDigest })
      return Object.freeze({
        ...proposal,
        agent: identity,
        mode: 'AGENTIC_PREVIEW_ONLY',
        suggestions: inspection.stories,
        inspection: inspection.report,
        receipt: Object.freeze({ schema: 'adx-story-decomposition-agent-run-v1', changeCaseId: changeCase.id, inputDigest: context.inputDigest, outputDigest, runDigest, correlationId, providerRequestId: proposal.providerRequestId ?? null, template: template ? { id: template.id, version: template.version, digest: template.digest } : null }),
        authority: Object.freeze({ mayPersistStories: false, mayApproveStories: false, mayChangeWorkflowState: false, mayAccessRepository: false, mayExecuteShell: false, mayBrowseNetwork: false, mayAccessBrowserCredentials: false })
      })
    }
  })
}

function curateRetainedContext({ changeCase, governance, guidance, model, template }) {
  if (!governance?.intent?.outcome || !governance?.intent?.acceptanceCriteria) throw new ChangeCaseError('STORY_AGENT_INTENT_REQUIRED', 'Retained Feature intent and acceptance criteria are required before agentic story decomposition.', { retryable: false, severity: 'warning' })
  const openAmbiguities = (governance.ambiguities ?? []).filter((item) => item?.status === 'OPEN').map((item) => item.code)
  if (openAmbiguities.length) throw new ChangeCaseError('STORY_AGENT_CLARIFICATION_REQUIRED', 'Resolve retained intake ambiguities before agentic story decomposition.', { retryable: false, severity: 'warning', details: { ambiguities: openAmbiguities } })
  const retained = Object.freeze({ changeCaseId: changeCase.id, title: changeCase.title, riskTier: governance.assessment?.riskTier ?? changeCase.riskTier, outcome: governance.intent.outcome, acceptanceCriteria: governance.intent.acceptanceCriteria, targetRepository: governance.intent.targetRepository ?? '', assets: governance.intent.assets ?? [], model: model ?? null, template: template ? { id: template.id, version: template.version, digest: template.digest } : null, guidanceDigest: sha256(guidance) })
  return Object.freeze({ retained, inputDigest: sha256({ schema: 'adx-story-decomposition-agent-input-v1', retained }) })
}

function inspectStoryQuality(suggestions) {
  const graph = validateStories(suggestions)
  const findings = []
  for (const story of graph.stories) {
    if (!/^as a .+?, i want .+?, so that .+\.?$/i.test(story.narrative)) findings.push(Object.freeze({ severity: 'warning', code: 'NARRATIVE_FORM', storyKey: story.key, message: 'The narrative does not use the expected As a / I want / so that form.' }))
    if (story.scenarios.length !== 1) findings.push(Object.freeze({ severity: 'warning', code: 'SCENARIO_SCOPE', storyKey: story.key, message: 'The agent should propose one focused BDD scenario per story.' }))
  }
  return Object.freeze({ stories: graph.stories, report: Object.freeze({ schema: 'adx-story-decomposition-quality-v1', storyDigest: graph.digest, validBdd: true, findingCount: findings.length, findings: Object.freeze(findings), authorAction: 'Review, edit, and explicitly submit these proposals. This agent run does not retain stories or advance a workflow gate.' }) })
}