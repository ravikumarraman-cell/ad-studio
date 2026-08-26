import { statSync } from 'node:fs'

export function selectPreviewCheckout(...values) {
  const configured = values.map((value) => typeof value === 'string' ? value.trim() : '').filter(Boolean)
  for (const value of configured) {
    try { if (statSync(value).isDirectory()) return value } catch {}
  }
  return configured[0] ?? null
}
