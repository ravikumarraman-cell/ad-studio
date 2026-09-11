import { ChangeCaseError, sha256 } from './change-case-ledger.mjs'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const storyTemplateDirectory = resolve(import.meta.dirname, '../../templates')
const storyTemplateFiles = Object.freeze({
  'user-value-slices': 'story-spec-user-value-slices.md',
  'assurance-boundaries': 'story-spec-assurance-boundaries.md',
  'delivery-slices': 'story-spec-delivery-slices.md',
  'feature-decomposition-playbook': 'story-spec-playbook.md',
})

const storyDefinitions = Object.freeze([
  ['user-value-slices', 'User-value slices', 'Small end-to-end outcomes with one persona and focused BDD evidence.'],
  ['assurance-boundaries', 'Assurance boundaries', 'Privacy, authorization, audit, and recovery where retained context requires them.'],
  ['delivery-slices', 'Delivery slices', 'Reviewable, independently releasable increments for a safe delivery sequence.'],
  ['feature-decomposition-playbook', 'Feature decomposition playbook', 'Maps a business outcome through capabilities, epics, independently deliverable stories, risks, and tests.'],
])

function buildCodingDefinitions() {
  return readdirSync(storyTemplateDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith('coding-spec-') && entry.name.endsWith('.md'))
    .map((entry) => {
      const id = entry.name.slice('coding-spec-'.length, -'.md'.length)
      const { label, description, version, guidance } = readCodingTemplate(entry.name)
      return Object.freeze([id, label, description, guidance, version])
    })
    .sort((left, right) => left[0].localeCompare(right[0]))
}

function readCodingTemplate(fileName) {
  const content = readFileSync(resolve(storyTemplateDirectory, fileName), 'utf8').trim()
  const lines = content.split(/\r?\n/)
  const heading = lines.find((line) => line.startsWith('# '))?.slice(2).trim() ?? fileName.replace(/^coding-spec-/, '').replace(/\.md$/, '').split('-').map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(' ')
  const version = lines.find((line) => line.startsWith('Version:'))?.slice('Version:'.length).trim() || '1.0.0'
  const description = lines.find((line) => line.startsWith('## Goal'))
    ? lines.slice(lines.indexOf('## Goal') + 1).find((line) => line.trim())?.replace(/^[-*]\s*/, '').trim() ?? ''
    : lines.slice(1).find((line) => line.trim() && !line.startsWith('Version:'))?.trim() ?? ''
  return Object.freeze({ label: heading, description, version, guidance: content })
}

const definitions = Object.freeze({
  story: storyDefinitions,
  coding: buildCodingDefinitions(),
})

const catalogs = Object.freeze(Object.fromEntries(Object.entries(definitions).map(([kind, entries]) => [kind, Object.freeze(entries.map(([id, label, description, guidance, declaredVersion]) => {
  const approvedGuidance = kind === 'story' ? readStoryTemplate(id) : guidance
  const version = declaredVersion ?? '1.0.0'
  return Object.freeze({ id, label, description, version, guidance: approvedGuidance, digest: sha256({ schema: 'adx-agent-spec-template-v1', kind, id, version, guidance: approvedGuidance }) })
})) ])))

function readStoryTemplate(id) {
  const file = storyTemplateFiles[id]
  if (!file) throw new Error(`STORY_TEMPLATE_FILE_NOT_ALLOWED: ${id}`)
  return readFileSync(resolve(storyTemplateDirectory, file), 'utf8').trim()
}

export function listAgentSpecTemplates(kind) { return Object.freeze((catalogs[kind] ?? []).map((template) => Object.freeze({ ...template }))) }
export function resolveAgentSpecTemplate(kind, templateId) {
  if (templateId === undefined || templateId === null || templateId === '') return null
  const template = catalogs[kind]?.find((item) => item.id === String(templateId).trim())
  if (!template) throw new ChangeCaseError('AGENT_SPEC_TEMPLATE_NOT_ALLOWED', 'Choose a reviewed agent specification template.', { retryable: false, severity: 'warning' })
  return template
}