import { ChangeCaseError, sha256 } from './change-case-ledger.mjs'

const networkModes = new Set(['none', 'package-registry-only'])

export function validateDeliveryPassport(value, { validationTemplates = ['node-web-production-build'], previewAdapters = ['container'] } = {}) {
  if (value?.apiVersion !== 'adx.io/v1alpha1' || value?.kind !== 'DeliveryPassport') throw new ChangeCaseError('DELIVERY_PASSPORT_SCHEMA_INVALID', 'Delivery Passport requires the supported API version and kind.')
  const metadata = object(value.metadata, 'metadata'); const repository = object(value.repository, 'repository'); const build = object(value.build, 'build'); const preview = object(value.preview, 'preview'); const capabilities = object(value.capabilities, 'capabilities'); const agent = object(capabilities.agent, 'capabilities.agent'); const delivery = object(capabilities.delivery, 'capabilities.delivery')
  const normalized = Object.freeze({
    apiVersion: value.apiVersion,
    kind: value.kind,
    metadata: Object.freeze({ id: identifier(metadata.id, 'metadata.id'), displayName: text(metadata.displayName, 'metadata.displayName'), owner: identifier(metadata.owner, 'metadata.owner'), classification: identifier(metadata.classification, 'metadata.classification') }),
    repository: Object.freeze({ canonicalRemote: remote(repository.canonicalRemote), defaultBaseRef: baseRef(repository.defaultBaseRef), sourcePath: path(repository.sourcePath, 'repository.sourcePath', { allowRoot: true }) }),
    build: Object.freeze({ runtime: nodeRuntime(build.runtime), validateTemplate: allowed(build.validateTemplate, validationTemplates, 'build.validateTemplate') }),
    preview: Object.freeze({ adapter: allowed(preview.adapter, previewAdapters, 'preview.adapter'), dockerfile: path(preview.dockerfile, 'preview.dockerfile'), context: path(preview.context, 'preview.context', { allowRoot: true }), readiness: Object.freeze({ port: port(preview.readiness?.port), path: readinessPath(preview.readiness?.path) }), secretRefs: Object.freeze(list(preview.secretRefs, 'preview.secretRefs').map((reference) => identifier(reference, 'preview.secretRefs'))) }),
    capabilities: Object.freeze({ agent: Object.freeze({ writePaths: Object.freeze(list(agent.writePaths, 'capabilities.agent.writePaths').map((entry) => glob(entry))), network: allowed(agent.network, networkModes, 'capabilities.agent.network') }), delivery: Object.freeze({ preview: delivery.preview === true, production: delivery.production === true }) }),
  })
  if (!normalized.capabilities.delivery.preview || normalized.capabilities.delivery.production) throw new ChangeCaseError('DELIVERY_PASSPORT_CAPABILITY_DENIED', 'Initial Delivery Passports may request preview delivery only.')
  return Object.freeze({ passport: normalized, digest: sha256(normalized) })
}

function object(value, name) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ChangeCaseError('DELIVERY_PASSPORT_SCHEMA_INVALID', `${name} must be an object.`); return value }
function text(value, name) { const normalized = typeof value === 'string' ? value.trim() : ''; if (!normalized) throw new ChangeCaseError('DELIVERY_PASSPORT_SCHEMA_INVALID', `${name} is required.`); return normalized }
function identifier(value, name) { const normalized = text(value, name); if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) throw new ChangeCaseError('DELIVERY_PASSPORT_SCHEMA_INVALID', `${name} must be a lowercase identifier.`); return normalized }
function remote(value) { const normalized = text(value, 'repository.canonicalRemote'); if (!normalized.startsWith('https://')) throw new ChangeCaseError('DELIVERY_PASSPORT_SCHEMA_INVALID', 'repository.canonicalRemote must be HTTPS.'); return normalized }
function baseRef(value) { const normalized = text(value, 'repository.defaultBaseRef'); if (!normalized.startsWith('refs/heads/')) throw new ChangeCaseError('DELIVERY_PASSPORT_SCHEMA_INVALID', 'repository.defaultBaseRef must be a heads ref.'); return normalized }
function path(value, name, { allowRoot = false } = {}) { const normalized = text(value, name); if ((allowRoot && normalized === '.') || (!normalized.startsWith('/') && !normalized.includes('\\') && !normalized.split('/').some((part) => !part || part === '.' || part === '..'))) return normalized; throw new ChangeCaseError('DELIVERY_PASSPORT_PATH_INVALID', `${name} must be a canonical relative path.`) }
function nodeRuntime(value) { const normalized = text(value, 'build.runtime'); if (normalized !== 'node-22') throw new ChangeCaseError('DELIVERY_PASSPORT_SCHEMA_INVALID', 'build.runtime must be node-22.'); return normalized }
function allowed(value, values, name) { const normalized = text(value, name); if (!values.includes?.(normalized) && !values.has?.(normalized)) throw new ChangeCaseError('DELIVERY_PASSPORT_CAPABILITY_DENIED', `${name} is not approved.`); return normalized }
function list(value, name) { if (!Array.isArray(value) || !value.length) throw new ChangeCaseError('DELIVERY_PASSPORT_SCHEMA_INVALID', `${name} must be a non-empty array.`); return value }
function port(value) { if (!Number.isInteger(value) || value < 1 || value > 65535) throw new ChangeCaseError('DELIVERY_PASSPORT_SCHEMA_INVALID', 'preview.readiness.port must be a valid TCP port.'); return value }
function readinessPath(value) { const normalized = text(value, 'preview.readiness.path'); if (!normalized.startsWith('/') || normalized.includes('..')) throw new ChangeCaseError('DELIVERY_PASSPORT_PATH_INVALID', 'preview.readiness.path must be an absolute URL path.'); return normalized }
function glob(value) { const normalized = path(value, 'capabilities.agent.writePaths'); if (!normalized.endsWith('/**')) throw new ChangeCaseError('DELIVERY_PASSPORT_CAPABILITY_DENIED', 'Agent write paths must be recursive directory globs.'); return normalized }