import { ChangeCaseError } from './change-case-ledger.mjs'

export function createProjectCatalog({ installations }) {
  if (!Array.isArray(installations)) throw new ChangeCaseError('PROJECT_CATALOG_INVALID', 'Project catalog installations must be an array.')
  const catalog = new Map()
  for (const installation of installations) {
    const normalized = normalizeInstallation(installation)
    if (catalog.has(normalized.id)) throw new ChangeCaseError('PROJECT_INSTALLATION_DUPLICATE', 'Project installation IDs must be unique.')
    catalog.set(normalized.id, normalized)
  }
  return Object.freeze({
    list(scope) { return Object.freeze([...catalog.values()].filter((installation) => owns(scope, installation))) },
    get(scope, installationId) {
      const installation = catalog.get(installationId)
      if (!installation || !owns(scope, installation)) throw new ChangeCaseError('PROJECT_INSTALLATION_DENIED', 'The requested project installation is not available in this workspace.')
      return installation
    },
  })
}

function normalizeInstallation(value) {
  const id = text(value?.id); const projectId = text(value?.projectId); const displayName = text(value?.displayName); const organizationId = text(value?.organizationId); const workspaceId = text(value?.workspaceId); const owner = text(value?.owner); const canonicalRemote = text(value?.canonicalRemote); const defaultBaseRef = text(value?.defaultBaseRef); const manifestDigest = text(value?.manifestDigest)
  if (!id || !projectId || !displayName || !organizationId || !workspaceId || !owner || !canonicalRemote.startsWith('https://') || !defaultBaseRef.startsWith('refs/heads/') || !manifestDigest.startsWith('sha256:')) throw new ChangeCaseError('PROJECT_INSTALLATION_INVALID', 'Project installations require scoped identity, owner, canonical remote, base ref, and manifest digest.')
  return Object.freeze({ id, projectId, displayName, organizationId, workspaceId, owner, canonicalRemote, defaultBaseRef, manifestDigest, state: 'ACTIVE' })
}

function owns(scope, installation) { return scope?.organizationId === installation.organizationId && scope?.workspaceId === installation.workspaceId }
function text(value) { return typeof value === 'string' ? value.trim() : '' }