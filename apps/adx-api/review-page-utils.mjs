/** Escape retained values before placing them in authoritative HTML views. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}

/** Serialize route configuration safely for an inline script. */
export function htmlScriptConfig(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}
