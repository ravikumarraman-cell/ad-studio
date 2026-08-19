import { randomUUID } from 'node:crypto'
import { ChangeCaseError, sha256 } from './change-case-ledger.mjs'

/** Stage 7 starts with a provider-neutral, non-mutating delivery boundary. */
export function createPreviewGitProvider({ providerId, repositories }) {
  if (typeof providerId !== 'string' || !providerId.trim() || !Array.isArray(repositories) || !repositories.length) throw new ChangeCaseError('GIT_PROVIDER_INVALID', 'A provider identifier and registered repositories are required.')
  const registered = new Map(repositories.map((repository) => { if (!repository || typeof repository.repositoryId !== 'string' || !repository.repositoryId.trim() || typeof repository.canonicalRemote !== 'string' || !repository.canonicalRemote.startsWith('https://') || typeof repository.defaultBaseRef !== 'string' || !repository.defaultBaseRef.startsWith('refs/heads/')) throw new ChangeCaseError('GIT_REPOSITORY_REGISTRATION_INVALID', 'Registered repositories require an ID, canonical HTTPS remote, and heads base ref.'); return [repository.repositoryId, Object.freeze({ repositoryId: repository.repositoryId, canonicalRemote: repository.canonicalRemote, defaultBaseRef: repository.defaultBaseRef })] }))
  return Object.freeze({ providerId: providerId.trim(), mode: 'PREVIEW_ONLY', capabilities: Object.freeze({ branchPreview: true, commitPreview: true, pullRequestPreview: true, ciTrigger: false, reviewFindingIngestion: false, merge: false }), repository(repositoryId) { const repository = registered.get(repositoryId); if (!repository) throw new ChangeCaseError('GIT_REPOSITORY_DENIED', 'The repository is not registered for this provider.'); return repository } })
}

export function createPreviewDeliveryPlan({ provider, changeCaseId, repositoryId, baseRef, candidateDigest, evidenceDigest, changes, title }) {
  if (provider?.mode !== 'PREVIEW_ONLY') throw new ChangeCaseError('GIT_PREVIEW_PROVIDER_REQUIRED', 'Stage 7 plans require a preview-only provider.')
  if (!changeCaseId || !candidateDigest?.startsWith('sha256:') || !evidenceDigest?.startsWith('sha256:') || typeof title !== 'string' || !title.trim()) throw new ChangeCaseError('GIT_DELIVERY_INPUT_INVALID', 'Change Case, candidate, evidence, and title are required for a preview delivery plan.')
  const repository = provider.repository(repositoryId); const requestedBaseRef = baseRef ?? repository.defaultBaseRef
  if (requestedBaseRef !== repository.defaultBaseRef) throw new ChangeCaseError('GIT_BASE_REF_DENIED', 'Preview delivery must use the registered repository base ref.')
  const normalizedChanges = normalizeChanges(changes); const changeDigest = sha256(normalizedChanges); const branch = `adx/preview/${changeCaseId}`; const commitDigest = sha256({ schema: 'adx-preview-commit-v1', repository: repository.canonicalRemote, baseRef: requestedBaseRef, candidateDigest, evidenceDigest, changes: normalizedChanges }); const pullRequestDigest = sha256({ schema: 'adx-preview-pr-v1', repository: repository.canonicalRemote, branch, baseRef: requestedBaseRef, commitDigest, title: title.trim() })
  return Object.freeze({ planId: randomUUID(), mode: 'PREVIEW_ONLY', providerId: provider.providerId, repository, changeCaseId, baseRef: requestedBaseRef, branch, candidateDigest, evidenceDigest, changes: normalizedChanges, changeDigest, commitDigest, pullRequest: Object.freeze({ title: title.trim(), digest: pullRequestDigest, externalReference: `preview:${pullRequestDigest.slice(7, 31)}` }) })
}

export class PreviewDeliveryRegistry {
  #plans = new Map()
  submit(plan) { if (plan?.mode !== 'PREVIEW_ONLY' || !plan.pullRequest?.digest) throw new ChangeCaseError('GIT_PREVIEW_PLAN_INVALID', 'A valid preview plan is required.'); const existing = this.#plans.get(plan.pullRequest.digest); if (existing) return Object.freeze({ accepted: true, deduplicated: true, plan: existing }); this.#plans.set(plan.pullRequest.digest, plan); return Object.freeze({ accepted: true, deduplicated: false, plan }) }
  assertCandidateCurrent(plan, candidateDigest) { if (candidateDigest !== plan?.candidateDigest) throw new ChangeCaseError('GIT_CANDIDATE_STALE', 'The candidate digest no longer matches the preview branch plan.'); return true }
}

function normalizeChanges(changes) { if (!Array.isArray(changes) || !changes.length) throw new ChangeCaseError('GIT_CHANGESET_REQUIRED', 'A preview delivery requires at least one candidate change.'); const seen = new Set(); return Object.freeze(changes.map((change) => { if (!change || typeof change.path !== 'string' || !change.path.trim() || change.path.startsWith('/') || change.path.includes('..') || typeof change.digest !== 'string' || !change.digest.startsWith('sha256:')) throw new ChangeCaseError('GIT_CHANGESET_INVALID', 'Preview changes require canonical relative paths and content digests.'); if (seen.has(change.path)) throw new ChangeCaseError('GIT_CHANGESET_DUPLICATE_PATH', 'A preview change path may appear only once.'); seen.add(change.path); return Object.freeze({ path: change.path, digest: change.digest }) }).sort((left, right) => left.path.localeCompare(right.path))) }
