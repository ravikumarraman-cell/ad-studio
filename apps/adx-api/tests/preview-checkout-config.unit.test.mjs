import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validatePreviewCheckoutPaths } from '../preview-checkout-config.mjs'

test('preview checkout validation permits no preview checkout configuration', async () => {
  assert.deepEqual(await validatePreviewCheckoutPaths(), { configured: false, sourceRoot: null, candidateRoot: null })
})

test('preview checkout validation requires both configured checkout paths', async () => {
  await assert.rejects(() => validatePreviewCheckoutPaths({ sourceRoot: '/tmp/source' }), { message: 'PREVIEW_CHECKOUT_CONFIGURATION_INCOMPLETE' })
})

test('preview checkout validation rejects unavailable source and non-directory candidate paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adx-preview-checkout-'))
  const source = join(root, 'source'); const file = join(root, 'candidate-file')
  await mkdir(source); await writeFile(file, 'not a directory')
  await assert.rejects(() => validatePreviewCheckoutPaths({ sourceRoot: join(root, 'missing'), candidateRoot: source }), { message: 'PREVIEW_SOURCE_CHECKOUT_UNAVAILABLE' })
  await assert.rejects(() => validatePreviewCheckoutPaths({ sourceRoot: source, candidateRoot: file }), { message: 'PREVIEW_CANDIDATE_CHECKOUT_NOT_DIRECTORY' })
  await rm(root, { recursive: true, force: true })
})

test('preview checkout validation permits a missing candidate under a writable parent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adx-preview-checkout-'))
  const source = join(root, 'source'); const candidate = join(root, 'candidate')
  await mkdir(source)
  const result = await validatePreviewCheckoutPaths({ sourceRoot: source, candidateRoot: candidate })
  assert.equal(result.candidateRoot, candidate)
  await rm(root, { recursive: true, force: true })
})

test('preview checkout validation resolves readable source and candidate directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adx-preview-checkout-'))
  const source = join(root, 'source'); const candidate = join(root, 'candidate')
  await mkdir(source); await mkdir(candidate)
  const result = await validatePreviewCheckoutPaths({ sourceRoot: source, candidateRoot: candidate })
  assert.equal(result.configured, true)
  assert.equal(result.sourceRoot, source)
  assert.equal(result.candidateRoot, candidate)
  await rm(root, { recursive: true, force: true })
})