/**
 * ADX's provider-neutral control-plane vocabulary. Integrations may map to
 * these values but must not replace them with provider-specific state names.
 */
import workflowContract from './change-case-workflow.json'

/**
 * Canonical workflow metadata consumed by all presentation layers. The JSON
 * artifact is intentionally importable from both the Node control plane and
 * browser bundles, so gate labels and state-to-gate mapping cannot drift.
 */
export const changeCaseWorkflow = workflowContract
export const changeCaseStates = workflowContract.states

export type ChangeCaseState =
  | 'DRAFT'
  | 'INTAKE'
  | 'AWAITING_CLARIFICATION'
  | 'RISK_REVIEW'
  | 'AWAITING_STORY_APPROVAL'
  | 'DESIGN_REVIEW'
  | 'READY_FOR_EXECUTION'
  | 'AWAITING_VERIFICATION'
  | 'READY_FOR_DELIVERY'
  | 'OUTCOME_RECORDED'
  | 'PAUSED'
  | 'CANCELLED'
export type RiskTier = 'R0' | 'R1' | 'R2' | 'R3' | 'R4'
export type OrganizationId = string & { readonly __brand: 'OrganizationId' }
export type WorkspaceId = string & { readonly __brand: 'WorkspaceId' }
export type ChangeCaseId = string & { readonly __brand: 'ChangeCaseId' }
export type ArtifactDigest = `sha256:${string}`

export interface ChangeCase {
  readonly id: ChangeCaseId
  readonly organizationId: OrganizationId
  readonly workspaceId: WorkspaceId
  readonly title: string
  readonly state: ChangeCaseState
  readonly riskTier: RiskTier
  readonly projectionVersion: number
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
