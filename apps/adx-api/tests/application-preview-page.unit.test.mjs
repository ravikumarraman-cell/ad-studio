import assert from 'node:assert/strict'
import test from 'node:test'
import { renderApplicationPreviewPage } from '../application-preview-page.mjs'

test('preview page offers only retained passing candidates and links an active local preview', () => {
  const page = renderApplicationPreviewPage({ title: 'Preview Health-X', state: 'AWAITING_VERIFICATION', projectionVersion: 9 }, {
    profiles: [{ id: 'health-x', label: 'Health-X' }],
    evidence: [{ status: 'PASS', candidateDigest: 'sha256:verified' }, { status: 'FAIL', candidateDigest: 'sha256:failed' }],
    previews: [{ id: 'preview-1', label: 'Health-X', candidateDigest: 'sha256:verified', url: 'http://127.0.0.1:3456/', startedAt: '2026-08-22T00:00:00.000Z' }],
    canManage: true,
    startEndpoint: '/application-preview-start',
    stopEndpoint: '/application-preview-stop',
  })
  assert.match(page, /Open preview/)
  assert.match(page, /http:\/\/127\.0\.0\.1:3456\//)
  assert.match(page, /sha256:verified/)
  assert.doesNotMatch(page, /sha256:failed/)
  assert.match(page, /application-preview-start/)
})