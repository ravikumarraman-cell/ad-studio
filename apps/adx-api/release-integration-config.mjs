import { ChangeCaseError } from './change-case-ledger.mjs'

/**
 * Parses a real non-production integration profile. It intentionally grants
 * no deployment capability: provider-specific execution must be implemented
 * and separately approved after this preflight succeeds.
 */
export function loadNonProductionReleaseProfile(env) {
  if (env.ADX_RELEASE_INTEGRATION_ENABLED !== 'true') throw new ChangeCaseError('RELEASE_INTEGRATION_DISABLED', 'Set ADX_RELEASE_INTEGRATION_ENABLED=true only for an approved non-production integration.')
  const profile = {
    environment: required(env, 'ADX_RELEASE_ENVIRONMENT'),
    deploymentProvider: required(env, 'ADX_RELEASE_DEPLOYMENT_PROVIDER'),
    deploymentEndpoint: https(env, 'ADX_RELEASE_DEPLOYMENT_ENDPOINT'),
    featureFlagProvider: required(env, 'ADX_RELEASE_FLAG_PROVIDER'),
    featureFlagKey: required(env, 'ADX_RELEASE_FLAG_KEY'),
    telemetryProvider: required(env, 'ADX_RELEASE_TELEMETRY_PROVIDER'),
    telemetryEndpoint: https(env, 'ADX_RELEASE_TELEMETRY_ENDPOINT'),
    telemetryQuery: required(env, 'ADX_RELEASE_TELEMETRY_QUERY'),
    webhookSecret: required(env, 'ADX_RELEASE_WEBHOOK_SECRET'),
    rollbackArtifactDigest: digest(env, 'ADX_RELEASE_ROLLBACK_ARTIFACT_DIGEST'),
  }
  if (profile.environment.toLowerCase() === 'production' || profile.environment.toLowerCase() === 'prod') throw new ChangeCaseError('RELEASE_PRODUCTION_PROFILE_DENIED', 'Stage 8 integration setup accepts a named non-production environment only.')
  return Object.freeze({ mode: 'NON_PRODUCTION_PREPARED', ...profile, capabilities: Object.freeze({ deploy: false, featureFlagWrite: false, telemetryRead: false, webhookReceive: false }) })
}

const required = (env, name) => { const value = env[name]; if (typeof value !== 'string' || !value.trim()) throw new ChangeCaseError('RELEASE_INTEGRATION_CONFIGURATION_REQUIRED', `${name} is required for the non-production release profile.`); return value.trim() }
const https = (env, name) => { const value = required(env, name); try { const url = new URL(value); if (url.protocol !== 'https:') throw new Error('HTTPS_REQUIRED'); return url.toString() } catch { throw new ChangeCaseError('RELEASE_INTEGRATION_ENDPOINT_INVALID', `${name} must be an HTTPS URL.`) } }
const digest = (env, name) => { const value = required(env, name); if (!value.startsWith('sha256:')) throw new ChangeCaseError('RELEASE_INTEGRATION_DIGEST_INVALID', `${name} must be a sha256 digest.`); return value }
