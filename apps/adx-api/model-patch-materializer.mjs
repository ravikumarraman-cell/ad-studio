import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { ChangeCaseError } from './change-case-ledger.mjs'
import { unwrapJsonFence } from './model-patch-contract.mjs'

/** Applies already-authorized patches with deterministic anchor and retention safeguards. */
export function createModelPatchMaterializer({ maxAnchoredOldTextBytes, patchResponseError } = {}) {
  if (!Number.isInteger(maxAnchoredOldTextBytes) || maxAnchoredOldTextBytes < 1 || typeof patchResponseError !== 'function') throw new TypeError('PATCH_MATERIALIZER_CONFIGURATION_INVALID')

  function mergeStagedPatchResponse(text, stagedPatches) {
    if (!stagedPatches.size) return text
    let response
    try { response = JSON.parse(unwrapJsonFence(text)) } catch { return text }
    if (!Array.isArray(response?.patches)) return text
    const merged = new Map(stagedPatches)
    for (const patch of response.patches) {
      const path = typeof patch?.path === 'string' ? patch.path.trim() : ''
      if (path) merged.set(path, patch)
    }
    return JSON.stringify({ ...response, patches: [...merged.values()] })
  }

  async function materializeValidatedPatches(root, patches, completion) {
    const materialized = []
    for (const patch of patches) {
      let content = await readFile(join(root, patch.path), 'utf8').catch(() => null)
      const existingContent = content
      if (patch.content !== null) {
        if (content !== null && isDestructiveReplacement(content, patch.content)) throw patchResponseError(
          'PATCH_DESTRUCTIVE_REWRITE', `Replacement for ${patch.path} would remove unrelated existing behavior.`, completion,
          `Preserve unrelated behavior in ${patch.path}. Because it is an existing file, set content:null and use exact anchored replacements copied from the supplied content. Do not return complete file content, a partial function, class, or snippet.`,
        )
        materialized.push(patch)
        continue
      }
      if (content === null) throw patchResponseError(
        'PATCH_ANCHOR_TARGET_MISSING', `Anchored replacement target ${patch.path} does not exist.`, completion,
        `Emit complete replacement content for new file ${patch.path}; anchored replacements are only valid for existing files.`,
      )
      for (const replacement of patch.replacements) {
        const minimized = minimizeAnchoredReplacement(content, replacement)
        if (!minimized) throw patchResponseError(
          'PATCH_REPLACEMENT_TOO_BROAD', `Anchored replacement for ${patch.path} is too broad to minimize safely.`, completion,
          `For ${patch.path}, split the change into smaller exact anchors (at most ${maxAnchoredOldTextBytes} bytes of oldText each). Do not replace a whole function or file.`,
        )
        let first = content.indexOf(minimized.oldText)
        let last = content.lastIndexOf(minimized.oldText)
        let replacedLength = minimized.oldText.length
        if (first < 0) {
          const whitespaceMatch = whitespaceEquivalentAnchorRange(content, minimized.oldText)
          if (whitespaceMatch) { first = whitespaceMatch.start; last = whitespaceMatch.start; replacedLength = whitespaceMatch.end - whitespaceMatch.start }
        }
        if (first < 0 || first !== last) throw patchResponseError(
          'PATCH_ANCHOR_NOT_UNIQUE', `Anchored replacement for ${patch.path} must match exactly once.`, completion,
          anchorCorrection(patch.path, content, minimized.oldText),
        )
        content = `${content.slice(0, first)}${minimized.newText}${content.slice(first + replacedLength)}`
      }
      if (isDestructiveReplacement(existingContent, content)) throw patchResponseError(
        'PATCH_DESTRUCTIVE_REWRITE', `Anchored replacements for ${patch.path} would remove unrelated existing behavior.`, completion,
        `Preserve unrelated behavior in ${patch.path}. Use smaller exact anchored replacements copied from the supplied content; do not replace a whole function or file when only a funding change is required.`,
      )
      materialized.push(Object.freeze({ path: patch.path, content, replacements: Object.freeze([]) }))
    }
    return Object.freeze(materialized)
  }

  async function writeMaterializedPatch(root, patch) {
    const target = resolve(root, patch.path)
    if (!target.startsWith(`${root}/`)) throw new ChangeCaseError('MODEL_PATCH_PATH_ESCAPE', 'A model-patch path escaped the disposable candidate.')
    if (typeof patch.content !== 'string' || patch.replacements.length) throw new ChangeCaseError('MODEL_PATCH_PLAN_INVALID', 'Only a validated materialized patch can be written to the candidate.')
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, patch.content, 'utf8')
  }

  function minimizeAnchoredReplacement(content, replacement) {
    if (Buffer.byteLength(replacement.oldText) <= maxAnchoredOldTextBytes) return replacement
    if (content.indexOf(replacement.oldText) < 0 || content.indexOf(replacement.oldText) !== content.lastIndexOf(replacement.oldText)) return null
    const oldText = replacement.oldText
    const newText = replacement.newText
    let prefixLength = 0
    while (prefixLength < oldText.length && prefixLength < newText.length && oldText[prefixLength] === newText[prefixLength]) prefixLength += 1
    let suffixLength = 0
    while (suffixLength < oldText.length - prefixLength && suffixLength < newText.length - prefixLength && oldText[oldText.length - 1 - suffixLength] === newText[newText.length - 1 - suffixLength]) suffixLength += 1
    const oldDelta = oldText.slice(prefixLength, oldText.length - suffixLength)
    const newDelta = newText.slice(prefixLength, newText.length - suffixLength)
    if (Buffer.byteLength(oldDelta) > 512) return null
    let contextSize = 192
    while (contextSize >= 0) {
      const before = oldText.slice(Math.max(0, prefixLength - contextSize), prefixLength)
      const afterStart = oldText.length - suffixLength
      const after = oldText.slice(afterStart, Math.min(oldText.length, afterStart + contextSize))
      const candidate = { oldText: `${before}${oldDelta}${after}`, newText: `${before}${newDelta}${after}` }
      if (candidate.oldText && Buffer.byteLength(candidate.oldText) <= maxAnchoredOldTextBytes && content.indexOf(candidate.oldText) === content.lastIndexOf(candidate.oldText)) return candidate
      contextSize -= 32
    }
    return null
  }

  return Object.freeze({ mergeStagedPatchResponse, materializeValidatedPatches, writeMaterializedPatch })
}

function isDestructiveReplacement(existingContent, replacementContent) {
  const existingBytes = Buffer.byteLength(existingContent)
  if (existingBytes < 1024) return false
  if (Buffer.byteLength(replacementContent) < existingBytes * 0.85) return true
  const sourceLines = existingContent.split('\n').map((line) => line.trim()).filter(Boolean)
  if (sourceLines.length < 8) return false
  const replacementCounts = new Map()
  for (const line of replacementContent.split('\n').map((line) => line.trim()).filter(Boolean)) replacementCounts.set(line, (replacementCounts.get(line) ?? 0) + 1)
  let retained = 0
  for (const line of sourceLines) {
    const available = replacementCounts.get(line) ?? 0
    if (!available) continue
    replacementCounts.set(line, available - 1)
    retained += 1
  }
  return retained / sourceLines.length < 0.75
}

function whitespaceEquivalentAnchorRange(content, oldText) {
  const anchorLines = oldText.split('\n').map((line) => line.trim()).filter(Boolean)
  if (!anchorLines.length) return null
  const contentLines = []
  for (const match of content.matchAll(/.*(?:\n|$)/g)) {
    const text = match[0].endsWith('\n') ? match[0].slice(0, -1) : match[0]
    if (text.trim()) contentLines.push({ text: text.trim(), start: match.index, end: match.index + text.length })
  }
  const matches = []
  for (let index = 0; index <= contentLines.length - anchorLines.length; index += 1) {
    if (anchorLines.every((line, offset) => contentLines[index + offset].text === line)) matches.push({ start: contentLines[index].start, end: contentLines[index + anchorLines.length - 1].end })
  }
  return matches.length === 1 ? matches[0] : null
}

function anchorCorrection(path, content, oldText) {
  const matchCount = oldText ? content.split(oldText).length - 1 : 0
  const currentExcerpt = matchCount === 0 ? currentAnchorExcerpt(content, oldText) : null
  const excerptCorrection = currentExcerpt ? ` Copy oldText exactly from this current candidate excerpt: ${JSON.stringify(currentExcerpt)}.` : ''
  return `For ${path}, the rejected oldText ${JSON.stringify(oldText.slice(0, 500))} matched ${matchCount} times. Do not reuse that exact oldText.${excerptCorrection} Select the intended occurrence and copy a larger contiguous block including adjacent unchanged lines until it occurs exactly once. Do not shorten, paraphrase, or combine separate excerpts.`
}

function currentAnchorExcerpt(content, oldText) {
  const contentLines = content.split('\n')
  const anchorLines = [...new Set(oldText.split('\n').map((line) => line.trim()).filter(Boolean))]
  const normalizedContent = contentLines.map((line) => line.trim())
  const candidates = []
  for (const anchorLine of anchorLines) for (let lineIndex = 0; lineIndex < normalizedContent.length; lineIndex += 1) {
    if (normalizedContent[lineIndex] !== anchorLine) continue
    const neighborhood = new Set(normalizedContent.slice(Math.max(0, lineIndex - 12), Math.min(normalizedContent.length, lineIndex + 13)))
    candidates.push({ lineIndex, score: anchorLines.reduce((total, line) => total + (neighborhood.has(line) ? line.length + 1 : 0), 0), anchorLength: anchorLine.length })
  }
  candidates.sort((left, right) => right.score - left.score || right.anchorLength - left.anchorLength || left.lineIndex - right.lineIndex)
  if (!candidates.length) return null
  return contentLines.slice(Math.max(0, candidates[0].lineIndex - 7), Math.min(contentLines.length, candidates[0].lineIndex + 10)).join('\n')
}
