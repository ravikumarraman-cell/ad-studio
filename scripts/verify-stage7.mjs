import assert from 'node:assert/strict'
import { createPreviewDeliveryPlan, createPreviewGitProvider, PreviewDeliveryRegistry } from '../apps/adx-api/git-delivery-preview.mjs'
import { ChangeCaseError } from '../apps/adx-api/change-case-ledger.mjs'

const provider = createPreviewGitProvider({ providerId: 'github-preview', repositories: [{ repositoryId: 'adx-studio', canonicalRemote: 'https://github.com/ravikumarraman-cell/ad-studio.git', defaultBaseRef: 'refs/heads/main' }] })
const plan = createPreviewDeliveryPlan({ provider, changeCaseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', repositoryId: 'adx-studio', candidateDigest: 'sha256:candidate-v1', evidenceDigest: 'sha256:evidence-v1', changes: [{ path: 'apps/adx-api/server.mjs', digest: 'sha256:server-v1' }], title: 'Preview governed delivery' })
assert.equal(plan.mode, 'PREVIEW_ONLY'); assert.equal(plan.branch, 'adx/preview/cccccccc-cccc-4ccc-8ccc-cccccccccccc'); assert.equal(provider.capabilities.merge, false)
const registry = new PreviewDeliveryRegistry(); assert.equal(registry.submit(plan).deduplicated, false); assert.equal(registry.submit(plan).deduplicated, true); assert.equal(registry.assertCandidateCurrent(plan, 'sha256:candidate-v1'), true)
assert.throws(() => createPreviewDeliveryPlan({ provider, changeCaseId: 'cc', repositoryId: 'wrong-repository', candidateDigest: 'sha256:candidate-v1', evidenceDigest: 'sha256:evidence-v1', changes: [{ path: 'safe.mjs', digest: 'sha256:one' }], title: 'wrong repo' }), (error) => error instanceof ChangeCaseError && error.code === 'GIT_REPOSITORY_DENIED')
assert.throws(() => createPreviewDeliveryPlan({ provider, changeCaseId: 'cc', repositoryId: 'adx-studio', baseRef: 'refs/heads/other', candidateDigest: 'sha256:candidate-v1', evidenceDigest: 'sha256:evidence-v1', changes: [{ path: 'safe.mjs', digest: 'sha256:one' }], title: 'wrong base' }), (error) => error instanceof ChangeCaseError && error.code === 'GIT_BASE_REF_DENIED')
assert.throws(() => registry.assertCandidateCurrent(plan, 'sha256:candidate-v2'), (error) => error instanceof ChangeCaseError && error.code === 'GIT_CANDIDATE_STALE')
console.log('Stage 7 preview-only Git provider, registered-repository, deterministic branch/commit/PR plan, duplicate prevention, and stale-candidate verification passed.')
