import assert from 'node:assert/strict'
import test from 'node:test'
import { escapeHtml, htmlScriptConfig, shortDigest } from '../review-page-utils.mjs'

test('escapes retained HTML and protects inline script configuration', () => {
  assert.equal(escapeHtml('<script>"&\'</script>'), '&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;')
  assert.equal(htmlScriptConfig({ value: '</script><script>alert(1)</script>' }), '{"value":"\\u003c/script>\\u003cscript>alert(1)\\u003c/script>"}')
})

test('shortens only long digests and preserves their edges', () => {
  assert.equal(shortDigest('sha256:short'), 'sha256:short')
  assert.equal(shortDigest('sha256:1234567890123456789012345678901234567890'), 'sha256:12345678901...34567890')
  assert.equal(shortDigest('abcdef', { head: 2, tail: 2 }), 'abcdef')
})