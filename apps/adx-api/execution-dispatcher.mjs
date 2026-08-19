import { sha256 } from './change-case-ledger.mjs'
import { executeDockerSandbox, provisionDockerSandbox } from './sandbox-runtime.mjs'

/** Internal-only bridge; HTTP routes never accept arbitrary sandbox commands. */
export class ExecutionDispatcher {
  constructor({ repository, image, revocationPollMs = 100 }) { this.repository = repository; this.image = image; this.revocationPollMs = revocationPollMs; this.activeRuns = new Map() }
  async dispatchDocker({ scope, leaseId, runId, command, worktrees }) {
    const request = { commandDigest: sha256(command), runtime: 'docker-hardened-v1' }
    let monitor
    const decision = await this.repository.authorizeGatewayAction({ scope, leaseId, runId, action: 'shell', request })
    if (!decision.allowed) return { accepted: false, ...decision }
    const lease = await this.repository.dispatchContext({ scope, leaseId, runId })
    try {
      const plan = await provisionDockerSandbox({ lease, resolvePublicKey: (keyId) => keyId === this.repository.signer.keyId ? this.repository.signer.publicKey : null, worktrees, image: this.image, command })
      const controller = new AbortController(); this.activeRuns.set(runId, controller)
      monitor = setInterval(() => { this.repository.isLeaseActive({ scope, leaseId }).then((active) => { if (!active) controller.abort() }).catch(() => controller.abort()) }, this.revocationPollMs)
      const result = await executeDockerSandbox(plan, { signal: controller.signal })
      clearInterval(monitor); this.activeRuns.delete(runId)
      const completion = await this.repository.completeDispatch({ scope, leaseId, runId, result, request })
      return { accepted: true, ...completion, runtimeImageDigest: plan.runtimeImageDigest, mountInputDigest: plan.mountInputDigest }
    } catch (error) {
      if (monitor) clearInterval(monitor)
      this.activeRuns.get(runId)?.abort(); this.activeRuns.delete(runId)
      await this.repository.completeDispatch({ scope, leaseId, runId, result: { code: 125, signal: null, outputBytes: 0 }, request })
      throw error
    }
  }
  cancel(runId) { const controller = this.activeRuns.get(runId); if (!controller) return false; controller.abort(); return true }
}
