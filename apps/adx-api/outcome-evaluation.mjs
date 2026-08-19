import { ChangeCaseError, sha256 } from './change-case-ledger.mjs'

export function createEvaluationSet({ version, exports }) {
  if (typeof version !== 'string' || !version.trim() || !Array.isArray(exports) || !exports.length || !exports.every((item) => item?.exportDigest?.startsWith('sha256:'))) throw new ChangeCaseError('EVALUATION_SET_INVALID', 'An immutable evaluation version and redacted exports are required.')
  const rows = [...exports].sort((left, right) => left.exportDigest.localeCompare(right.exportDigest))
  return Object.freeze({ schema: 'adx-outcome-evaluation-set-v1', version: version.trim(), exports: Object.freeze(rows), digest: sha256({ version: version.trim(), exportDigests: rows.map((item) => item.exportDigest) }) })
}

export function compareOutcomeBaseline({ baseline, current }) {
  if (!baseline?.digest || !current?.digest) throw new ChangeCaseError('EVALUATION_BASELINE_INVALID', 'Immutable baseline and current evaluation sets are required.')
  const summarize = (set) => { const total = set.exports.length; const successes = set.exports.filter((item) => item.outcome === 'SUCCESS').length; const rollbacks = set.exports.filter((item) => item.outcome === 'ROLLED_BACK').length; return Object.freeze({ total, successRate: successes / total, rollbackRate: rollbacks / total }) }
  const baselineMetrics = summarize(baseline); const currentMetrics = summarize(current)
  return Object.freeze({ baselineDigest: baseline.digest, currentDigest: current.digest, baseline: baselineMetrics, current: currentMetrics, successRateDelta: currentMetrics.successRate - baselineMetrics.successRate, rollbackRateDelta: currentMetrics.rollbackRate - baselineMetrics.rollbackRate, safetyRegression: currentMetrics.rollbackRate > baselineMetrics.rollbackRate })
}
