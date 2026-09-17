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
        if (content !== null && isDestructiveReplacement(content, patch.content)) {
          const testRepair = behavioralTestFileRepair(patch.path)
          if (testRepair) throw patchResponseError(
            'PATCH_TEST_REWRITE_REQUIRES_NEW_FILE', `Replacement for ${patch.path} would discard unrelated test behavior.`, completion,
            `Preserve ${patch.path}. Emit complete replacement content for new focused behavioral test ${testRepair.path}; do not rewrite the existing test file.`,
            { requiredResponsePatchPaths: [testRepair.path], newFilePatchRepair: { ...testRepair, rejectedPath: patch.path } },
          )
          const repair = broadAnchorRepair(patch.path, content, { oldText: content, newText: patch.content }, maxAnchoredOldTextBytes)
          throw patchResponseError(
            'PATCH_DESTRUCTIVE_REWRITE', `Replacement for ${patch.path} would remove unrelated existing behavior.`, completion,
            destructiveRewriteCorrection(repair),
            { requiredResponsePatchPaths: [patch.path], broadAnchorRepair: repair },
          )
        }
        materialized.push(patch)
        continue
      }
      if (content === null) {
        const recoveredNewTest = standaloneNewTestPatch(patch)
        if (recoveredNewTest) {
          materialized.push(recoveredNewTest)
          continue
        }
        throw patchResponseError(
          'PATCH_ANCHOR_TARGET_MISSING', `Anchored replacement target ${patch.path} does not exist.`, completion,
          `Emit complete replacement content for new file ${patch.path}; anchored replacements are only valid for existing files.`,
          { requiredResponsePatchPaths: [patch.path], newFilePatchRepair: { path: patch.path } },
        )
      }
      const replacementPlan = []
      for (const replacement of patch.replacements) {
        const minimized = minimizeAnchoredReplacement(content, replacement) ??
          singlePurposeTestReplacement(patch.path, content, replacement)
        if (!minimized) {
          const repair = broadAnchorRepair(patch.path, content, replacement, maxAnchoredOldTextBytes)
          throw patchResponseError(
          'PATCH_REPLACEMENT_TOO_BROAD', `Anchored replacement for ${patch.path} is too broad to minimize safely.`, completion,
          broadAnchorCorrection(repair),
          { requiredResponsePatchPaths: [patch.path], broadAnchorRepair: repair },
        )
        }
        let first = content.indexOf(minimized.oldText)
        let last = content.lastIndexOf(minimized.oldText)
        let replacedLength = minimized.oldText.length
        if (first < 0) {
          const whitespaceMatch = whitespaceEquivalentAnchorRange(content, minimized.oldText)
          if (whitespaceMatch) { first = whitespaceMatch.start; last = whitespaceMatch.start; replacedLength = whitespaceMatch.end - whitespaceMatch.start }
        }
        if (first < 0 || first !== last) {
          const repair = anchorRepair(patch.path, existingContent, minimized.oldText)
          throw patchResponseError(
            'PATCH_ANCHOR_NOT_UNIQUE', `Anchored replacement for ${patch.path} must match exactly once.`, completion,
            anchorCorrection(repair),
            { requiredResponsePatchPaths: [patch.path], anchorRepair: repair },
          )
        }
        replacementPlan.push({ ...minimized, first, replacedLength })
      }
      const hasOverlappingReplacements = replacementPlan.some((replacement, index) => replacementPlan.slice(index + 1)
        .some((other) => replacement.first < other.first + other.replacedLength && other.first < replacement.first + replacement.replacedLength))
      if (hasOverlappingReplacements) throw patchResponseError(
        'PATCH_REPLACEMENT_COLLISION', `Anchored replacements for ${patch.path} overlap.`, completion,
        `For ${patch.path}, combine overlapping changes into one minimal exact anchor copied from the current candidate. Do not make one replacement depend on text changed by another replacement in the same patch.`,
        { requiredResponsePatchPaths: [patch.path] },
      )
      for (const replacement of replacementPlan.sort((left, right) => right.first - left.first)) {
        content = `${content.slice(0, replacement.first)}${replacement.newText}${content.slice(replacement.first + replacement.replacedLength)}`
      }
      if (isDestructiveReplacement(existingContent, content)) {
        const repair = broadAnchorRepair(patch.path, existingContent, { oldText: existingContent, newText: content }, maxAnchoredOldTextBytes)
        throw patchResponseError(
          'PATCH_DESTRUCTIVE_REWRITE', `Anchored replacements for ${patch.path} would remove unrelated existing behavior.`, completion,
          destructiveRewriteCorrection(repair),
          { requiredResponsePatchPaths: [patch.path], broadAnchorRepair: repair },
        )
      }
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

function behavioralTestFileRepair(path) {
  if (!/(?:^|\/)(?:test[^/]*\.py|[^/]+(?:\.test|\.spec)\.[^/]+)$/i.test(path)) return null
  if (/\.py$/i.test(path)) return { path: path.replace(/\.py$/i, '_behavior.py') }
  return { path: path.replace(/(\.(?:test|spec))(?=\.)/i, '.behavior$1') }
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

function standaloneNewTestPatch(patch) {
  if (!isTestFile(patch.path) || patch.replacements.length !== 1) return null
  const content = String(patch.replacements[0]?.newText ?? '')
  if (!looksLikeStandaloneTestModule(patch.path, content)) return null
  return Object.freeze({
    path: patch.path,
    content: content.endsWith('\n') ? content : `${content}\n`,
    replacements: Object.freeze([]),
  })
}

function isTestFile(path) {
  return /(?:^|\/)(?:test_[^/]+\.py|[^/]+_test\.py|[^/]+\.(?:test|spec)\.[^/]+)$/i.test(path)
}

function looksLikeStandaloneTestModule(path, content) {
  if (!content.trim() || /(?:\[\.\.\.|omitted unchanged lines)/i.test(content)) return false
  if (/\.py$/i.test(path)) return /^(?:async\s+def|def)\s+test_\w+/m.test(content)
  return /\b(?:it|test)\s*\(/.test(content)
}

function singlePurposeTestReplacement(path, existingContent, replacement) {
  if (!isTestFile(path)) return null
  const oldText = String(replacement?.oldText ?? '')
  const newText = String(replacement?.newText ?? '')
  if (!oldText || !newText || !existingContent.includes(oldText) || Buffer.byteLength(newText) > Buffer.byteLength(existingContent) * 2) return null
  if (singlePurposeJavascriptTestReplacement(path, existingContent, oldText, newText)) return { oldText, newText }
  const topLevelDefinitions = existingContent.match(/^(?:async\s+def|def|class)\s+\w+/gm) ?? []
  const topLevelTests = existingContent.match(/^(?:async\s+def|def)\s+test_\w+/gm) ?? []
  const replacementTests = newText.match(/^(?:async\s+def|def)\s+test_\w+/gm) ?? []
  const startsAtFileBoundary = existingContent.startsWith(oldText) || /^(?:async\s+def|def)\s+test_\w+/.test(oldText)
  const replacesTheOnlyTest = /^(?:async\s+def|def)\s+test_\w+/m.test(oldText)
  if (
    topLevelDefinitions.length !== 1 ||
    topLevelTests.length !== 1 ||
    replacementTests.length !== 1 ||
    !startsAtFileBoundary ||
    !replacesTheOnlyTest
  ) return null
  return { oldText, newText }
}

function singlePurposeJavascriptTestReplacement(path, existingContent, oldText, newText) {
  if (!/\.(?:jsx?|tsx?)$/i.test(path)) return false
  // A one-case component test has no independent behavior to preserve. It is
  // safe to replace only when the worker provided the exact complete file;
  // multi-case suites still require small anchors and follow the recovery path.
  if (oldText.trimEnd() !== existingContent.trimEnd()) return false
  const describes = existingContent.match(/\bdescribe\s*\(/g) ?? []
  const testCases = existingContent.match(/\b(?:it|test)\s*\(/g) ?? []
  const replacementDescribes = newText.match(/\bdescribe\s*\(/g) ?? []
  const replacementTestCases = newText.match(/\b(?:it|test)\s*\(/g) ?? []
  return describes.length === 1 &&
    testCases.length === 1 &&
    replacementDescribes.length === 1 &&
    replacementTestCases.length === 1
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

function anchorRepair(path, content, oldText) {
  const matchCount = oldText ? content.split(oldText).length - 1 : 0
  const currentExcerpt = matchCount === 0 ? currentAnchorExcerpt(content, oldText) : null
  return Object.freeze({
    path,
    rejectedOldText: oldText.slice(0, 500),
    matchCount,
    currentExcerpt,
  })
}

function anchorCorrection(repair) {
  const excerptCorrection = repair.currentExcerpt ? ` Copy oldText exactly from this current candidate excerpt: ${JSON.stringify(repair.currentExcerpt)}.` : ''
  return `For ${repair.path}, the rejected oldText ${JSON.stringify(repair.rejectedOldText)} matched ${repair.matchCount} times. Do not reuse that exact oldText.${excerptCorrection} Select the intended occurrence and copy a larger contiguous block including adjacent unchanged lines until it occurs exactly once. Do not shorten, paraphrase, or combine separate excerpts.`
}

function broadAnchorRepair(path, content, replacement, maxBytes) {
  const oldText = String(replacement?.oldText ?? '')
  const newText = String(replacement?.newText ?? '')
  let prefixLength = 0
  while (prefixLength < oldText.length && prefixLength < newText.length && oldText[prefixLength] === newText[prefixLength]) prefixLength += 1
  const start = content.indexOf(oldText)
  const excerpt = start < 0
    ? null
    : content.slice(Math.max(0, start + prefixLength - 240), Math.min(content.length, start + prefixLength + 520))
  return Object.freeze({
    path,
    maxOldTextBytes: maxBytes,
    rejectedOldText: oldText.slice(0, 500),
    currentExcerpt: excerpt,
  })
}

function broadAnchorCorrection(repair) {
  const excerptCorrection = repair.currentExcerpt
    ? ` Copy a single exact import, hook, API-call, or JSX block anchor from this current candidate excerpt: ${JSON.stringify(repair.currentExcerpt)}.`
    : ''
  return `For ${repair.path}, the supplied replacement changes too much of one existing block to preserve safely. Replace it with two or more independent exact anchors, each no more than ${repair.maxOldTextBytes} bytes of oldText. Make each anchor a small unchanged boundary surrounding one insertion or expression change; never use a complete function, component body, class, or file as oldText.${excerptCorrection} Do not reuse the broad oldText.`
}

function destructiveRewriteCorrection(repair) {
  const excerptCorrection = repair.currentExcerpt
    ? ` Copy exact oldText from this current candidate excerpt: ${JSON.stringify(repair.currentExcerpt)}.`
    : ''
  return `Preserve unrelated behavior in ${repair.path}. Return exactly one patch for this existing file with content:null and two or more independent exact anchored replacements. Each oldText must be unique, no more than ${repair.maxOldTextBytes} bytes, and must change only one import, hook, API call, JSX block, or assertion boundary. Do not return complete file content, a partial function, class, or snippet.${excerptCorrection}`
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
  if (!candidates.length) {
    const identifiers = [...new Set((oldText.match(/[A-Za-z_$][\w$]{3,}/g) ?? []).filter((token) => !['export', 'default', 'const', 'function', 'return'].includes(token)))]
    for (let lineIndex = 0; lineIndex < normalizedContent.length; lineIndex += 1) {
      const score = identifiers.reduce((total, identifier) => total + (normalizedContent[lineIndex].includes(identifier) ? identifier.length : 0), 0)
      if (score) candidates.push({ lineIndex, score, anchorLength: normalizedContent[lineIndex].length })
    }
  }
  candidates.sort((left, right) => right.score - left.score || right.anchorLength - left.anchorLength || left.lineIndex - right.lineIndex)
  if (candidates.length) return excerptAroundLine(contentLines, candidates[0].lineIndex)
  return excerptAroundLine(contentLines, Math.max(0, contentLines.length - 1))
}

function excerptAroundLine(lines, lineIndex) {
  const excerpt = []
  let size = 0
  for (let index = Math.max(0, lineIndex - 7); index < Math.min(lines.length, lineIndex + 10); index += 1) {
    const line = lines[index]
    if (size + line.length + 1 > 900) break
    excerpt.push(line)
    size += line.length + 1
  }
  return excerpt.join('\n') || null
}
