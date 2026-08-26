/** Escape retained values before placing them in authoritative HTML views. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}

/** Serialize route configuration safely for an inline script. */
export function htmlScriptConfig(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/** Keep long retained digests readable without changing their bound value. */
export function shortDigest(value, { head = 18, tail = 8 } = {}) {
  const digest = String(value ?? '')
  return digest.length > head + tail + 3 ? `${digest.slice(0, head)}...${digest.slice(-tail)}` : digest
}
