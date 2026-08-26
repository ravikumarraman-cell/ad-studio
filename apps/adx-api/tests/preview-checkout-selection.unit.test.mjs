import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { selectPreviewCheckout } from '../preview-checkout-selection.mjs'

test('selects an existing model or verifier checkout over a missing preview override', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adx-preview-selection-'))
  const existing = join(root, 'existing'); const missing = join(root, 'missing')
  await mkdir(existing)
  assert.equal(selectPreviewCheckout(missing, existing), existing)
  await rm(root, { recursive: true, force: true })
})

test('skips files and preserves the first configured value only when no directory exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adx-preview-selection-'))
  const file = join(root, 'file'); const missing = join(root, 'missing')
  await writeFile(file, 'not a checkout')
  assert.equal(selectPreviewCheckout(file, missing), file)
  assert.equal(selectPreviewCheckout(undefined, '  '), null)
  await rm(root, { recursive: true, force: true })
})