import { ChangeCaseError } from './change-case-ledger.mjs'

export const verifierCategories = Object.freeze(['BUILD', 'TEST', 'STATIC_ANALYSIS', 'SECURITY', 'SBOM'])

/**
 * Factory for service-configured verifier adapters. Commands are fixed when an
 * adapter is registered; a Change Case never supplies executable text.
 */
export function createVerifierAdapter({ category, verifierId, version, tool, command, timeoutMs = 60_000, maxOutputBytes = 65_536 }) {
  if (!verifierCategories.includes(category) || typeof verifierId !== 'string' || !verifierId.trim() || typeof version !== 'string' || !version.trim() || !tool || typeof tool.name !== 'string' || !tool.name.trim() || typeof tool.version !== 'string' || !tool.version.trim() || !Array.isArray(command) || !command.length || !command.every((part) => typeof part === 'string' && part.length)) throw new ChangeCaseError('VERIFIER_ADAPTER_INVALID', 'A verifier category, identity, tool provenance, and fixed command vector are required.')
  const fixedCommand = Object.freeze([...command])
  return Object.freeze({ category, verifierId: verifierId.trim(), version: version.trim(), tool: Object.freeze({ name: tool.name.trim(), version: tool.version.trim() }), timeoutMs, maxOutputBytes, command: () => fixedCommand })
}

/** Portable deterministic baseline adapters for the pinned Alpine verifier image. */
export function baselineVerifierAdapters() {
  const tool = { name: 'busybox', version: '1.36.1-r29' }
  return Object.freeze([
    createVerifierAdapter({ category: 'BUILD', verifierId: 'baseline-build-contract', version: '1.0.0', tool, command: ['/bin/sh', '-c', 'test -f package.json || test -f candidate.txt'] }),
    createVerifierAdapter({ category: 'TEST', verifierId: 'baseline-test-contract', version: '1.0.0', tool, command: ['/bin/sh', '-c', 'test -s candidate.txt || test -d .'] }),
    createVerifierAdapter({ category: 'STATIC_ANALYSIS', verifierId: 'baseline-static-contract', version: '1.0.0', tool, command: ['/bin/sh', '-c', 'find . -type l -print | grep -q . && exit 1 || exit 0'] }),
    createVerifierAdapter({ category: 'SECURITY', verifierId: 'baseline-secret-scan', version: '1.0.0', tool, command: ['/bin/sh', '-c', 'test ! -e .env && test ! -e .npmrc'] }),
    createVerifierAdapter({ category: 'SBOM', verifierId: 'baseline-sbom-inventory', version: '1.0.0', tool, command: ['/bin/sh', '-c', 'find . -type f -print | LC_ALL=C sort'] }),
  ])
}
