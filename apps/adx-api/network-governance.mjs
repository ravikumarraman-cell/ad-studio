import { isIP } from 'node:net'
import { lookup as dnsLookup } from 'node:dns/promises'
import { ChangeCaseError } from './change-case-ledger.mjs'

export function intersectEgress(requested = [], policy = []) {
  const requestedRules = normalizeEgress(requested); const policyRules = normalizeEgress(policy)
  return Object.freeze(requestedRules.filter((rule) => policyRules.some((candidate) => candidate.host === rule.host && candidate.port === rule.port)))
}

export function authorizeEgress({ lease, target }) {
  if (!lease?.capabilities?.network) throw new ChangeCaseError('EXECUTION_ACTION_DENIED', 'The execution lease does not permit network access.')
  const normalized = normalizeTarget(target)
  if (isForbiddenHost(normalized.host)) throw new ChangeCaseError('EXECUTION_EGRESS_DENIED', 'The requested egress target is blocked by the network boundary.', { severity: 'error' })
  if (!lease.egress?.some((rule) => rule.host === normalized.host && rule.port === normalized.port)) throw new ChangeCaseError('EXECUTION_EGRESS_DENIED', 'The requested egress target is not allowlisted by the execution lease.')
  return normalized
}

/** Resolve immediately before connection so an allowlisted hostname cannot rebind to a private address. */
export async function authorizeResolvedEgress({ lease, target, lookup = dnsLookup }) {
  const normalized = authorizeEgress({ lease, target })
  if (isIP(normalized.host)) return normalized
  const addresses = await lookup(normalized.host, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(({ address }) => isForbiddenHost(address))) throw new ChangeCaseError('EXECUTION_EGRESS_DENIED', 'The resolved egress address is blocked by the network boundary.', { severity: 'error' })
  return Object.freeze({ ...normalized, addresses: Object.freeze(addresses.map(({ address }) => address)) })
}

export function normalizeEgress(rules) {
  if (!Array.isArray(rules)) throw new ChangeCaseError('EXECUTION_EGRESS_INVALID', 'Egress policy must be an array.')
  return Object.freeze([...new Map(rules.map((rule) => { const normalized = normalizeTarget(rule); return [`${normalized.host}:${normalized.port}`, normalized] })).values()])
}

function normalizeTarget(value) {
  if (!value || typeof value.host !== 'string') throw new ChangeCaseError('EXECUTION_EGRESS_INVALID', 'Egress target host and port are required.')
  const host = value.host.trim().toLowerCase().replace(/\.$/, ''); const port = Number(value.port ?? 443)
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || /[^a-z0-9.:-]/.test(host)) throw new ChangeCaseError('EXECUTION_EGRESS_INVALID', 'Egress target host or port is invalid.')
  return Object.freeze({ host, port })
}
function isForbiddenHost(host) {
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === 'metadata.google.internal' || host === '169.254.169.254') return true
  const family = isIP(host); if (!family) return false
  if (family === 4) { const [a, b] = host.split('.').map(Number); return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a >= 224 }
  const lower = host.toLowerCase(); return lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('::ffff:')
}
