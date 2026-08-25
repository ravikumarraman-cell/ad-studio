import assert from 'node:assert/strict'
import test from 'node:test'
import { createGitHubDraftPrExecutionService } from '../github-draft-pr-execution-service.mjs'

const plan = { id: 'plan-1', mode: 'PREVIEW_ONLY', branch: 'adx/preview/case-1', candidateDigest: 'sha256:candidate', evidenceDigest: 'sha256:evidence', commitDigest: 'sha256:commit', repository: { canonicalRemote: 'https://github.com/example/ad-studio.git' }, sourceExport: { baseCommit: 'a'.repeat(40), exportDigest: 'sha256:export' } }

test('creates and retains a draft PR only for the exact retained source export', async () => {
  const calls = []; const service = createGitHubDraftPrExecutionService({ deliveryRepository: { execution: async () => null, plan: async () => plan, retainExecution: async (input) => { calls.push(input); return { accepted: true, deduplicated: false, execution: { pullRequestUrl: input.pullRequest.url } } } }, previewCi: { receiveCiStatus: async () => ({ accepted: true }) }, client: { create: async (input) => { calls.push(input); return { number: 42, url: 'https://github.com/example/ad-studio/pull/42', nodeId: 'PR_42' } }, }, servicePrincipal: { type: 'service', id: 'delivery' }, sourceRoot: '/source', candidateRoot: '/candidate', createExport: async () => ({ baseCommit: 'a'.repeat(40), exportDigest: 'sha256:export', changes: [] }) })
  const result = await service.execute({ scope: { organizationId: 'org', workspaceId: 'workspace' }, previewPlanId: 'plan-1' })
  assert.equal(result.execution.pullRequestUrl, 'https://github.com/example/ad-studio/pull/42')
  assert.equal(calls.length, 2)
})

test('rejects a changed source export before GitHub is called', async () => {
  const service = createGitHubDraftPrExecutionService({ deliveryRepository: { execution: async () => null, plan: async () => plan }, previewCi: { receiveCiStatus: async () => assert.fail('CI must not be called') }, client: { create: async () => assert.fail('GitHub must not be called') }, servicePrincipal: { type: 'service', id: 'delivery' }, sourceRoot: '/source', candidateRoot: '/candidate', createExport: async () => ({ baseCommit: 'b'.repeat(40), exportDigest: 'sha256:changed', changes: [] }) })
  await assert.rejects(() => service.execute({ scope: {}, previewPlanId: 'plan-1' }), { code: 'GITHUB_DRAFT_PR_EXPORT_STALE' })
})