/** Pure context-selection rules shared by model-patch batching and verification. */
export function taskSearchText(task) {
  return [
    task.objective,
    ...task.stories.flatMap((story) => [
      story.title,
      story.narrative,
      ...story.scenarios.flatMap((scenario) => [scenario.given, scenario.when, scenario.then]),
    ]),
  ].join('\n')
}

export function contextSearchTerms(task) {
  const ignored = new Set(['about', 'after', 'before', 'being', 'every', 'given', 'implement', 'into', 'must', 'should', 'story', 'that', 'their', 'then', 'these', 'this', 'when', 'where', 'with', 'without'])
  return [...new Set((taskSearchText(task).toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((term) => term.length >= 4 && !ignored.has(term)))]
}

export function contextPathScore(path, terms) {
  const normalizedPath = path.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
  return terms.reduce((score, term) => score + (normalizedPath.includes(term) ? term.length : 0), 0)
}

export function rankContextPaths(allowedPaths, task) {
  const terms = contextSearchTerms(task)
  return [...allowedPaths.entries()].sort((left, right) => contextPathScore(right[0], terms) - contextPathScore(left[0], terms) || left[0].localeCompare(right[0]))
}

/** Returns one literal source excerpt so anchors can never span omitted sections. */
export function contextExcerpt(content, task, byteLimit) {
  const lines = content.split('\n')
  const terms = contextSearchTerms(task)
  let matchedLine = -1
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (terms.some((term) => lines[index].toLowerCase().includes(term))) { matchedLine = index; break }
  }
  const start = Math.max(0, (matchedLine < 0 ? 0 : matchedLine) - 24)
  const selected = []
  let usedBytes = 0
  for (let index = start; index < lines.length; index += 1) {
    const lineBytes = Buffer.byteLength(`${selected.length ? '\n' : ''}${lines[index]}`)
    if (usedBytes + lineBytes > byteLimit) break
    selected.push(lines[index])
    usedBytes += lineBytes
  }
  return selected.join('\n')
}
