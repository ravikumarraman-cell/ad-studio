import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = resolve('apps/adx-studio-web/public/samples/adx-health-insurance-features.csv')
const [header, ...rows] = readFileSync(source, 'utf8').trim().split(/\r?\n/)
const columns = header.split(',')
const required = ['feature_id', 'title', 'description', 'priority', 'owner', 'target_repository', 'acceptance_criteria', 'risk_tier']
if (required.some((column) => !columns.includes(column))) throw new Error('FEATURE-IMPORT-SCHEMA: sample is missing a required import column')
if (rows.length !== 3) throw new Error(`FEATURE-IMPORT-COUNT: expected 3 features, found ${rows.length}`)

const seen = new Set()
for (const [index, row] of rows.entries()) {
  const values = row.split(',')
  if (values.length !== columns.length) throw new Error(`FEATURE-IMPORT-ROW: row ${index + 2} has an unexpected column count`)
  const value = (column) => values[columns.indexOf(column)]
  if (!/^HI-\d{4}$/.test(value('feature_id'))) throw new Error(`FEATURE-IMPORT-ID: row ${index + 2} is not a valid feature identifier`)
  if (seen.has(value('feature_id'))) throw new Error(`FEATURE-IMPORT-DUPLICATE: ${value('feature_id')}`)
  seen.add(value('feature_id'))
  if (!['P0', 'P1', 'P2'].includes(value('priority'))) throw new Error(`FEATURE-IMPORT-PRIORITY: row ${index + 2}`)
  if (!['R0', 'R1', 'R2', 'R3', 'R4'].includes(value('risk_tier'))) throw new Error(`FEATURE-IMPORT-RISK: row ${index + 2}`)
  if (required.some((column) => !value(column))) throw new Error(`FEATURE-IMPORT-EMPTY: row ${index + 2}`)
}
console.log('Feature-import sample verification passed: 3 valid, unique health-insurance features.')
