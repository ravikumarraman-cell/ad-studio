import { resolve } from 'node:path'

export function createApplicationPreviewProfiles({ candidateRoot }) {
  if (typeof candidateRoot !== 'string' || !candidateRoot) return new Map()
  return new Map([['health-x', Object.freeze({
    id: 'health-x',
    label: 'Health-X',
    dockerfile: resolve(candidateRoot, 'apps/health-x/Dockerfile'),
    context: candidateRoot,
    npmRegistry: 'https://edgeinternal1uhg.optum.com/artifactory/api/npm/tenant-compass-npm-vir/',
    npmrcSecretPath: process.env.ADX_PREVIEW_NPMRC_FILE,
    npmrcSecretRequired: true,
    requiredDockerfileMarkers: ['ARG NPM_REGISTRY', 'id=npmrc'],
    containerPort: 3000,
    readinessPath: '/',
  })]])
}