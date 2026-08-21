import { ChangeCaseError, sha256 } from './change-case-ledger.mjs'

const definitions = [
  {
    id: 'user-journey',
    version: '1.0.0',
    label: 'User journey',
    description: 'Split a feature into independently valuable moments along one user journey.',
    guidance: 'Decompose by user journey. Identify the smallest independently valuable moments from entering the workflow through receiving a usable outcome. Keep one persona and one observable user outcome per story. Prefer an end-to-end thin slice over a technical-layer split. Include an exception or recovery story only when retained acceptance criteria require it.'
  },
  {
    id: 'regulated-healthcare',
    version: '1.0.0',
    label: 'Regulated healthcare',
    description: 'Apply patient safety, consent, minimum-necessary access, and auditability considerations when retained context warrants them.',
    guidance: 'For retained regulated-healthcare context, prioritize patient safety, minimum-necessary data access, consent, organization-scoped authorization, clinical accountability, and a retained audit trail. Name the operational persona who receives value. Do not propose diagnosis, treatment, automated clinical decisions, unsupported medical-policy rules, real patient data, or fabricated clinical details. Use a protection or failure scenario when retained context includes consent, access, identity, document matching, or clinical review risk.'
  },
  {
    id: 'delivery-slices',
    version: '1.0.0',
    label: 'Delivery slices',
    description: 'Find small, independently releasable customer outcomes without decomposing into implementation tasks.',
    guidance: 'Decompose into independently releasable delivery slices. Each story must produce a coherent user-visible or operational outcome that can be accepted separately. Sequence discovery, safe action, confirmation, and follow-up only when each is genuinely valuable on its own. Do not split by database, API, UI, test, infrastructure, or deployment layer. Do not invent dependencies or scope not present in retained context.'
  }
]

const skills = Object.freeze(definitions.map((definition) => Object.freeze({ ...definition, guidanceDigest: sha256({ schema: 'adx-story-decomposition-skill-v1', id: definition.id, version: definition.version, guidance: definition.guidance }) })))

export function listStoryDecompositionSkills() {
  return Object.freeze(skills.map(({ guidance, ...skill }) => Object.freeze(skill)))
}

export function resolveStoryDecompositionSkill(skillId) {
  if (skillId === undefined || skillId === null || skillId === '') return null
  if (typeof skillId !== 'string') throw new ChangeCaseError('STORY_SKILL_INVALID', 'Choose a valid ADX story decomposition skill.', { retryable: false, severity: 'warning' })
  const skill = skills.find((item) => item.id === skillId.trim())
  if (!skill) throw new ChangeCaseError('STORY_SKILL_NOT_ALLOWED', 'The selected story decomposition skill is not available.', { retryable: false, severity: 'warning' })
  return skill
}

export function storySkillGuidance(skill) {
  return skill ? `Reviewed ADX skill: ${skill.label} (version ${skill.version}). Apply its guidance only when consistent with retained Feature context and the required JSON schema.\n${skill.guidance}` : ''
}