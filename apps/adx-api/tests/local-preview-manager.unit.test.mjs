import assert from 'node:assert/strict'
import test from 'node:test'
import { LocalPreviewManager } from '../local-preview-manager.mjs'

test('local preview manager builds and exposes only a registered digest-matched profile', async () => {
  const commands = []
  const manager = new LocalPreviewManager({
    profiles: new Map([['example', { id: 'example', label: 'Example', dockerfile: import.meta.filename, context: '/candidate', npmRegistry: 'https://registry.example/npm/', npmrcSecretPath: import.meta.filename, containerPort: 8080, readinessPath: '/ready' }]]),
    digestCandidate: async () => 'sha256:verified',
    runCommand: async (command) => { commands.push(command) },
    waitForReady: async (url) => assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/ready$/),
  })
  const result = await manager.start({ profileId: 'example', candidateDigest: 'sha256:verified', changeCaseId: 'change-case' })
  assert.equal(result.preview.profileId, 'example')
  assert.equal(result.preview.candidateDigest, 'sha256:verified')
  assert.equal(commands[0][0], 'docker')
  assert.equal(commands[0][1], 'build')
  assert.ok(commands[0].includes('NPM_REGISTRY=https://registry.example/npm/'))
  assert.ok(commands[0].includes(`id=npmrc,src=${import.meta.filename}`))
  assert.equal(commands[1][1], 'run')
})

test('local preview manager rejects a source that differs from the verified candidate', async () => {
  const manager = new LocalPreviewManager({ profiles: new Map([['example', { id: 'example', label: 'Example', dockerfile: import.meta.filename, context: '/candidate', containerPort: 8080, readinessPath: '/' }]]), digestCandidate: async () => 'sha256:other' })
  await assert.rejects(() => manager.start({ profileId: 'example', candidateDigest: 'sha256:verified', changeCaseId: 'change-case' }), { code: 'LOCAL_PREVIEW_CANDIDATE_MISMATCH' })
})

test('local preview manager rejects a corporate profile without a configured npm credential secret', async () => {
  const manager = new LocalPreviewManager({ profiles: new Map([['example', { id: 'example', label: 'Example', dockerfile: import.meta.filename, context: '/candidate', npmrcSecretRequired: true, containerPort: 8080, readinessPath: '/' }]]), digestCandidate: async () => 'sha256:verified' })
  await assert.rejects(() => manager.start({ profileId: 'example', candidateDigest: 'sha256:verified', changeCaseId: 'change-case' }), { code: 'LOCAL_PREVIEW_NPM_CREDENTIALS_REQUIRED' })
})

test('local preview manager rejects a candidate Dockerfile that predates the registered build contract', async () => {
  const marker = ['ARG', 'NPM_REGISTRY'].join(' ')
  const manager = new LocalPreviewManager({ profiles: new Map([['example', { id: 'example', label: 'Example', dockerfile: import.meta.filename, context: '/candidate', requiredDockerfileMarkers: [marker], containerPort: 8080, readinessPath: '/' }]]), digestCandidate: async () => 'sha256:verified' })
  await assert.rejects(() => manager.start({ profileId: 'example', candidateDigest: 'sha256:verified', changeCaseId: 'change-case' }), { code: 'LOCAL_PREVIEW_CANDIDATE_STALE' })
})