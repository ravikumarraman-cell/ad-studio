import { createHash } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { escapeHtml } from './review-page-utils.mjs'

const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage'])
const sensitiveFileNames = new Set(['.env', '.npmrc'])
const maxFiles = 512
const maxPreviewBytes = 64 * 1024

export async function renderCandidateBrowserPage({ candidateRoot, sourceRoot, baseUrl, verificationUrl, requestedPath = '' }) {
  const root = await realpath(candidateRoot).catch(() => null)
  if (!root) return unavailablePage('The server-configured generated candidate is unavailable.')
  const files = await listFiles(root)
  if (!files.length) return unavailablePage('The server-configured generated candidate contains no browsable files.')
  const selectedPath = normalizePath(requestedPath)
  const selected = selectedPath ? await readCandidateFile(root, selectedPath) : null
  const fileLinks = files.map((path) => `<li><a href="${escapeHtml(candidateUrl(baseUrl, path))}"><code>${escapeHtml(path)}</code></a></li>`).join('')
  const preview = selected ? `<section class="preview"><p class="eyebrow">READ-ONLY FILE</p><h2><code>${escapeHtml(selected.path)}</code></h2><pre>${escapeHtml(selected.content)}</pre>${selected.truncated ? '<p class="muted">Preview truncated at 64 KiB.</p>' : ''}</section>` : `<section class="preview"><p class="muted">Select a file to inspect its retained candidate content.</p></section>`
  const comparisonWorkspace = await createComparisonWorkspace(sourceRoot, root)
  const newWindowLink = comparisonWorkspace
    ? `<a class="editor-action" href="${escapeHtml(vsCodeNewWindowFolderUrl(comparisonWorkspace))}">Compare source and candidate in separate VS Code window</a>`
    : `<a class="editor-action" href="${escapeHtml(vsCodeNewWindowFolderUrl(root))}">Open in separate VS Code window</a>`
  const nextStep = `${newWindowLink}${verificationUrl ? `<a class="verification-action" href="${escapeHtml(verificationUrl)}">Next: run independent verification</a>` : ''}`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ADX Generated Candidate</title><style>:root{color:#172033;background:#f6f8fb;font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0}main{max-width:1180px;margin:auto;padding:34px 20px 56px}header,section{background:#fff;border:1px solid #dce3ee;border-radius:8px;padding:22px;margin:16px 0;box-shadow:0 2px 9px #14213d0a}.eyebrow{margin:0 0 6px;color:#52657f;font-size:.75rem;font-weight:750;letter-spacing:.12em}h1,h2{margin:.2rem 0}h1{font-size:2rem}h2{font-size:1.1rem}.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:18px}.step{padding:11px;border:1px solid #dce3ee;background:#f8fafc;color:#52657f;font-size:.88rem}.step.active{border-color:#11519b;border-left:4px solid #11519b;background:#eef5fd;color:#172033;font-weight:700}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}.editor-action,.verification-action{display:inline-block;padding:10px 13px;border-radius:6px;color:#fff;font-weight:700;text-decoration:none}.editor-action{background:#11519b}.verification-action{background:#0e684a}.next-help{margin:12px 0 0;color:#52657f}.layout{display:grid;grid-template-columns:minmax(240px,340px) minmax(0,1fr);gap:16px}.files{max-height:65vh;overflow:auto}.files ul{margin:0;padding-left:18px}.files li{margin:5px 0}.files a{color:#11519b;font-weight:650;text-decoration:none}.preview{min-width:0;margin:0}pre{margin:14px 0 0;padding:14px;overflow:auto;background:#10243a;color:#eaf2fb;border-radius:6px;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre}.muted{color:#52657f}code{overflow-wrap:anywhere}@media(max-width:760px){main{padding:24px 14px}.steps{grid-template-columns:1fr}.layout{grid-template-columns:1fr}.files{max-height:32vh}}</style></head><body><main><header><p class="eyebrow">RETAINED IMPLEMENTATION CANDIDATE</p><h1>Review generated code</h1><div class="steps" aria-label="Delivery workflow"><div class="step active">1. Review or edit candidate</div><div class="step">2. Run independent verification</div><div class="step">3. Prepare preview plan and draft PR</div></div><p class="muted">Inspect the generated files below. Use VS Code to make any needed correction, save it, then run fresh verification for the exact saved contents.</p><div class="actions"><a class="editor-action" href="${escapeHtml(vsCodeFolderUrl(root))}">Open in VS Code</a>${nextStep}</div><p class="next-help">${verificationUrl ? 'When your review is complete, continue to independent verification. Delivery actions remain blocked until that verification passes.' : 'Independent verification is not available from this candidate view.'}</p></header><div class="layout"><section class="files"><p class="eyebrow">FILES</p><ul>${fileLinks}</ul></section>${preview}</div></main></body></html>`
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
function vsCodeFolderUrl(path) {
  return `vscode://file${encodeURI(path).replace(/#/g, '%23').replace(/\?/g, '%3F')}`
}

function vsCodeNewWindowFolderUrl(path) {
  const args = [{ $mid: 1, scheme: 'file', path }, { forceNewWindow: true }]
  return `vscode://command/vscode.openFolder?${encodeURIComponent(JSON.stringify(args))}`
}

async function createComparisonWorkspace(sourceRoot, candidateRoot) {
  const source = await realpath(sourceRoot).catch(() => null)
  if (!source) return null
  const directory = join(tmpdir(), 'adx-candidate-comparisons')
  const name = createHash('sha256').update(`${source}\0${candidateRoot}`).digest('hex').slice(0, 20)
  const workspacePath = join(directory, `${name}.code-workspace`)
  const workspace = {
    folders: [
      { name: 'Source baseline', path: source },
      { name: 'Modified candidate', path: candidateRoot },
    ],
  }
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await writeFile(workspacePath, `${JSON.stringify(workspace, null, 2)}\n`, { mode: 0o600 })
  return workspacePath
}
