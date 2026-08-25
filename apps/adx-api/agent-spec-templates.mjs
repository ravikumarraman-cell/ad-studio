import { ChangeCaseError, sha256 } from './change-case-ledger.mjs'

const definitions = Object.freeze({
  story: [
    ['user-value-slices', 'User-value slices', 'Small end-to-end outcomes with one persona and focused BDD evidence.', 'Use retained context only. Split by independently observable user value, never technical layers. State missing facts as questions. For every story include one persona, one outcome, one Given/When/Then scenario, acceptance evidence, non-goals, and unresolved questions.'],
    ['assurance-boundaries', 'Assurance boundaries', 'Privacy, authorization, audit, and recovery where retained context requires them.', 'Preserve only explicit safety boundaries from retained context. Do not invent clinical, legal, privacy, or identity policy. Make actor, protected resource, permitted action, and observable recovery/audit evidence clear when relevant.'],
    ['delivery-slices', 'Delivery slices', 'Reviewable, independently releasable increments for a safe delivery sequence.', 'Create coherent, independently testable slices. Sequence only proven dependencies. Avoid UI/API/database/infrastructure-only stories. Include acceptance evidence, dependencies, non-goals, and implementation-risk notes.'],
  ],
  coding: [
    ['evidence-first-feature', 'Evidence-first feature', 'New capability with source anchors, non-goals, and criterion-level validation.', 'Implement only approved scope. Before edits identify controlling code, tests, a falsifiable hypothesis, and smallest validation. Do not invent APIs or configuration. Report criterion evidence, changed files, and residual risk.'],
    ['bug-fix-proof', 'Bug fix with proof', 'Root-cause repair with a regression test or a stated test limitation.', 'Locate the controlling failure path before editing. Fix the root cause, not a symptom. Do not hide errors or broaden fallbacks. Prove the regression case and report intentionally unchanged behavior.'],
    ['safe-refactor', 'Safe refactor', 'Maintainability improvement with preserved observable behavior.', 'Identify the behavior contract first. Keep the refactor local and reversible. Do not combine feature work, dependency changes, generated artifacts, or formatting churn. Validate behavior preservation and report remaining follow-up.'],
  ],
})

const catalogs = Object.freeze(Object.fromEntries(Object.entries(definitions).map(([kind, entries]) => [kind, Object.freeze(entries.map(([id, label, description, guidance]) => Object.freeze({ id, label, description, version: '1.0.0', guidance, digest: sha256({ schema: 'adx-agent-spec-template-v1', kind, id, version: '1.0.0', guidance }) }))) ])))

export function listAgentSpecTemplates(kind) { return Object.freeze((catalogs[kind] ?? []).map(({ guidance, ...template }) => Object.freeze(template))) }
export function resolveAgentSpecTemplate(kind, templateId) {
  if (templateId === undefined || templateId === null || templateId === '') return null
  const template = catalogs[kind]?.find((item) => item.id === String(templateId).trim())
  if (!template) throw new ChangeCaseError('AGENT_SPEC_TEMPLATE_NOT_ALLOWED', 'Choose a reviewed agent specification template.', { retryable: false, severity: 'warning' })
  return template
}