import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { escapeHtml } from './review-page-utils.mjs'

const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage'])
const sensitiveFileNames = new Set(['.env', '.npmrc'])
const maxFiles = 512
const maxPreviewBytes = 64 * 1024

export async function renderCandidateBrowserPage({ candidateRoot, baseUrl, requestedPath = '' }) {
  const root = await realpath(candidateRoot).catch(() => null)
  if (!root) return unavailablePage('The server-configured generated candidate is unavailable.')
  const files = await listFiles(root)
  if (!files.length) return unavailablePage('The server-configured generated candidate contains no browsable files.')
  const selectedPath = normalizePath(requestedPath)
  const selected = selectedPath ? await readCandidateFile(root, selectedPath) : null
  const fileLinks = files.map((path) => `<li><a href="${escapeHtml(candidateUrl(baseUrl, path))}"><code>${escapeHtml(path)}</code></a></li>`).join('')
  const preview = selected ? `<section class="preview"><p class="eyebrow">READ-ONLY FILE</p><h2><code>${escapeHtml(selected.path)}</code></h2><pre>${escapeHtml(selected.content)}</pre>${selected.truncated ? '<p class="muted">Preview truncated at 64 KiB.</p>' : ''}</section>` : `<section class="preview"><p class="muted">Select a file to inspect its retained candidate content.</p></section>`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ADX Generated Candidate</title><style>:root{color:#172033;background:#f6f8fb;font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0}main{max-width:1180px;margin:auto;padding:34px 20px 56px}header,section{background:#fff;border:1px solid #dce3ee;border-radius:8px;padding:22px;margin:16px 0;box-shadow:0 2px 9px #14213d0a}.eyebrow{margin:0 0 6px;color:#52657f;font-size:.75rem;font-weight:750;letter-spacing:.12em}h1,h2{margin:.2rem 0}h1{font-size:2rem}h2{font-size:1.1rem}.layout{display:grid;grid-template-columns:minmax(240px,340px) minmax(0,1fr);gap:16px}.files{max-height:65vh;overflow:auto}.files ul{margin:0;padding-left:18px}.files li{margin:5px 0}.files a{color:#11519b;font-weight:650;text-decoration:none}.preview{min-width:0;margin:0}pre{margin:14px 0 0;padding:14px;overflow:auto;background:#10243a;color:#eaf2fb;border-radius:6px;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre}.muted{color:#52657f}code{overflow-wrap:anywhere}@media(max-width:760px){main{padding:24px 14px}.layout{grid-template-columns:1fr}.files{max-height:32vh}}</style></head><body><main><header><p class="eyebrow">RETAINED IMPLEMENTATION CANDIDATE</p><h1>Generated code</h1><p class="muted">Read-only view of the server-retained candidate. This surface cannot modify files, run commands, or approve delivery.</p></header><div class="layout"><section class="files"><p class="eyebrow">FILES</p><ul>${fileLinks}</ul></section>${preview}</div></main></body></html>`
}

function unavailablePage(message) { return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ADX Generated Candidate</title></head><body><main><h1>Generated candidate unavailable</h1><p>${escapeHtml(message)}</p></main></body></html>` }

async function listFiles(root) {
  const files = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
      const fullPath = join(directory, entry.name)
      if (entry.isDirectory()) await visit(fullPath)
      else if (entry.isFile() && !isSensitive(relative(root, fullPath))) files.push(relative(root, fullPath))
      if (files.length >= maxFiles) return
    }
  }
  await visit(root)
  return files.sort()
}

async function readCandidateFile(root, path) {
  if (isSensitive(path)) return null
  const target = resolve(root, path)
  if (!target.startsWith(`${root}/`)) return null
  const stat = await lstat(target).catch(() => null)
  if (!stat?.isFile() || stat.size > maxPreviewBytes * 4) return null
  const content = await readFile(target, 'utf8').catch(() => null)
  if (content === null || content.includes('\u0000')) return null
  return { path, content: content.slice(0, maxPreviewBytes), truncated: Buffer.byteLength(content) > maxPreviewBytes }
}

function normalizePath(value) { const path = typeof value === 'string' ? value.trim() : ''; return path && !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..') ? path : '' }
function isSensitive(path) { return path.split('/').some((part) => sensitiveFileNames.has(part) || part.endsWith('.pem') || part.endsWith('.key')) }
function candidateUrl(baseUrl, path) { return `${baseUrl}?path=${encodeURIComponent(path)}` }
