import { ChangeCaseError } from './change-case-ledger.mjs'
import { readdir, realpath } from 'node:fs/promises'
import { createEvidenceBundle, executeVerificationSandbox, provisionVerificationSandbox } from './verification-evidence.mjs'
import { createVerifierAdapter } from './verification-adapters.mjs'

const defaultImage = 'alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc'

const localSuite = createVerifierAdapter({
  category: 'TEST',
  verifierId: 'adx-local-independent-suite',
  version: '1.0.0',
  tool: { name: 'busybox', version: '1.36.1-r29' },
  timeoutMs: 60_000,
  maxOutputBytes: 65_536,
  command: ['/bin/sh', '-ec', 'test -f package.json || test -f candidate.txt\ntest -d .\ntest ! -e .env\ntest ! -e .npmrc\n! find . -type l -print | grep -q .\nfind . -type f -print | LC_ALL=C sort >/dev/null'],
})

export class LocalIndependentVerifier {
  constructor({ evidenceRepository, signer, candidateRoot = process.env.ADX_LOCAL_VERIFIER_CANDIDATE_ROOT, image = process.env.ADX_LOCAL_VERIFIER_IMAGE ?? defaultImage, provision = provisionVerificationSandbox, execute = executeVerificationSandbox, createBundle = createEvidenceBundle } = {}) {
    if (!evidenceRepository || !signer?.privateKey || !signer?.keyId) throw new Error('LOCAL_VERIFIER_CONFIGURATION_REQUIRED')
    this.evidenceRepository = evidenceRepository
    this.signer = signer
    this.candidateRoot = candidateRoot
    this.image = image
    this.provision = provision
    this.execute = execute
    this.createBundle = createBundle
  }

  configured() {
    return Boolean(this.candidateRoot)
  }

  async readiness() {
    if (!this.candidateRoot) return Object.freeze({ ready: false, code: 'LOCAL_VERIFIER_CANDIDATE_REQUIRED' })
    const root = await realpath(this.candidateRoot).catch(() => null)
    if (!root) return Object.freeze({ ready: false, code: 'VERIFIER_CANDIDATE_REQUIRED' })
    return Object.freeze({ ready: await hasFiles(root), code: 'VERIFIER_CANDIDATE_EMPTY' })
  }

  async verify({ scope, changeCaseId }) {
    if (!this.candidateRoot) throw new ChangeCaseError('LOCAL_VERIFIER_CANDIDATE_REQUIRED', 'Independent verification is not configured. Set ADX_LOCAL_VERIFIER_CANDIDATE_ROOT to the checked-out candidate directory on the server.')
    const plan = await this.provision({ candidateRoot: this.candidateRoot, image: this.image, adapter: localSuite, config: { suite: 'adx-local-independent-suite-v1' } })
    const result = await this.execute(plan)
    const evidence = this.createBundle({ plan, result, signer: this.signer })
    const retained = await this.evidenceRepository.retain({ scope, principal: { id: 'service:adx-local-independent-verifier', type: 'service', issuer: 'adx' }, changeCaseId, evidence })
    return { accepted: true, evidenceId: retained.evidenceId, evidenceDigest: evidence.evidenceDigest, candidateDigest: evidence.candidateDigest, status: evidence.status, verifier: evidence.verifier, deduplicated: retained.deduplicated }
  }
}

async function hasFiles(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) { if (entry.isFile()) return true; if (entry.isDirectory() && await hasFiles(`${directory}/${entry.name}`)) return true } return false }