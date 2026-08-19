import assert from 'node:assert/strict'
import { classifyRisk, validateIntent, validateStories } from '../apps/adx-api/intake-governance.mjs'
import { ChangeCaseError } from '../apps/adx-api/change-case-ledger.mjs'

assert.throws(() => validateIntent({ outcome: 'x', owner: '', acceptanceCriteria: 'clear acceptance criterion', targetRepository: 'repo', assets: [], sourceContent: 'retained' }), (error) => error instanceof ChangeCaseError && error.code === 'INTENT_INCOMPLETE')
const intent = validateIntent({ outcome: 'Deliver a traceable authorization feature', owner: 'Operations', acceptanceCriteria: 'A reviewer can demonstrate an accepted request end to end.', targetRepository: 'health-auth-service', assets: [{ name: 'member record', classification: 'restricted' }], sourceContent: 'Feature HI-1001 retained source', sourceName: 'backlog.csv' })
assert.equal(intent.ambiguities.length, 0)
const risk = classifyRisk(intent.normalized, 'R1'); assert.equal(risk.riskTier, 'R4'); assert.equal(risk.explanation.escalated, true)
const stories = validateStories([{ title: 'Submit request', narrative: 'As an operator, I need a governed request.', scenarios: [{ given: 'a valid request', when: 'it is submitted', then: 'a Change Case is created' }] }]); assert.match(stories.digest, /^sha256:/)
assert.throws(() => validateStories([{ title: 'Bad', narrative: 'No scenario', scenarios: [] }]), (error) => error instanceof ChangeCaseError && error.code === 'STORY_INVALID')
console.log('Stage 3 intent completeness, asset-driven risk escalation, and BDD story-contract verification passed.')
