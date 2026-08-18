/**
 * ADX's provider-neutral control-plane vocabulary. Integrations may map to
 * these values but must not replace them with provider-specific state names.
 */
export const changeCaseStates = [
  'DRAFT',
  'INTAKE',
  'RISK_REVIEW',
  'DESIGN_REVIEW',
  'EXECUTION_AUTHORIZED',
  'EXECUTING',
  'VERIFICATION_REVIEW',
  'RELEASE_AUTHORIZED',
  'RELEASING',
  'OUTCOME_REVIEW',
  'COMPLETED',
  'PAUSED',
  'CANCELLED',
] as const

export type ChangeCaseState = (typeof changeCaseStates)[number]
export type RiskTier = 'R0' | 'R1' | 'R2' | 'R3' | 'R4'
export type TenantId = string & { readonly __brand: 'TenantId' }
export type ChangeCaseId = string & { readonly __brand: 'ChangeCaseId' }
export type ArtifactDigest = `sha256:${string}`

export interface ChangeCase {
  readonly id: ChangeCaseId
  readonly tenantId: TenantId
  readonly title: string
  readonly state: ChangeCaseState
  readonly riskTier: RiskTier
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface EventEnvelope<TPayload> {
  readonly eventId: string
  readonly aggregateId: ChangeCaseId
  readonly aggregateVersion: number
  readonly eventType: string
  readonly occurredAt: string
  readonly actorId: string
  readonly payload: TPayload
  readonly previousEventDigest?: ArtifactDigest
  readonly eventDigest: ArtifactDigest
}
