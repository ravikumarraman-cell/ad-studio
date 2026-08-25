import { ChangeCaseError } from './change-case-ledger.mjs'
import { createCandidateGitExport } from './candidate-git-export.mjs'

export function createGitHubDraftPrExecutionService({ deliveryRepository, previewCi, client, servicePrincipal, sourceRoot, candidateRoot, createExport = createCandidateGitExport }) {
  if (!deliveryRepository || !previewCi || !client || servicePrincipal?.type !== 'service' || !servicePrincipal.id || !sourceRoot || !candidateRoot) throw new Error('GITHUB_DRAFT_PR_EXECUTION_CONFIGURATION_REQUIRED')
  return Object.freeze({
    async execute({ scope, previewPlanId }) {
      const existing = await deliveryRepository.execution(scope, previewPlanId)
      if (existing) return { accepted: true, deduplicated: true, execution: existing }
      const plan = await deliveryRepository.plan(scope, previewPlanId)
      const exported = await createExport({ sourceRoot, candidateRoot, candidateDigest: plan.candidateDigest, canonicalRemote: plan.repository.canonicalRemote })
      if (exported.baseCommit !== plan.sourceExport?.baseCommit || exported.exportDigest !== plan.sourceExport?.exportDigest) throw new ChangeCaseError('GITHUB_DRAFT_PR_EXPORT_STALE', 'The server-owned export no longer matches the retained preview plan. Create a fresh preview plan from current evidence.')
      const pullRequest = await client.create({ plan, exported })
      return deliveryRepository.retainExecution({ scope, principal: servicePrincipal, previewPlanId, commitDigest: plan.commitDigest, providerId: plan.providerId, exportDigest: exported.exportDigest, pullRequest })
    },
    async refreshCi({ scope, previewPlanId }) {
      const plan = await deliveryRepository.plan(scope, previewPlanId)
      const execution = await deliveryRepository.execution(scope, previewPlanId)
      if (!execution) throw new ChangeCaseError('GITHUB_DRAFT_PR_NOT_CREATED', 'Create the retained GitHub draft pull request before collecting CI observations.')
      const runs = await client.workflowRuns({ plan })
      const results = []
      for (const run of runs) results.push(await previewCi.receiveCiStatus({ scope, providerId: plan.providerId, previewPlanId, observation: { ...run, commitDigest: plan.commitDigest } }))
      return { accepted: true, runCount: runs.length, observations: results }
    },
  })
}