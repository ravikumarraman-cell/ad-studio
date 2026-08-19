import { randomUUID } from 'node:crypto'
import { ChangeCaseError } from './change-case-ledger.mjs'
import { authorizeLeaseAction } from './execution-governance.mjs'

/** Returns only a short-lived broker grant; secret material never enters the lease or agent prompt. */
export function issueSecretBrokerGrant({ lease, secretName, audience, now = new Date() }) {
  authorizeLeaseAction({ lease, action: 'secret_read', now })
  if (typeof secretName !== 'string' || typeof audience !== 'string' || !lease.secretScopes?.some((scope) => scope.name === secretName && scope.audience === audience)) throw new ChangeCaseError('EXECUTION_SECRET_DENIED', 'The requested secret is not scoped to this lease.')
  return Object.freeze({ grantId: randomUUID(), leaseId: lease.leaseId, secretName, audience, expiresAt: lease.expiresAt, delivery: 'GATEWAY_ONLY' })
}
