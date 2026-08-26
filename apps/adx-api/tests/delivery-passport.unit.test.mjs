import assert from 'node:assert/strict'
import test from 'node:test'
import { validateDeliveryPassport } from '../delivery-passport.mjs'

const passport = { apiVersion: 'adx.io/v1alpha1', kind: 'DeliveryPassport', metadata: { id: 'health-x', displayName: 'Health-X', owner: 'personal-care-demo', classification: 'fictional-demo' }, repository: { canonicalRemote: 'https://example.test/health-x.git', defaultBaseRef: 'refs/heads/main', sourcePath: '.' }, build: { runtime: 'node-22', validateTemplate: 'node-web-production-build' }, preview: { adapter: 'container', dockerfile: 'Dockerfile', context: '.', readiness: { port: 3000, path: '/' }, secretRefs: ['npm-registry-read'] }, capabilities: { agent: { writePaths: ['app/**'], network: 'package-registry-only' }, delivery: { preview: true, production: false } } }

test('validates and digests a constrained preview-only Delivery Passport', () => {
  const result = validateDeliveryPassport(passport)
  assert.equal(result.passport.metadata.id, 'health-x')
  assert.equal(result.passport.capabilities.delivery.production, false)
  assert.ok(result.digest.startsWith('sha256:'))
  assert.equal(Object.isFrozen(result.passport), true)
})

test('rejects path escapes, arbitrary commands, and unapproved adapters', () => {
  assert.throws(() => validateDeliveryPassport({ ...passport, repository: { ...passport.repository, sourcePath: '../escape' } }), { code: 'DELIVERY_PASSPORT_PATH_INVALID' })
  assert.throws(() => validateDeliveryPassport({ ...passport, build: { ...passport.build, validateTemplate: 'npm test && curl example.test' } }), { code: 'DELIVERY_PASSPORT_CAPABILITY_DENIED' })
  assert.throws(() => validateDeliveryPassport({ ...passport, preview: { ...passport.preview, adapter: 'shell' } }), { code: 'DELIVERY_PASSPORT_CAPABILITY_DENIED' })
})

test('rejects production delivery and broad agent write permissions', () => {
  assert.throws(() => validateDeliveryPassport({ ...passport, capabilities: { ...passport.capabilities, delivery: { preview: true, production: true } } }), { code: 'DELIVERY_PASSPORT_CAPABILITY_DENIED' })
  assert.throws(() => validateDeliveryPassport({ ...passport, capabilities: { ...passport.capabilities, agent: { ...passport.capabilities.agent, writePaths: ['**'] } } }), { code: 'DELIVERY_PASSPORT_CAPABILITY_DENIED' })
})