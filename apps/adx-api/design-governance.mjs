import { ChangeCaseError, canonicalJson, sha256 } from './change-case-ledger.mjs'

const requiredArtifacts = ['architectureDecision', 'interfaceDelta', 'migrationPlan', 'threatModel', 'dependencies', 'testStrategy']

export function validateDesignPackage(input) {
  const missing = requiredArtifacts.filter((key) => !input?.[key] || typeof input[key] !== 'object')
  if (missing.length) throw new ChangeCaseError('DESIGN_ARTIFACTS_INCOMPLETE', 'The required design artifacts are incomplete.', { details: { missing } })
  const normalized = Object.fromEntries(requiredArtifacts.map((key) => [key, normalize(input[key])]))
  const threat = normalized.threatModel
  if (!Array.isArray(threat.threats) || !threat.threats.length || !threat.threats.every((item) => item.id && item.mitigation && item.residualRisk)) throw new ChangeCaseError('THREAT_MODEL_INVALID', 'Threat model requires identified threats, mitigations, and residual risk.')
  if (!Array.isArray(normalized.dependencies.items)) throw new ChangeCaseError('DEPENDENCY_IMPACT_INVALID', 'Dependency and license impact requires an items array.')
  if (!Array.isArray(normalized.testStrategy.layers) || !normalized.testStrategy.layers.length) throw new ChangeCaseError('TEST_STRATEGY_INVALID', 'Test strategy requires at least one verification layer.')
  return Object.freeze({ artifacts: normalized, digest: sha256({ schema: 'adx-design-package-v1', artifacts: normalized }), canonical: canonicalJson(normalized) })
}

export function validateException({ reason, expiresAt }) {
  if (typeof reason !== 'string' || !reason.trim() || Number.isNaN(Date.parse(expiresAt))) throw new ChangeCaseError('DESIGN_EXCEPTION_INVALID', 'An exception reason and ISO expiry are required.')
  if (Date.parse(expiresAt) <= Date.now()) throw new ChangeCaseError('DESIGN_EXCEPTION_EXPIRED', 'An exception must expire in the future.')
  return { reason: reason.trim(), expiresAt: new Date(expiresAt).toISOString() }
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]))
  if (typeof value === 'string') return value.trim()
  return value
}
