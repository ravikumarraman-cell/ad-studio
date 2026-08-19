import { randomUUID } from 'node:crypto'
import { ChangeCaseError, sha256 } from './change-case-ledger.mjs'

/**
 * Stage 8 starts by describing a release candidate.  This module has no
 * deployment capability: a candidate is an immutable provenance statement,
 * not permission to change an environment.
 */
export function createReleaseCandidate({ changeCaseId, previewPlanId, artifactDigest, candidateDigest, evidenceDigest, commitDigest, approvalDigest, policyVersion }) {
  if (!changeCaseId || !previewPlanId || !isDigest(artifactDigest) || !isDigest(candidateDigest) || !isDigest(evidenceDigest) || !isDigest(commitDigest) || !isDigest(approvalDigest) || typeof policyVersion !== 'string' || !policyVersion.trim()) throw new ChangeCaseError('RELEASE_CANDIDATE_INVALID', 'A release candidate requires Change Case, preview plan, artifact, candidate, evidence, commit, approval, and policy provenance.')
  const provenance = Object.freeze({ artifactDigest, candidateDigest, evidenceDigest, commitDigest, approvalDigest, policyVersion: policyVersion.trim() })
  const provenanceDigest = sha256({ schema: 'adx-release-provenance-v1', changeCaseId, previewPlanId, ...provenance })
  return Object.freeze({ releaseCandidateId: randomUUID(), mode: 'CONTROL_PLANE_ONLY', changeCaseId, previewPlanId, provenance, provenanceDigest, status: 'CANDIDATE', capabilities: Object.freeze({ deploy: false, pause: false, resume: false, rollback: false }) })
}

/** Rejects stale, incomplete, or differently-bound release provenance. */
export function verifyReleaseProvenance({ releaseCandidate, previewPlan, evidence, approval }) {
  if (releaseCandidate?.mode !== 'CONTROL_PLANE_ONLY' || releaseCandidate.status !== 'CANDIDATE') throw new ChangeCaseError('RELEASE_CANDIDATE_REQUIRED', 'A retained release candidate is required.')
  const provenance = releaseCandidate.provenance
  if (!previewPlan || previewPlan.id !== releaseCandidate.previewPlanId || previewPlan.changeCaseId !== releaseCandidate.changeCaseId || previewPlan.candidateDigest !== provenance.candidateDigest || previewPlan.evidenceDigest !== provenance.evidenceDigest || previewPlan.commitDigest !== provenance.commitDigest) throw new ChangeCaseError('RELEASE_PROVENANCE_PREVIEW_MISMATCH', 'Release provenance must match the retained preview plan exactly.')
  if (!evidence || evidence.status !== 'PASS' || evidence.candidateDigest !== provenance.candidateDigest || evidence.evidenceDigest !== provenance.evidenceDigest) throw new ChangeCaseError('RELEASE_PROVENANCE_EVIDENCE_MISMATCH', 'Release provenance requires a passing evidence bundle for the exact candidate.')
  if (!approval || approval.status !== 'ACTIVE' || approval.decision !== 'APPROVED' || approval.commitDigest !== provenance.commitDigest || approvalDigest(approval) !== provenance.approvalDigest) throw new ChangeCaseError('RELEASE_PROVENANCE_APPROVAL_MISMATCH', 'Release provenance requires an active approval for the exact preview commit.')
  return Object.freeze({ verified: true, provenanceDigest: releaseCandidate.provenanceDigest })
}

export class ReleaseCandidateRegistry {
  #candidates = new Map()
  submit(candidate) {
    if (candidate?.mode !== 'CONTROL_PLANE_ONLY' || !candidate.provenanceDigest) throw new ChangeCaseError('RELEASE_CANDIDATE_INVALID', 'A valid control-plane-only release candidate is required.')
    const existing = this.#candidates.get(candidate.provenanceDigest)
    if (existing) return Object.freeze({ accepted: true, deduplicated: true, releaseCandidate: existing })
    this.#candidates.set(candidate.provenanceDigest, candidate)
    return Object.freeze({ accepted: true, deduplicated: false, releaseCandidate: candidate })
  }
}

export const releaseApprovalDigest = (approval) => sha256({ schema: 'adx-preview-approval-v1', previewPlanId: approval.previewPlanId, commitDigest: approval.commitDigest, decision: approval.decision, rationale: approval.rationale, reviewedBy: approval.reviewedBy })
const approvalDigest = releaseApprovalDigest
const isDigest = (value) => typeof value === 'string' && value.startsWith('sha256:')
